import { Readable } from 'node:stream';
import { apply as applyHost } from './lib/index.js';
import { apply as applyAgent } from './lib/agent.js';

process.env.DSH_HOME = 'D:\\数据\\下载\\迅雷skill\\测试\\_dbl_test';

let handler = null;
const disposers = [];
const hostCtx = {
  webServer: {
    register(options) {
      handler = options.handler;
      return () => disposers.push('route');
    },
  },
  effect(callback) {
    const dispose = callback();
    return () => dispose?.();
  },
  get(name) {
    if (name !== 'llm') return undefined;
    return {
      listProviders: () => [{ id: 'wbpool', name: 'WorkBuddy' }, { id: 'xiaomi', name: 'Xiaomi' }],
      listModels: async (provider) => (provider === 'wbpool'
        ? [{ id: 'cn:glm-5.3', name: 'GLM-5.3' }, { id: 'cn:kimi-k3-1', name: 'Kimi-K3' }]
        : [{ id: 'mimo-v2.6-flash', name: 'MiMo' }]),
      resolveCallConfig: async (config) => config,
    };
  },
  logger: { warn() {} },
};
applyHost(hostCtx);
console.log('handler registered:', typeof handler === 'function');

function makeRequest(method, url, body, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = Object.assign({ host: '127.0.0.1:19387' }, headers);
  return stream;
}

function makeResponse() {
  const res = {
    headersSent: false,
    status: 0,
    body: '',
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(chunk) { if (chunk) this.body += String(chunk); },
    destroy() {},
  };
  return res;
}

async function call(method, url, body, headers) {
  const res = makeResponse();
  await handler(makeRequest(method, url, body, headers), res);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

const first = await call('GET', '/dual-brain/config');
console.log('GET config:', first.status, JSON.stringify(first.json.config));

const models = await call('GET', '/dual-brain/models');
console.log('GET models:', models.status, models.json.providers.map((p) => p.id + ':' + p.models.length).join(','), 'errors', models.json.errors.length);

const diag = await call('GET', '/dual-brain/diag');
console.log('GET diag  :', diag.status, '| registry:', diag.json.registry, '| probes:', Object.keys(diag.json.modules || {}).length);

const saved = await call('POST', '/dual-brain/config', {
  config: {
    plan: { provider: 'wbpool', model: 'cn:kimi-k3-1', reasoningEffort: 'xhigh' },
    exec: { provider: 'wbpool', model: 'cn:glm-5.3' },
  },
});
console.log('POST config:', saved.status, JSON.stringify(saved.json.config), 'warnings', JSON.stringify(saved.json.warnings));

const crossOrigin = await call('POST', '/dual-brain/config', { config: {} }, { origin: 'https://evil.example' });
console.log('cross-origin refused:', crossOrigin.status, crossOrigin.json.error);

const missing = await call('GET', '/dual-brain/nope');
console.log('unknown route:', missing.status);

// Agent 半侧：验证两个 mode 各取各的槽位
const seen = [];
const agentCtx = {
  tools: { register(tool) { this.tool = tool; } },
  get(name) {
    if (name === 'llm') return { resolveCallConfig: async (config) => { seen.push(['resolve', config]); return config; } };
    if (name === 'subagents') return { startActivation: async (activation) => { seen.push([activation.request.agentOptions]); return { childId: 'c1' }; } };
    return undefined;
  },
};
applyAgent(agentCtx);
for (const mode of ['plan', 'exec']) {
  await agentCtx.tools.tool.execute({ prompt: 'p', description: 'd', mode }, { agent: {}, signal: undefined });
}
console.log('agent routes:', JSON.stringify(seen));

/* ---------- 计划模式 → 规划脑 的转接 ---------- */

// 迷你 cordis 瀑布：先注册的在最外层，next() 从队头取下一个，
// prepend 用 unshift 插到最外层 —— 和 @deepseek-ai/cordis 的 waterfall 一致。
function makeEvent() {
  const hooks = [];
  return {
    on(fn, options) {
      if (options !== null && typeof options === 'object' && options.prepend === true) hooks.unshift(fn);
      else hooks.push(fn);
    },
    call(args, fallback) {
      const queue = hooks.slice();
      const next = () => (queue.shift() ?? fallback)(...args, next);
      return next();
    },
  };
}

const hooks = {};
const activations = [];
const fakeSubagents = {
  async startActivation(spec) {
    activations.push(spec);
    return { childId: 'child-' + activations.length };
  },
};
const fakeLlm = { async resolveCallConfig(config) { return config; } };
const switches = [];
const fakeSessionController = {
  async selectModel(request) {
    switches.push(request);
    return { selected: { provider: request.provider, model: request.model } };
  },
};
const pluginCtx = {
  tools: { register() {} },
  on(name, fn) { hooks[name] = fn; },
  get(name) {
    if (name === 'subagents') return fakeSubagents;
    if (name === 'llm') return fakeLlm;
    if (name === 'sessionController') return fakeSessionController;
    return undefined;
  },
  logger: { warn() {} },
};
applyAgent(pluginCtx);

const events = {};
const brainCtx = {
  on(name, fn, options) {
    (events[name] ||= makeEvent()).on(fn, options);
  },
};
const agent = { session: { events: [] }, ctx: brainCtx };

console.log('agent/created hook:', typeof hooks['agent/created']);
hooks['agent/created']({ agent });
console.log('per-agent hooks:', Object.keys(events).join(', '));

// 模拟 sessionController：它比我们注册得晚，并且在 next() 之后强行写回"用户选的模型"。
// 这正是线上抓到的症状：不 prepend 就被它吃掉。
events['system-prompt/assemble'].on(async (_assembly, _context, next) => {
  const assembled = await next();
  return Object.assign({}, assembled, { variables: Object.assign({}, assembled.variables, { provider: 'user-provider', model: 'user-model' }) });
});
events['agent/request'].on(async (_payload, next) => {
  const resolved = await next();
  const base = Object.assign({}, resolved);
  delete base.reasoningEffort;
  return Object.assign(base, { provider: 'user-provider', model: 'user-model' });
});

async function step(active) {
  if (active !== undefined) agent.session.events.push({ type: 'plan/mode', data: { active } });
  await events['agent/pre-step'].call([{ agent, signal: { aborted: false } }], async () => ({ kind: 'accept' }));
  const assembled = await events['system-prompt/assemble'].call([{}, { agent }], async () => ({ variables: {} }));
  const request = await events['agent/request'].call([{}], async () => ({ provider: 'main-provider', model: 'main-model', reasoningEffort: 'high' }));
  return { assembled, request };
}

const inPlan = await step(true);
console.log('plan mode  :', JSON.stringify(inPlan.assembled.variables), JSON.stringify(inPlan.request));

const outPlan = await step(false);
console.log('normal mode:', JSON.stringify(outPlan.assembled.variables), JSON.stringify(outPlan.request));

// 回归：线上 trace 证明 assemble 早于 pre-step，所以"直接发请求"也必须能接管。
agent.session.events.push({ type: 'plan/mode', data: { active: true } });
const direct = await events['agent/request'].call([{}], async () => ({ provider: 'main-provider', model: 'main-model' }));
console.log('request only:', JSON.stringify(direct));

/* ---------- A：计划批准 → 自动交棒执行脑 ---------- */

const planAgent = { id: 'agent-a', session: { id: 'sess-a', cwd: 'D:/work/demo' } };
const approved = { content: [{ type: 'text', text: 'Plan approved — plan mode exited' }] };
const planExec = {
  // 线上 trace 的实际形状：工具名在 name，参数在 arguments
  name: 'exit_plan_mode',
  agent: planAgent,
  arguments: { plan: '# 支付模块重构\n\n1. 拆 service\n2. 补测试' },
};
const passThrough = async () => ({ kind: 'accept' });

const handoff = await hooks['tools/post-execute'](planExec, approved, passThrough);
const other = await hooks['tools/post-execute']({ toolName: 'write', agent: planAgent, args: { path: 'a' } }, approved, passThrough);
const duplicate = await hooks['tools/post-execute'](planExec, approved, passThrough);
const spec = activations[0] ?? {};

console.log('handoff decision:', JSON.stringify(handoff));
console.log('handoff activation: provider=' + spec.provider + ' label=' + spec.label + ' delivery=' + spec.delivery
  + ' model=' + JSON.stringify(spec.request && spec.request.agentOptions));
console.log('activations total:', activations.length);

const checks = [
  // A：批准后自动交棒
  ['handoff: activation spawned', activations.length === 1 && spec.provider === 'spawn' && spec.delivery === 'parent'],
  ['handoff: uses exec brain', spec.request.agentOptions.provider === 'wbpool' && spec.request.agentOptions.model === 'cn:glm-5.3'],
  ['handoff: prompt carries the plan', String(spec.request.prompt[0].text).includes('支付模块重构') && String(spec.request.prompt[0].text).includes('D:/work/demo')],
  ['handoff: tells the main brain to stop', Array.isArray(handoff.content) && handoff.content.some((part) => String(part.text).includes('执行脑'))],
  ['handoff: other tools untouched', other.kind === 'accept' && other.content === undefined],
  ['handoff: same plan only once', duplicate.kind === 'accept' && activations.length === 1],
  // C：会话模型也切到执行脑（走 selectModel，UI 能看见）
  ['switch: session model -> exec brain', switches.length === 1 && switches[0].sessionId === 'sess-a'
    && switches[0].provider === 'wbpool' && switches[0].model === 'cn:glm-5.3'],

  // 关键回归：模拟的 sessionController 注册得比我们晚，但我们在最外层，所以计划模式仍然赢
  ['plan: variables switch to plan brain', inPlan.assembled.variables.provider === 'wbpool' && inPlan.assembled.variables.model === 'cn:kimi-k3-1'],
  ['plan: request routed to plan brain', inPlan.request.provider === 'wbpool' && inPlan.request.model === 'cn:kimi-k3-1'],
  ['plan: keeps plan effort', inPlan.request.reasoningEffort === 'xhigh'],
  // 非计划模式：我们不管，让用户自己的选择（模拟成 user-provider）说了算
  ['normal: leaves routing to user selection', outPlan.request.provider === 'user-provider' && outPlan.request.model === 'user-model'],
  ['normal: plan brain not applied', outPlan.request.model !== 'cn:kimi-k3-1'],
  ['normal: main effort not inherited', outPlan.request.reasoningEffort === undefined],
  // 线上 bug 的回归锁：不需要 pre-step/assemble 先跑，请求层自己就能算出来
  ['request alone still routes to plan brain', direct.provider === 'wbpool' && direct.model === 'cn:kimi-k3-1'],
];
let planFailed = 0;
for (const [name, ok] of checks) {
  if (!ok) planFailed += 1;
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name);
}
if (planFailed > 0) process.exitCode = 1;
