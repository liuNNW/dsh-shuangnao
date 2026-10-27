// Dump the stylesheet and build a static preview page for a headless screenshot.
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8');

let definition = null;
let captured = '';
const sandbox = {
  window: { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load: (d) => { definition = d; } } },
  document: {
    baseURI: 'http://x/',
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ dataset: {}, set textContent(v) { captured = v; }, get textContent() { return captured; }, style: {} }),
    head: { appendChild() {} },
  },
  console,
  URL,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js', global: sandbox });

const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (v) => [v, () => {}],
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useEffect: () => {},
  Component: class { constructor(p) { this.props = p ?? {}; this.state = {}; } },
};
const mod = definition.factory((n) => (n === 'react' ? react : undefined));
mod.apply({ slots: { inject(_n, cb) { cb(); }, register() {} }, logger: { info() {} } });

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>dual brain card</title>
<style>
  body{margin:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328}
  .page{max-width:760px;margin:0 auto;padding:28px 20px 64px}
  .sect-title{font-size:13px;font-weight:600;margin:0 0 4px}
  .sect-sub{font-size:12px;color:#6b7280;margin:0 0 10px}
  .provider{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #eceef1;border-radius:10px;background:#fff;margin-bottom:8px;font-size:13px}
  .provider span{color:#98a1ac;font-size:11px}
  .dot{width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:8px}
  ${captured}
  .dbl-menu{position:static !important;margin-top:8px;box-shadow:0 10px 28px rgba(17,24,39,.08),0 1px 2px rgba(17,24,39,.05)}
</style></head>
<body><div class="page">
  <p class="sect-title">Models</p>
  <p class="sect-sub">这里是页面里已有的渠道行，下面是新增的卡片</p>
  <div class="provider"><div><span class="dot" style="background:#98a1ac"></span>DeepSeek Account</div><span>已登录</span></div>
  <div class="provider"><div><span class="dot" style="background:#22c55e"></span>WorkBuddy 池 (wb2api)</div><span>55 个模型</span></div>

  <section class="dbl-card">
    <div class="dbl-top"><h3 class="dbl-title">双脑模型</h3><p class="dbl-status dbl-status-ok">已保存，下一次 delegate 调用就生效</p></div>
    <p class="dbl-desc">主脑派活时用的两个子模型：规划脑出框架，执行脑动手。列表与对话里的模型选择器同源。主脑自己仍用上方模型选择器。</p>
    <div class="dbl-grid">
      <div class="dbl-brain">
        <div class="dbl-brain-hd"><span class="dbl-brain-name">规划脑</span></div>
        <p class="dbl-brain-hint">出框架、拆步骤，主脑用 delegate(mode="plan") 调它；这一步不动手，只给步骤清单和风险。</p>
        <button type="button" class="dbl-trigger"><span class="dbl-trigger-body"><span class="dbl-trigger-main">Kimi-K3</span><span class="dbl-trigger-meta">WorkBuddy 池 (wb2api)</span></span><span class="dbl-chev"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5 8 10 11.5 6.5"/></svg></span></button>
        <div class="dbl-effort"><span class="dbl-effort-label">推理强度</span><select class="dbl-select"><option>默认</option><option>high</option></select></div>
      </div>
      <div class="dbl-brain">
        <div class="dbl-brain-hd"><span class="dbl-brain-name">执行脑</span></div>
        <p class="dbl-brain-hint">按框架动手。</p>
        <button type="button" class="dbl-trigger dbl-trigger-empty"><span class="dbl-trigger-body"><span class="dbl-trigger-main">未选择</span><span class="dbl-trigger-meta">点击选择渠道与模型</span></span><span class="dbl-chev"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5 8 10 11.5 6.5"/></svg></span></button>
        <div class="dbl-effort"><span class="dbl-effort-label">推理强度</span><select class="dbl-select"><option>默认</option></select></div>

        <div class="dbl-menu" style="width:340px">
          <div class="dbl-search-row"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7.2 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z"/><path d="M10.4 10.4 13 13"/></svg><input class="dbl-search" placeholder="搜索渠道或模型" value=""></div>
          <div class="dbl-list" style="max-height:250px">
            <div class="dbl-group-title">WorkBuddy 池 (wb2api)</div>
            <button type="button" class="dbl-item" data-current="1"><span class="dbl-item-name">Kimi-K3</span><span class="dbl-item-id">cn:kimi-k3-1</span><span class="dbl-item-check"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.4 6.6 11.4 12.5 4.8"/></svg></span></button>
            <button type="button" class="dbl-item"><span class="dbl-item-name">GLM-5.3</span><span class="dbl-item-id">cn:glm-5.3</span><span class="dbl-item-check"></span></button>
            <button type="button" class="dbl-item"><span class="dbl-item-name">Deepseek-V4.1-Flash</span><span class="dbl-item-id">cn:deepseek-v4.1-flash</span><span class="dbl-item-check"></span></button>
            <div class="dbl-group-title">DeepSeek</div>
            <button type="button" class="dbl-item"><span class="dbl-item-name">DeepSeek-V4.1-Flash</span><span class="dbl-item-id">deepseek-flash</span><span class="dbl-item-check"></span></button>
            <div class="dbl-clear-sep"></div>
            <button type="button" class="dbl-item dbl-clear"><span class="dbl-item-name">清空这个脑的模型</span></button>
          </div>
        </div>
      </div>
    </div>
    <div class="dbl-foot">
      <button type="button" class="dbl-btn">保存</button>
      <button type="button" class="dbl-btn dbl-btn-ghost">重新读取</button>
    </div>
    <p class="dbl-path">配置文件 · C:\\Users\\LIU\\.dsh\\dual-brain.json</p>
  </section>
</div>
<script>
  window.addEventListener('load', function () {
    var out = { width: window.innerWidth, triggers: [], hints: [], efforts: [] };
    document.querySelectorAll('.dbl-trigger').forEach(function (el) {
      var r = el.getBoundingClientRect();
      out.triggers.push({ top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) });
    });
    document.querySelectorAll('.dbl-brain-hint').forEach(function (el) {
      out.hints.push(Math.round(el.getBoundingClientRect().height));
    });
    document.querySelectorAll('.dbl-effort').forEach(function (el) {
      out.efforts.push(Math.round(el.getBoundingClientRect().top));
    });
    var pre = document.createElement('pre');
    pre.id = 'measure';
    pre.textContent = 'MEASURE ' + JSON.stringify(out);
    document.body.appendChild(pre);
  });
</script>
</body></html>`;

fs.writeFileSync(new URL('./_preview.html', import.meta.url), html, 'utf8');
console.log('wrote _preview.html', html.length, 'bytes; css bytes', captured.length);
