// 比較新舊出入口資料，輸出 Markdown 摘要（給自動更新的 PR 說明用）。
//
//   node scripts/diff-ramps.mjs <舊 ramps.geojson> <新 ramps.geojson>

import { readFileSync, existsSync } from 'node:fs';

const load = (p) => new Map(JSON.parse(readFileSync(p, 'utf8')).features.map((f) => [f.properties.id, f.properties]));
const [oldPath, newPath] = process.argv.slice(2);
const before = load(oldPath);
const after = load(newPath);

const added = [...after.values()].filter((p) => !before.has(p.id));
const removed = [...before.values()].filter((p) => !after.has(p.id));
const renamed = [...after.values()].filter((p) => before.has(p.id) && before.get(p.id).title !== p.title);
const link = (p) => `[${p.title}](https://sudosu.tw/taipei-ramp-sim/#${p.id}) \`${p.id}\``;

const lines = [
  '從 OpenStreetMap 重新抓取的道路資料。',
  '',
  `- 出入口：${before.size} → ${after.size}`,
  `- 新增 ${added.length}、消失 ${removed.length}、名稱改變 ${renamed.length}`,
];
if (existsSync('data/drivable.json')) lines.push(`- 可自動試開：${Object.keys(JSON.parse(readFileSync('data/drivable.json', 'utf8'))).length} 個（詳見 docs/drivable-report.md）`);
if (added.length) lines.push('', '### 新增', ...added.map((p) => `- ${link(p)}`));
if (removed.length) lines.push('', '### 消失', '', '可能是道路改建，也可能是 OSM 資料被改壞了，請到現場或街景確認。', '', ...removed.map((p) => `- ${p.title} \`${p.id}\``));
if (renamed.length) lines.push('', '### 名稱改變', ...renamed.map((p) => `- ${before.get(p.id).title} → ${link(p)}`));
lines.push('', '合併前請確認「測試」workflow 通過。');
console.log(lines.join('\n'));
