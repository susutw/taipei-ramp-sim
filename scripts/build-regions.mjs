// 把出入口依位置分成幾個區域，每個區域產生一個 3D 場景。
//
//   node scripts/build-regions.mjs
//
// 輸入：data/ramps.geojson
// 輸出：data/regions.json                    { 區域名稱: { label, bbox: [南, 西, 北, 東], ramps: [出入口 id] } }
//       data/raw/scene-<區域>.overpassql      各區域的 Overpass 查詢
//
// 分群方式：每個出入口外擴 MARGIN 公尺（讓起點有足夠的引道），
// 依序併入「合併後範圍最小」且不超過 MAX_SIZE 的區域，否則開新區域。

import { readFileSync, writeFileSync } from 'node:fs';
import { alias } from '../src/drive/graph.js';

const MARGIN = 550;
const MAX_SIZE = 2600;
const KINDS = new Set(['入口', '出口', '系統']);

const ramps = JSON.parse(readFileSync('data/ramps.geojson', 'utf8')).features.filter((f) => KINDS.has(f.properties.kind));

const lat0 = 25.05;
const mx = Math.cos((lat0 * Math.PI) / 180) * 111320;
const my = 110540;

// 以公尺為單位的外框 [西, 南, 東, 北]
const boxOf = (f) => {
  const pts = f.geometry.coordinates.flat();
  const xs = pts.map(([lon]) => lon * mx);
  const ys = pts.map(([, lat]) => lat * my);
  return [Math.min(...xs) - MARGIN, Math.min(...ys) - MARGIN, Math.max(...xs) + MARGIN, Math.max(...ys) + MARGIN];
};
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
const fits = (b) => b[2] - b[0] <= MAX_SIZE && b[3] - b[1] <= MAX_SIZE;

// 從西到東、從南到北依序處理，結果穩定
const items = ramps.map((f) => ({ f, box: boxOf(f) })).sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1]);
const regions = [];
for (const it of items) {
  let best = null;
  let bestCost = Infinity;
  for (const r of regions) {
    const u = union(r.box, it.box);
    if (!fits(u)) continue;
    const cost = area(u) - area(r.box);
    if (cost < bestCost) {
      best = r;
      bestCost = cost;
    }
  }
  if (best) {
    best.box = union(best.box, it.box);
    best.items.push(it);
  } else {
    regions.push({ box: it.box, items: [it] });
  }
}

// 太大的單一出入口（例如長系統匝道）也照樣獨立成一區
const out = {};
regions
  .sort((a, b) => b.items.length - a.items.length)
  .forEach((r, i) => {
    const name = `area-${String(i + 1).padStart(2, '0')}`;
    const roads = new Map();
    for (const { f } of r.items) for (const road of f.properties.road) if (road !== '未命名主線') roads.set(road, (roads.get(road) || 0) + 1);
    const label = [...roads].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => alias(n)).join('、');
    const [w, s, e, n] = r.box;
    const bbox = [s / my, w / mx, n / my, e / mx].map((v) => +v.toFixed(5));
    out[name] = { label, bbox, ramps: r.items.map(({ f }) => f.properties.id) };
    writeFileSync(`data/raw/scene-${name}.overpassql`, `[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](${bbox.join(',')});
  way["building"](${bbox.join(',')});
);
out body geom;
`);
  });

writeFileSync('data/regions.json', JSON.stringify(out, null, 1));
const sizes = Object.values(out).map((r) => r.ramps.length);
console.log(`${ramps.length} 個出入口分成 ${sizes.length} 區：${sizes.join(', ')}`);
for (const [name, r] of Object.entries(out)) console.log(`  ${name}：${r.label}（${r.ramps.length}）`);
