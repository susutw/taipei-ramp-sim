// 不開瀏覽器，用自動駕駛逐一驗證每個出入口的自動任務、以及手寫任務能不能跑到終點。
//
//   node scripts/check-drivable.mjs
//
// 輸出：data/drivable.json         { 出入口 id: 區域名稱 }，地圖用來顯示「可試開」
//       docs/drivable-report.md    人看的報告：成功率、失敗清單與原因
// 有手寫任務失敗時結束代碼為 1。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { RoadGraph } from '../src/drive/graph.js';
import { planScenario, simulate } from '../src/drive/sim.js';
import { autoScenario } from '../src/drive/auto.js';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ramps = new Map(read('data/ramps.geojson').features.map((f) => [f.properties.id, f.properties]));
const regions = read('data/regions.json');
const forks = existsSync('data/forks.json') ? read('data/forks.json') : {};

const REASON = { fail: '自動駕駛開錯', end: '道路在場景外結束', timeout: '逾時' };
const run = (graph, scenario, opts) => {
  const plan = planScenario(graph, scenario);
  if (!plan) return { ok: false, reason: '找不到路線' };
  const e = simulate(graph, plan, opts);
  return e.type === 'goal' ? { ok: true, steps: plan.steps.length } : { ok: false, reason: `${REASON[e.type]}${e.message ? `：${e.message}` : ''}` };
};

const drivable = {};
const failures = [];
let total = 0;
for (const [name, region] of Object.entries(regions)) {
  const path = `data/scenes/${name}.json`;
  if (!existsSync(path)) {
    for (const id of region.ramps) failures.push({ id, region: name, reason: '場景尚未產生' });
    total += region.ramps.length;
    continue;
  }
  const graph = new RoadGraph(read(path), forks);
  for (const id of region.ramps) {
    total++;
    const ramp = ramps.get(id);
    const res = ramp ? autoScenario(graph, ramp) : { error: '出入口已不存在' };
    const r = res.error ? { ok: false, reason: res.error } : run(graph, res.scenario);
    if (r.ok) drivable[id] = name;
    else failures.push({ id, region: name, reason: r.reason });
  }
}

// 手寫任務：無車與塞車（三個亂數種子）都要能開完，避免路線被設計成根本切不進去
const manual = [];
for (const s of read('data/scenarios.json')) {
  const graph = new RoadGraph(read(`data/scenes/${s.scene}.json`), forks);
  manual.push({ id: s.id, ...run(graph, s) });
  for (const seed of [1, 2, 3]) {
    const r = run(graph, s, { traffic: 'jam', seed });
    manual.push({ id: `${s.id}（塞車 #${seed}）`, ...r });
  }
}

writeFileSync('data/drivable.json', JSON.stringify(drivable, null, 1));

const okCount = Object.keys(drivable).length;
const pct = Math.round((okCount / total) * 100);
const titleOf = (id) => ramps.get(id)?.title ?? id;
const byReason = new Map();
for (const f of failures) {
  const key = f.reason.split('：')[0];
  byReason.set(key, (byReason.get(key) || 0) + 1);
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/drivable-report.md', `# 自動試開驗證報告

由 \`node scripts/check-drivable.mjs\` 產生，請勿手動編輯。

- 自動任務：**${okCount} / ${total}（${pct}%）** 個出入口可以自動試開
- 手寫任務：${manual.map((m) => `\`${m.id}\` ${m.ok ? '✅' : `❌ ${m.reason}`}`).join('、')}

## 失敗原因統計

| 原因 | 數量 |
|---|---|
${[...byReason].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## 無法自動試開的出入口

| 出入口 | 區域 | 原因 |
|---|---|---|
${failures.map((f) => `| [${titleOf(f.id)}](https://sudosu.tw/taipei-ramp-sim/#${f.id}) \`${f.id}\` | ${f.region} | ${f.reason.replaceAll('|', '／')} |`).join('\n')}
`);

console.log(`自動任務 ${okCount}/${total}（${pct}%）可試開；手寫任務 ${manual.filter((m) => m.ok).length}/${manual.length} 通過`);
for (const [k, v] of byReason) console.log(`  ${k}：${v}`);
for (const m of manual) if (!m.ok) console.log(`  ✗ 手寫任務 ${m.id}：${m.reason}`);
process.exit(manual.every((m) => m.ok) ? 0 : 1);
