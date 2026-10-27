// 双脑配置的读写与校验。宿主半侧（HTTP 路由）和 Agent 半侧（delegate 工具）共用。
//
// 存储位置：$DSH_HOME/dual-brain.json，未设置 DSH_HOME 时用 ~/.dsh/dual-brain.json。
// 故意用普通 JSON 文件而不是 settings 命名空间：settings 的服务在 preset 作用域里
// 不保证可见，而文件在两边都能读，代价只是没有自动生成的表单（我们自带 UI）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function configPath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh');
  return path.join(home, 'dual-brain.json');
}

function emptySlot() {
  return { provider: '', model: '', reasoningEffort: '' };
}

export function normalizeSlot(raw) {
  const slot = emptySlot();
  if (raw === null || typeof raw !== 'object') return slot;
  if (typeof raw.provider === 'string') slot.provider = raw.provider.trim();
  if (typeof raw.model === 'string') slot.model = raw.model.trim();
  if (typeof raw.reasoningEffort === 'string') {
    const effort = raw.reasoningEffort.trim();
    slot.reasoningEffort = EFFORTS.indexOf(effort) === -1 ? '' : effort;
  }
  return slot;
}

export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    plan: normalizeSlot(source.plan),
    exec: normalizeSlot(source.exec),
  };
}

/** 读配置；文件不存在或损坏都退回空配置，绝不抛。 */
export function readConfig() {
  const file = configPath();
  try {
    const text = fs.readFileSync(file, 'utf8');
    return normalizeConfig(JSON.parse(text));
  } catch {
    return normalizeConfig(null);
  }
}

/** 原子写配置并回读；失败抛错给调用方显示。 */
export function writeConfig(raw) {
  const config = normalizeConfig(raw);
  const file = configPath();
  const tmp = file + '.tmp-' + process.pid;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return config;
}

/** 一个槽位是否可用于委派。 */
export function slotReady(slot) {
  return Boolean(slot && typeof slot.provider === 'string' && slot.provider !== ''
    && typeof slot.model === 'string' && slot.model !== '');
}

/** 把槽位变成 AgentOptions（reasoningEffort 为空时整字段省略）。 */
export function slotToAgentOptions(slot) {
  const options = { provider: slot.provider, model: slot.model };
  if (slot.reasoningEffort !== '') options.reasoningEffort = slot.reasoningEffort;
  return options;
}

export { EFFORTS };
