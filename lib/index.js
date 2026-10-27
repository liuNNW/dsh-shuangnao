// 双脑宿主半侧：只做两件事——
//   1. 注册 /dual-brain/* 的 HTTP 路由，给浏览器半侧读配置、存配置、拉模型目录；
//   2. 把当前配置的含义固定下来（校验 + 落盘），供 preset 里的 delegate 工具读取。
//
// 这里不需要 llm / tools 服务也能活：模型目录拉不到时，UI 退化成手填 provider/model。

import { configPath, normalizeConfig, readConfig, writeConfig } from './config.mjs';

export const name = 'dual-brain-host';
/** 只硬依赖 webServer：没有它就没地方挂路由。 */
export const inject = ['webServer'];

const ROUTE_PREFIX = '/dual-brain';

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** 只接受同源写：带了 Origin 就必须与 Host 一致。 */
function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== 'string' || origin === '') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 262144) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  return JSON.parse(text);
}

/** 把 ctx.llm 的目录投影成 UI 需要的形状；任何一条路由失败都不影响其它。 */
async function buildCatalog(ctx) {
  const llm = ctx.get('llm');
  if (llm === undefined) return { providers: [], errors: ['llm service unavailable'] };
  const providers = [];
  const errors = [];
  let infos = [];
  try {
    infos = llm.listProviders();
  } catch (error) {
    return { providers: [], errors: [String(error?.message ?? error)] };
  }
  for (const info of infos) {
    let models = [];
    try {
      const listed = await llm.listModels(info.id);
      models = listed.map((model) => ({ id: model.id, name: model.name ?? model.id }));
    } catch (error) {
      errors.push(info.id + ': ' + String(error?.message ?? error));
    }
    providers.push({ id: info.id, name: info.name ?? info.id, models });
  }
  return { providers, errors };
}

/** 尽力验证一条路由：llm 不可用或解析失败都只作为 warning，不阻塞保存。 */
async function validateRoutes(ctx, config) {
  const llm = ctx.get('llm');
  const warnings = [];
  if (llm === undefined) return warnings;
  for (const key of ['plan', 'exec']) {
    const slot = config[key];
    if (slot.provider === '' || slot.model === '') continue;
    const candidate = { provider: slot.provider, model: slot.model };
    if (slot.reasoningEffort !== '') candidate.reasoningEffort = slot.reasoningEffort;
    try {
      await llm.resolveCallConfig(candidate);
    } catch (error) {
      warnings.push(key + ' 路由不可用：' + String(error?.message ?? error));
    }
  }
  return warnings;
}

export function apply(ctx) {
  const disposer = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (request, response) => {
      let route = '/';
      try {
        route = new URL(request.url ?? '/', 'http://x').pathname.slice(ROUTE_PREFIX.length) || '/';
      } catch {
        return sendJson(response, 400, { ok: false, error: 'malformed request url' });
      }

      try {
        if (route === '/config' && (request.method === 'GET' || request.method === 'HEAD')) {
          return sendJson(response, 200, {
            ok: true,
            config: readConfig(),
            file: configPath(),
          });
        }

        if (route === '/config' && request.method === 'POST') {
          if (!sameOrigin(request)) {
            return sendJson(response, 403, { ok: false, error: 'cross-origin write refused' });
          }
          const body = await readJsonBody(request);
          const incoming = body !== null && typeof body === 'object' ? body.config : undefined;
          const normalized = normalizeConfig(incoming);
          const warnings = await validateRoutes(ctx, normalized);
          const saved = writeConfig(normalized);
          return sendJson(response, 200, { ok: true, config: saved, warnings, file: configPath() });
        }

        if (route === '/models' && request.method === 'GET') {
          const catalog = await buildCatalog(ctx);
          return sendJson(response, 200, { ok: true, ...catalog });
        }

        // 诊断：注册表里到底有没有本插件的 preset、加载器能不能解析相关模块。
        if (route === '/diag' && request.method === 'GET') {
          const report = { ok: true, config: readConfig(), file: configPath() };

          const presets = ctx.get('agentPresets');
          report.registry = presets === undefined ? 'agentPresets service not visible from host scope' : 'present';
          if (presets !== undefined && typeof presets.list === 'function') {
            try {
              const rows = await presets.list();
              report.presets = rows.map((row) => ({
                id: row && row.id,
                name: row && row.name,
                order: row && row.order,
                // 注册表把激活失败挂在 `broken` 字段上（不是 diagnostic）
                broken: row && (row.broken ?? row.diagnostic ?? row.error ?? null),
              }));
            } catch (error) {
              report.presetsError = String(error && error.message ? error.message : error);
            }
          }

          report.modules = {};
          for (const specifier of ['dsh-dual-brain-live', 'dsh-dual-brain-live/agent', '@deepseek-ai/dsh-agent-preset', '@deepseek-ai/dsh-persona']) {
            try {
              report.modules[specifier] = typeof import.meta.resolve === 'function'
                ? import.meta.resolve(specifier)
                : 'import.meta.resolve unavailable';
            } catch (error) {
              report.modules[specifier] = 'ERR ' + String(error && error.message ? error.message : error);
            }
          }

          try {
            const mod = await import('dsh-dual-brain-live/agent');
            report.agentModule = Object.keys(mod);
          } catch (error) {
            report.agentModuleError = String(error && error.message ? error.message : error);
          }

          return sendJson(response, 200, report);
        }

        return sendJson(response, 404, { ok: false, error: `unknown dual-brain route: ${route}` });
      } catch (error) {
        const message = String(error?.message ?? error);
        ctx.logger?.warn?.(`[dual-brain] route ${route} failed: ${message}`);
        if (!response.headersSent) sendJson(response, 400, { ok: false, error: message });
        else response.destroy();
      }
    },
  });

  ctx.effect(() => () => {
    try {
      disposer?.();
    } catch { /* 卸载时的清理失败不影响其它插件 */ }
  });
}

export default { name, inject, apply };
