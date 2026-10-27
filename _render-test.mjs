// Offline render test: no real React. A minimal shim executes the component
// functions and walks the returned element tree, so a crash in the render path
// shows up here instead of in the browser.
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8');

let definition = null;
const sandbox = {
  window: {
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: { load: (def) => { definition = def; } },
  },
  document: {
    baseURI: 'http://127.0.0.1:19387/',
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ dataset: {}, style: {}, appendChild() {} }),
    head: { appendChild() {} },
  },
  console,
  URL,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js', global: sandbox });
if (definition === null) throw new Error('client.js did not register a module');

let hookQueue = [];
const queue = (values) => { hookQueue = values.slice(); };

const react = {
  createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true);
    const merged = Object.assign({}, props ?? {});
    if (flat.length === 1) merged.children = flat[0];
    else if (flat.length > 1) merged.children = flat;
    return { type, props: merged };
  },
  useState(initial) {
    if (hookQueue.length > 0) {
      const pre = hookQueue.shift();
      if (pre !== undefined) return [pre.value !== undefined ? pre.value : initial, () => {}];
    }
    return [initial, () => {}];
  },
  useMemo(fn) { return fn(); },
  useRef(initial) { return { current: initial ?? null }; },
  useEffect() {},
  Component: class {
    constructor(props) { this.props = props ?? {}; this.state = {}; }
    setState(next) { this.state = Object.assign({}, this.state, typeof next === 'function' ? next(this.state) : next); }
  },
};

const mod = definition.factory((name) => {
  if (name === 'react') return react;
  throw new Error('unexpected require: ' + name);
});

const registered = [];
mod.apply({
  slots: {
    inject(_name, callback) { callback(); },
    register(entry, component) { registered.push({ entry, component }); },
  },
  logger: { info() {} },
});
console.log('registered slots:', registered.map((r) => r.entry.name).join(', '));

function renderText(node, out) {
  if (node === null || node === undefined || node === false || node === true) return;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return; }
  if (Array.isArray(node)) { for (const child of node) renderText(child, out); return; }
  const type = node.type;
  if (typeof type === 'function') {
    if (type.prototype && typeof type.prototype.render === 'function') {
      const instance = new type(node.props);
      instance.props = node.props;
      renderText(instance.render(), out);
      return;
    }
    renderText(type(node.props), out);
    return;
  }
  for (const child of [].concat(node.props.children ?? [])) renderText(child, out);
}

function mount(componentOrElement, props) {
  const element = componentOrElement && componentOrElement.type
    ? componentOrElement
    : react.createElement(componentOrElement, props);
  const text = [];
  renderText(element, text);
  return text.join(' | ');
}

function collectAttr(node, name, out) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) collectAttr(child, name, out); return; }
  if (node.props && node.props[name] !== undefined) out.push(String(node.props[name]));
  const type = node.type;
  if (typeof type === 'function') {
    if (type.prototype && typeof type.prototype.render === 'function') {
      const instance = new type(node.props);
      instance.props = node.props;
      collectAttr(instance.render(), name, out);
      return;
    }
    collectAttr(type(node.props), name, out);
    return;
  }
  for (const child of [].concat(node.props?.children ?? [])) collectAttr(child, name, out);
}

const providers = [
  { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] },
  { id: 'wbpool', name: 'WorkBuddy 池 (wb2api)', models: [{ id: 'cn:glm-5.3', name: 'GLM-5.3' }, { id: 'cn:kimi-k3-1', name: 'Kimi-K3' }] },
];

const Card = registered[0].component;
const loadedConfig = {
  plan: { provider: '', model: '', reasoningEffort: '' },
  exec: { provider: 'wbpool', model: 'cn:kimi-k3-1', reasoningEffort: 'high' },
};

const closedHooks = [
  { value: loadedConfig },
  { value: providers },
  { value: '' },
  { value: false },
  { value: null },
  { value: 'C:/Users/LIU/.dsh/dual-brain.json' },
];
queue(closedHooks);
const closed = mount(Card, {});
console.log('--- closed ---');
console.log(closed);

const openHooks = [
  { value: loadedConfig },
  { value: providers },
  { value: '' },
  { value: false },
  { value: null },
  { value: '' },
  { value: true },
  { value: 'kimi' },
];
queue(openHooks);
const open = mount(Card, {});
console.log('--- open (query=kimi) ---');
console.log(open);

// 属性要在同一次渲染里取：collectAttr 会重新执行组件，所以重放一次 hook 队列。
queue(openHooks);
const placeholders = [];
collectAttr(react.createElement(Card, {}), 'placeholder', placeholders);

queue(closedHooks);
const classNames = [];
collectAttr(react.createElement(Card, {}), 'className', classNames);
const triggerCount = classNames.filter((value) => /^dbl-trigger(\s|$)/.test(String(value))).length;

const checks = [
  ['trigger empty state', closed.includes('未选择')],
  ['trigger shows channel', closed.includes('WorkBuddy 池 (wb2api)')],
  ['both brains render', closed.includes('规划脑') && closed.includes('执行脑')],
  ['effort labelled', closed.includes('推理强度')],
  ['search placeholder', placeholders.indexOf('搜索渠道或模型') !== -1],
  ['group header', open.includes('WorkBuddy 池 (wb2api)')],
  ['kimi row present', open.includes('Kimi-K3')],
  ['glm filtered out', !open.includes('GLM-5.3')],
  ['check mark for current', open.includes('Kimi-K3') && closed.includes('Kimi-K3')],
  ['two triggers only', triggerCount === 2],
  ['hints present', closed.includes('出框架、拆步骤') && closed.includes('按框架动手')],
];
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}
if (failed > 0) process.exitCode = 1;
