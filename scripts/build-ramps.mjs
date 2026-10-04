// 把 Overpass 原始資料整理成網站用的 GeoJSON。
//
//   node scripts/build-ramps.mjs
//
//   node scripts/build-ramps.mjs --surface-query > data/raw/surface.overpassql
//
// 輸入：data/raw/overpass.json（快速道路、國道與匝道）
//       data/raw/surface.json （匝道口相接的平面道路，用來命名；沒有也能跑）
// 輸出：data/ramps.geojson     每個出入口一筆
//       data/mainlines.geojson 快速道路／國道主線
// 完整流程見 scripts/update-data.sh。
//
// 分組規則：相連的 *_link 路段（不經過主線節點）視為同一個出入口。
// 再看它的起點、終點是否接在主線上，判斷是入口、出口或系統匝道。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { alias } from '../src/drive/graph.js';

const raw = JSON.parse(readFileSync('data/raw/overpass.json', 'utf8')).elements;
const isLink = (w) => w.tags.highway.endsWith('_link');

// oneway=-1 的路段把方向轉正，後面一律當成「從頭開到尾」
const ways = raw.map((w) => {
  if (w.tags.oneway !== '-1') return w;
  return { ...w, nodes: [...w.nodes].reverse(), geometry: [...w.geometry].reverse() };
});

const mainlines = ways.filter((w) => !isLink(w));
const links = ways.filter(isLink);

// 節點 → 經過它的主線名稱
const mainlineAt = new Map();
for (const w of mainlines) {
  const name = w.tags.name || w.tags.ref || '未命名主線';
  for (const n of w.nodes) {
    if (!mainlineAt.has(n)) mainlineAt.set(n, new Set());
    mainlineAt.get(n).add(name);
  }
}


// 主線在某節點的行進方位（北向／南向／東向／西向）
const mainlineWaysAt = new Map();
for (const w of mainlines) for (const n of w.nodes) {
  if (!mainlineWaysAt.has(n)) mainlineWaysAt.set(n, []);
  mainlineWaysAt.get(n).push(w);
}
const heading = (node) => {
  const w = mainlineWaysAt.get(node)?.[0];
  if (!w || w.tags.oneway === 'no') return null;
  const i = w.nodes.indexOf(node);
  const a = w.geometry[Math.max(0, i - 1)];
  const b = w.geometry[Math.min(w.nodes.length - 1, i + 1)];
  const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const dy = b.lat - a.lat;
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? '北向' : '南向') : dx > 0 ? '東向' : '西向';
};

// 平面道路：節點 → 道路名稱
const surfaceAt = new Map();
if (existsSync('data/raw/surface.json')) {
  for (const w of JSON.parse(readFileSync('data/raw/surface.json', 'utf8')).elements) {
    if (!w.tags?.name || /link|motorway|trunk/.test(w.tags.highway)) continue;
    for (const n of w.nodes) if (!surfaceAt.has(n)) surfaceAt.set(n, w.tags.name);
  }
}

// 用 union-find 把相連的匝道段串起來，但不穿過主線節點
const parent = new Map(links.map((w) => [w.id, w.id]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
const linksAtNode = new Map();
for (const w of links) {
  for (const n of [w.nodes[0], w.nodes.at(-1)]) {
    if (mainlineAt.has(n)) continue;
    if (!linksAtNode.has(n)) linksAtNode.set(n, []);
    linksAtNode.get(n).push(w.id);
  }
}
for (const ids of linksAtNode.values()) for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));

const groups = new Map();
for (const w of links) {
  const r = find(w.id);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(w);
}

const mostCommon = (arr) => {
  const c = new Map();
  for (const x of arr) if (x) c.set(x, (c.get(x) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const ll = (g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)];

const terminalNodes = new Set();
const features = [];
for (const group of groups.values()) {
  const starts = new Map(); // 節點 → 座標
  const ends = new Map();
  const startCount = new Map();
  const endCount = new Map();
  const twoWay = group.some((w) => w.tags.oneway === 'no');
  for (const w of group) {
    const [a, b] = [w.nodes[0], w.nodes.at(-1)];
    starts.set(a, w.geometry[0]);
    ends.set(b, w.geometry.at(-1));
    startCount.set(a, (startCount.get(a) || 0) + 1);
    endCount.set(b, (endCount.get(b) || 0) + 1);
  }
  // 起點：沒有任何路段在這裡結束；終點：沒有任何路段從這裡出發
  const entries = [...starts].filter(([n]) => !endCount.has(n) || mainlineAt.has(n));
  const exits = [...ends].filter(([n]) => !startCount.has(n) || mainlineAt.has(n));

  for (const [n] of [...entries, ...exits]) if (!mainlineAt.has(n)) terminalNodes.add(n);

  const onMain = (list) => list.filter(([n]) => mainlineAt.has(n));
  const fromMain = onMain(entries);
  const toMain = onMain(exits);
  const namesAt = (list) => [...new Set(list.flatMap(([n]) => [...mainlineAt.get(n)]))];

  let kind;
  if (twoWay) kind = '雙向';
  else if (!fromMain.length && toMain.length) kind = '入口';
  else if (fromMain.length && !toMain.length) kind = '出口';
  else if (fromMain.length && toMain.length) kind = '系統';
  else kind = '其他';

  const from = namesAt(fromMain);
  const to = namesAt(toMain);
  const road = kind === '入口' ? to : kind === '出口' ? from : [...new Set([...from, ...to])];

  // 標點位置：入口標在平面道路上的匝道口；出口和系統匝道標在主線分岔處
  const pointSrc = (kind === '入口' ? entries.find(([n]) => !mainlineAt.has(n)) : fromMain[0]) || entries[0] || [...starts][0];

  const tag = (k) => mostCommon(group.map((w) => w.tags[k]));
  const surface = [...new Set([...entries, ...exits].map(([n]) => surfaceAt.get(n)).filter(Boolean))];
  const dirNode = kind === '入口' ? toMain[0]?.[0] : fromMain[0]?.[0];
  const dir = dirNode ? heading(dirNode) : null;
  const roadLabel = road.map(alias).join('／') || '未知道路';
  // 顯示用標題，例：「建國高架 南向入口（信義路）」
  // 優先用 OSM 匝道名稱裡的路名（「長安東路入口匝道」→「長安東路」），其次是相接的平面道路、出口指引
  const fromName = tag('name')?.match(/^(.+?)(入口|出口)?匝道$/)?.[1];
  const detail = (fromName && !/快速道路|高架/.test(fromName) ? fromName : null) || surface[0] || tag('destination')?.split(';')[0] || null;
  const title = kind === '系統'
    ? `${from.map(alias).join('／')} → ${to.map(alias).join('／')}${dir ? `（${dir}）` : ''}`
    : `${roadLabel} ${dir || ''}${kind}${detail ? `（${detail}）` : ''}`;
  const name = tag('name') || null;
  const lanes = Math.max(0, ...group.map((w) => +w.tags.lanes || 0)) || null;
  const id = `r${Math.min(...group.map((w) => w.id))}`;

  features.push({
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: group.map((w) => w.geometry.map(ll)) },
    properties: {
      id,
      title,
      name,
      kind,
      dir,
      surface,
      road,
      from,
      to,
      lanes,
      destination: tag('destination') || null,
      layer: tag('layer') || null,
      point: ll(pointSrc[1]),
      ways: group.map((w) => w.id),
    },
  });
}

if (process.argv.includes('--surface-query')) {
  // 產生查詢：抓所有匝道端點所在的平面道路
  console.log(`[out:json][timeout:120];\nnode(id:${[...terminalNodes].join(',')});\nway(bn)["highway"];\nout body;`);
  process.exit(0);
}

// 套用人工修正（data/overrides/ramps.json）
if (existsSync('data/overrides/ramps.json')) {
  const overrides = JSON.parse(readFileSync('data/overrides/ramps.json', 'utf8'));
  for (const f of features) {
    const o = overrides[f.properties.id];
    if (!o) continue;
    for (const k of ['title', 'kind', 'dir', 'note']) if (o[k] !== undefined) f.properties[k] = o[k];
    if (o.hide) f.properties.hidden = true;
  }
  for (let i = features.length - 1; i >= 0; i--) if (features[i].properties.hidden) features.splice(i, 1);
}

features.sort((a, b) => (a.properties.road[0] || '').localeCompare(b.properties.road[0] || '') || a.properties.title.localeCompare(b.properties.title));

const mainlineFeatures = mainlines.map((w) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: w.geometry.map(ll) },
  properties: {
    name: w.tags.name || w.tags.ref || null,
    highway: w.tags.highway,
    elevated: w.tags.bridge === 'yes' || +w.tags.layer > 0,
  },
}));

writeFileSync('data/ramps.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
writeFileSync('data/mainlines.geojson', JSON.stringify({ type: 'FeatureCollection', features: mainlineFeatures }));

const count = (k) => features.filter((f) => f.properties.kind === k).length;
console.log(`出入口 ${features.length} 個：入口 ${count('入口')}、出口 ${count('出口')}、系統 ${count('系統')}、雙向 ${count('雙向')}、其他 ${count('其他')}`);
console.log(`主線路段 ${mainlineFeatures.length} 條`);
