// 双脑 Agent 半侧：注册 delegate 工具。
//
// 这个插件挂在 preset 的插件树里，所以它注册的工具只属于用这个 preset 的 Agent。
// 每次调用都重新读一遍磁盘上的双脑配置 —— 这就是「随时切换」的来源：
// 模型不是编译进工具的参数，而是调用时现读的一个值。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, slotReady, slotToAgentOptions } from './config.mjs';

export const name = 'dual-brain-agent';
export const inject = ['tools'];

// 排障用：把关键判断落盘，避免"到底是没跑还是跑错了"只能靠猜。
// 位置：<tmp>/dual-brain-trace.log，超过 200KB 自动截断重来。
const TRACE_FILE = path.join(os.tmpdir(), 'dual-brain-trace.log');

export function trace(line) {
  try {
    if (fs.existsSync(TRACE_FILE) && fs.statSync(TRACE_FILE).size > 200_000) fs.writeFileSync(TRACE_FILE, '');
    fs.appendFileSync(TRACE_FILE, new Date().toISOString().slice(11, 23) + ' ' + line + '\n');
  } catch { /* 日志失败不影响业务 */ }
}

/** 把 {字段: {type, required, description}} 的写法转成 JSON Schema。 */
function toJsonSchema(spec) {
  const properties = {};
  const required = [];
  for (const key of Object.keys(spec ?? {})) {
    const field = spec[key] ?? {};
    const property = { type: field.type ?? 'string' };
    if (field.description !== undefined) property.description = field.description;
    if (Array.isArray(field.enum)) property.enum = field.enum;
    properties[key] = property;
    if (field.required === true) required.push(key);
  }
  const schema = { type: 'object', additionalProperties: false, properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

const PARAMETERS = toJsonSchema({
  prompt: {
    type: 'string',
    required: true,
    description: 'The full task for the child agent. It has no access to this conversation, so restate every fact, path and constraint it needs.',
  },
  description: {
    type: 'string',
    required: true,
    description: 'Short label shown in the UI for this child run.',
  },
  mode: {
    type: 'string',
    required: false,
    enum: ['exec', 'plan'],
    description: "Which configured brain to use: 'exec' (default) is the hands-on executor, 'plan' is the thinking/planning brain that returns an approach instead of doing the work.",
  },
});

const OUTPUT = toJsonSchema({
  kind: { type: 'string', required: true },
  subagentId: { type: 'string', required: true },
});

/** 配置缺槽位时的错误文案：直接告诉用户去哪配。 */
function describeMissing(slotName) {
  return 'dual-brain: no model configured for "' + slotName + '". '
    + 'Open 设置 → Models → 双脑模型 and pick a provider/model for it, then retry.';
}

/**
 * 读会话日志里的计划模式状态：最后一次 `plan/mode` 事件说了算。
 *
 * 不假设 `session.events` 是普通数组 —— 它可能是日志对象（有 length / 可迭代但不是 Array）。
 * 先看 events，没有 plan/mode 事件再退回 session.log，两者都读不到才算 false。
 */
export function planModeActive(agent) {
  const session = agent && agent.session ? agent.session : undefined;
  if (session === undefined) return false;
  const sources = [session.events, session.log];
  for (const source of sources) {
    if (source === undefined || source === null) continue;
    let found = false;
    let active = false;
    try {
      for (const event of source) {
        if (event && event.type === 'plan/mode') {
          found = true;
          active = event.data ? event.data.active === true : false;
        }
      }
    } catch {
      continue; // 这个来源不可枚举，换下一个
    }
    if (found) return active;
  }
  return false;
}

/** 给 trace 用：描述某个日志来源能不能枚举、有几条。 */
function describeLog(source) {
  if (source === undefined || source === null) return 'none';
  const kind = Array.isArray(source) ? 'array' : typeof source;
  let count = '?';
  try {
    count = String([...source].length);
  } catch {
    count = 'uniterable';
  }
  return kind + '(' + count + ')';
}

/**
 * 让「计划模式期间的主脑」用规划脑。
 *
 * 做法就是官方 installModelSelection 的等价物，只是不 import 外部包：
 *   - pre-step（瀑布，必须 next()）：本步真正生效的计划状态在 next() 之后才落盘，
 *     所以读完 next 的结果再把「本步该用谁」写进 ref；
 *   - system-prompt/assemble：把 ref 快照成 assembled，并替换 {{provider}}/{{model}}；
 *   - agent/request：用 assembled 覆盖请求路由。
 *
 * 退出计划模式时 ref.current = undefined，三个钩子全部原样放行 —— 右上角选择器
 * 的语义立刻回来，不会和原生 /model 抢。
 */
export function installPlanBrain(agent) {
  const agentCtx = agent && agent.ctx ? agent.ctx : undefined;
  if (agentCtx === undefined || typeof agentCtx.on !== 'function') return;

  let lastLogged = null;
  const session = agent.session;
  trace('install agent=' + String(agent.id) + ' events=' + describeLog(session && session.events) + ' log=' + describeLog(session && session.log));

  /** 本步该用谁：现读配置 + 现读计划模式状态。undefined 表示不接管。 */
  const planSelection = () => {
    const slot = readConfig().plan;
    return planModeActive(agent) && slotReady(slot) ? slotToAgentOptions(slot) : undefined;
  };

  // prepend：cordis 的 waterfall 是「先注册的在最外层、返回值才算数」。
  // sessionController 在 agent 创建时就装了 installModelSelection，比我们早，
  // 不插到最外层的话，它调用 next() 之后会把 provider/model 改回你选的模型。
  agentCtx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next();
    if (decision && decision.kind === 'reject') return decision;
    const selected = planSelection();
    const routeKey = selected === undefined ? '-' : selected.provider + '/' + selected.model;
    if (routeKey !== lastLogged) {
      lastLogged = routeKey;
      trace('pre-step route=' + routeKey);
      try {
        agentCtx.logger?.info?.('[dual-brain] request route → ' + (routeKey === '-' ? 'session default' : routeKey));
      } catch { /* 日志失败不影响请求 */ }
    }
    return decision;
  }, { prepend: true });

  // 顺带把 {{provider}}/{{model}} 也改成规划脑（只是让提示词自洽，路由不依赖它）。
  agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = planSelection();
    const assembled = await next();
    trace('assemble route=' + (selected === undefined ? '-' : selected.provider + '/' + selected.model));
    if (selected === undefined) return assembled;
    const variables = Object.assign({}, assembledVariables(assembled), {
      provider: selected.provider,
      model: selected.model,
    });
    return Object.assign({}, assembled, { variables });
  }, { prepend: true });

  // ★ 路由决策放在这里现算：trace 证明 assemble 早于 pre-step，
  //   任何"在 pre-step 算好、让 assemble 快照"的写法都会拿到空值。
  agentCtx.on('agent/request', async (_payload, next) => {
    const resolved = await next();
    const selected = planSelection();
    trace('request route=' + (selected === undefined ? '-' : selected.provider + '/' + selected.model)
      + ' inner=' + String(resolved && resolved.provider) + '/' + String(resolved && resolved.model));
    if (selected === undefined) return resolved;
    const base = Object.assign({}, resolved);
    delete base.reasoningEffort; // 换路由时不能带走旧路由的推理档位
    const overridden = {
      provider: selected.provider,
      model: selected.model,
    };
    if (selected.reasoningEffort !== undefined) overridden.reasoningEffort = selected.reasoningEffort;
    return Object.assign(base, overridden);
  }, { prepend: true });
}

/** 组装结果的 variables 可能是空对象，也可能没有该字段。 */
function assembledVariables(assembled) {
  if (assembled !== null && typeof assembled === 'object' && assembled.variables !== null && typeof assembled.variables === 'object') {
    return assembled.variables;
  }
  return {};
}

/* ---------------- A：计划被批准即交棒给执行脑 ---------------- */

const EXIT_PLAN_MODE = 'exit_plan_mode';

/** 同一个计划只交棒一次（会话 + 计划头部当键），上限 50 条后清空。 */
const handedOff = new Map();

function toolNameOf(exec) {
  return String(
    exec === undefined || exec === null
      ? ''
      : exec.toolName ?? (exec.tool === undefined ? undefined : exec.tool.name) ?? exec.name ?? '',
  );
}

function planOf(exec) {
  if (exec === undefined || exec === null) return '';
  // 线上实测（trace）：工具执行对象的参数在 `arguments` 字段，不是 args/input/parameters
  const raw = exec.arguments ?? exec.args ?? exec.input ?? exec.parameters;
  let args = raw;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return ''; }
  }
  const plan = args !== null && typeof args === 'object' ? args.plan : undefined;
  return typeof plan === 'string' ? plan.trim() : '';
}

function firstHeading(plan) {
  const match = /^#\s+(.+)$/m.exec(plan);
  return match === null ? '计划' : match[1].trim();
}

function handoffPrompt(plan, cwd) {
  const lines = [
    '你在实现一份已经由用户批准的计划。',
    typeof cwd === 'string' && cwd !== '' ? '工作目录：' + cwd : '',
    '',
    plan,
    '',
    '要求：',
    '- 严格按计划实现，不要重新设计或扩大范围。',
    '- 用工具真正动手（改文件、跑命令、跑测试），不要只描述打算怎么做。',
    '- 完成后回报：改了哪些文件、怎么验证的、未完成项和与原计划的偏差。',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

/**
 * tools/post-execute 钩子：`exit_plan_mode` 只有在用户在计划审核里点了「批准」时
 * 才返回成功结果（点「继续规划」是抛错），所以"成功 = 批准"。
 * 批准后自动用执行脑起一个子会话去实现，主脑只等回报做验收。
 */
async function maybeHandoff(ctx, exec, result, next) {
  if (toolNameOf(exec) !== EXIT_PLAN_MODE) return next();
  if (result !== undefined && result !== null && result.isError === true) return next();

  const agent = exec === undefined || exec === null ? undefined : exec.agent;
  if (agent === undefined || agent === null) return next();

  const plan = planOf(exec);
  if (plan === '') {
    trace('handoff skip: plan text not found (exec keys=' + Object.keys(exec).join(',') + ')');
    return next();
  }

  const slot = readConfig().exec;
  if (!slotReady(slot)) {
    trace('handoff skip: exec slot empty');
    return next();
  }

  const key = String(agent.id ?? '?') + '\u0000' + plan.slice(0, 160);
  if (handedOff.has(key)) {
    trace('handoff skip: duplicate');
    return next();
  }

  const subagents = ctx.get('subagents');
  if (subagents === undefined) {
    trace('handoff skip: no subagents service');
    return next();
  }

  const agentOptions = slotToAgentOptions(slot);
  const llm = ctx.get('llm');
  if (llm !== undefined) await llm.resolveCallConfig(agentOptions);

  const cwd = agent.session === undefined ? undefined : agent.session.cwd;
  const activation = await subagents.startActivation({
    provider: 'spawn',
    label: '执行脑：' + firstHeading(plan),
    request: {
      prompt: [{ type: 'text', text: handoffPrompt(plan, cwd) }],
      parent: agent,
      agentOptions,
    },
    delivery: 'parent',
  });

  handedOff.set(key, true);
  if (handedOff.size > 50) handedOff.clear();
  trace('handoff started child=' + String(activation === undefined ? '?' : activation.childId));

  // C：把主会话的模型也切到执行脑，让你在右上角直接看到变化。
  // 走 sessionController.selectModel（= UI 切模型那条路），代价是它会顺带把
  // 「默认模型」也存成执行脑（DSH 自身行为，无法从这条 API 关闭）。
  const switched = await switchMainModel(ctx, agent, agentOptions);

  const note = {
    type: 'text',
    text: '（系统：这份计划已自动交给「执行脑」实现，子会话 '
      + String(activation === undefined ? '?' : activation.childId)
      + (switched === true ? '；当前会话的模型也已切到执行脑' : '')
      + '。不要再自己动手实现同一份计划——等它回报后做验收即可。）',
  };
  const content = result !== undefined && result !== null && Array.isArray(result.content)
    ? [...result.content, note]
    : [note];
  return { kind: 'accept', content };
}

/** C 的实现：调用 sessionController.selectModel，让会话模型与 UI 一起切到执行脑。 */
async function switchMainModel(ctx, agent, agentOptions) {
  const controller = ctx.get('sessionController');
  const sessionId = agent.session === undefined ? undefined : agent.session.id;
  if (controller === undefined || typeof controller.selectModel !== 'function' || sessionId === undefined) {
    trace('switch skipped: no sessionController/sessionId');
    return false;
  }
  try {
    await controller.selectModel({
      sessionId,
      provider: agentOptions.provider,
      model: agentOptions.model,
      ...agentOptions.reasoningEffort === undefined ? {} : { reasoningEffort: agentOptions.reasoningEffort },
    });
    trace('session model switched to ' + agentOptions.provider + '/' + agentOptions.model);
    return true;
  } catch (error) {
    trace('switch failed: ' + String(error && error.message ? error.message : error));
    return false;
  }
}

export function apply(ctx) {
  // 每个属于本 preset 的 Agent 都装一次「计划模式→规划脑」的转接。
  if (typeof ctx.on === 'function') {
    ctx.on('agent/created', ({ agent }) => {
      try {
        installPlanBrain(agent);
      } catch (error) {
        ctx.logger?.warn?.(`[dual-brain] plan brain install failed: ${String(error && error.message ? error.message : error)}`);
      }
    });

    // A：计划被批准（exit_plan_mode 返回 approved）就自动把计划交给执行脑实现。
    ctx.on('tools/post-execute', async (exec, result, next) => {
      try {
        return await maybeHandoff(ctx, exec, result, next);
      } catch (error) {
        trace('handoff error ' + String(error && error.message ? error.message : error));
        return next();
      }
    }, { prepend: true });
  }

  ctx.tools.register({
    name: 'delegate',
    description: [
      'Delegate a self-contained task to the configured child model (the "dual brain").',
      "Use mode 'plan' to get an approach/step list from the thinking brain, and mode 'exec' (default) to have the execution brain do the hands-on work.",
      'The child has its own context and does not see this conversation, so put every needed detail in `prompt`.',
      'Which model runs is configured by the user in 设置 → Models → 双脑模型 and can change between calls without restarting.',
    ].join(' '),
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: (_args, value) => [{ type: 'text', text: 'started ' + value.subagentId }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent;
      if (parent === undefined) throw new Error('delegate requires a calling agent');

      const mode = args.mode === 'plan' ? 'plan' : 'exec';
      const slot = readConfig()[mode];
      if (!slotReady(slot)) throw new Error(describeMissing(mode));

      const agentOptions = slotToAgentOptions(slot);

      // 路由先过一遍适配器：provider/model 不存在会在启动子会话之前就报错。
      const llm = ctx.get('llm');
      if (llm !== undefined) await llm.resolveCallConfig(agentOptions);

      const subagents = ctx.get('subagents');
      if (subagents === undefined) throw new Error('delegate requires the subagent service');

      const request = {
        prompt: [{ type: 'text', text: String(args.prompt ?? '') }],
        parent,
        agentOptions,
      };

      const activation = await subagents.startActivation({
        provider: 'spawn',
        label: typeof args.description === 'string' && args.description !== '' ? args.description : 'delegate',
        request,
        signal: exec.signal,
        delivery: 'parent',
      });

      return { kind: 'activation', subagentId: activation.childId };
    },
  });
}

export default { name, inject, apply };
