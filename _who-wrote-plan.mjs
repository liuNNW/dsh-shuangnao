#!/usr/bin/env node
// 回答一个问题：某次会话里，每一轮请求到底用的是哪个模型？计划模式那段用的是谁？
//
// 数据源：$DSH_HOME/sessions/<workspace>/<session>/session.v4.jsonl.zstd
// 该文件是「多帧 zstd 追加」格式，Node 的 zstdDecompressSync 只解第一帧，
// 所以这里按 magic 扫描切帧、逐帧解压，再按 seq 去重。
//
// 用法：
//   node _who-wrote-plan.mjs                 # 最近写入的会话
//   node _who-wrote-plan.mjs <session 目录或 .zstd 文件>
//   node _who-wrote-plan.mjs --all           # 最近 3 个会话

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function home() {
  const env = process.env.DSH_HOME;
  return env && env.trim() !== '' ? env : path.join(os.homedir(), '.dsh');
}

function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.zstd')) out.push(full);
  }
}

function resolveTargets(argv) {
  const sessionsRoot = path.join(home(), 'sessions');
  const args = argv.filter((a) => !a.startsWith('--'));

  if (args.length > 0) {
    return args.map((a) => {
      const stat = fs.statSync(a);
      if (stat.isDirectory()) {
        const inner = path.join(a, 'session.v4.jsonl.zstd');
        return fs.existsSync(inner) ? inner : a;
      }
      return a;
    });
  }

  const files = [];
  walk(sessionsRoot, files);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const limit = argv.includes('--all') ? 3 : 1;
  return files.slice(0, limit);
}

/** 切帧解压：返回完整 JSONL 文本。 */
function readSession(file) {
  const buf = fs.readFileSync(file);
  const offsets = [];
  let cursor = 0;
  while ((cursor = buf.indexOf(MAGIC, cursor)) !== -1) {
    offsets.push(cursor);
    cursor += MAGIC.length;
  }
  if (offsets.length === 0) return '';

  let text = '';
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
    try {
      text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
      if (!text.endsWith('\n')) text += '\n';
    } catch {
      // 单帧损坏就跳过，别让整次读取失败
    }
  }
  return text;
}

function parseEvents(text) {
  const bySeq = new Map();
  let order = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const key = typeof event.seq === 'number' ? 'seq:' + event.seq : 'ord:' + order;
    order += 1;
    if (!bySeq.has(key)) bySeq.set(key, event);
  }
  return [...bySeq.values()].sort((a, b) => {
    const sa = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });
}

function route(header) {
  const config = header && header.config ? header.config : {};
  const effort = config.reasoningEffort ? ' [' + config.reasoningEffort + ']' : '';
  return String(config.provider ?? '?') + ' / ' + String(config.model ?? '?') + effort;
}

function analyze(file) {
  const events = parseEvents(readSession(file));
  const header = events.find((e) => e.type === 'session');
  console.log('='.repeat(78));
  console.log('session : ' + (header ? header.id : path.basename(path.dirname(file))));
  console.log('cwd     : ' + (header ? header.cwd : '?'));
  console.log('preset  : ' + (header ? header.agentPreset : '?'));
  console.log('file    : ' + file);
  console.log('-'.repeat(78));

  let planActive = false;
  const segments = [];
  let turn = 0;

  for (const event of events) {
    if (event.type === 'plan/mode') {
      planActive = event.data && event.data.active === true;
      console.log('  ' + (planActive ? '[PLAN  ON ] ' : '[PLAN  OFF] ') + 'plan mode ' + (planActive ? 'entered' : 'left') + '  (seq ' + event.seq + ')');
      continue;
    }
    if (event.type === 'turn/start') {
      turn += 1;
      continue;
    }
    if (event.type === 'request/header') {
      const text = route(event.data && event.data.header);
      const reason = event.data && event.data.reason ? event.data.reason : '?';
      const tag = planActive ? 'PLAN' : 'DEFAULT';
      console.log('  turn ' + String(turn).padStart(2, ' ') + '  ' + tag.padEnd(7, ' ') + '  ' + text + '   (' + reason + ')');
      segments.push({ turn, planActive, text });
    }
  }

  console.log('-'.repeat(78));
  const planRoutes = [...new Set(segments.filter((s) => s.planActive).map((s) => s.text))];
  const normalRoutes = [...new Set(segments.filter((s) => !s.planActive).map((s) => s.text))];
  console.log('默认模式下的模型 : ' + (normalRoutes.length === 0 ? '（本会话没有非计划模式的请求）' : normalRoutes.join(' | ')));
  console.log('计划模式下的模型 : ' + (planRoutes.length === 0 ? '（本会话没进过计划模式）' : planRoutes.join(' | ')));
  console.log('');
  console.log('判定：计划模式的请求若与「默认模式」不同，且等于你在面板里选的规划脑，就说明接管生效。');
}

const targets = resolveTargets(process.argv.slice(2));
if (targets.length === 0) {
  console.error('没找到会话日志：' + path.join(home(), 'sessions'));
  process.exit(1);
}
for (const file of targets) analyze(file);
