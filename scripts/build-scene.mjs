// 把某個區域的 OSM 道路與建物轉成 3D 試開用的場景檔。
//
//   node scripts/build-scene.mjs jianguo
//
// 輸入：data/raw/scene-<name>.json（用 data/raw/scene-<name>.overpassql 抓）
// 輸出：data/scenes/<name>.json
//
// 場景檔內容（座標單位為公尺，x 向東、y 向北、h 為高度）：
//   nodes:     [x, y, h, x, y, h, ...]
//   nodeIds:   每個節點對應的 OSM node id（任務設定用來指定起點）
//   ways:      { wayId: 道路屬性 }
//   edges:     [{ w: wayId, n: [節點索引...] }]，已在路口切開
//   buildings: [{ h: 高度, p: [x, y, x, y, ...] }]
//
// 高度推算（OSM 只有上下層關係，沒有實際高度，所以是估計值）：
//   1. 高架主線（bridge 或 layer>0）固定在 layer × LEVEL_HEIGHT
//   2. 平面道路固定在 0，地下道固定在 TUNNEL_DEPTH
//   3. 離高架超過 GROUND_AFTER 公尺的平面主線段固定在 0
//   4. 其他節點（匝道、引道）用鄰點距離加權平均反覆平滑，產生連續坡度

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const LEVEL_HEIGHT = 8;
const TUNNEL_DEPTH = -7;
const GROUND_AFTER = 150;

const name = process.argv[2];
if (!name) {
  console.error('用法：node scripts/build-scene.mjs <場景名稱>');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(`data/raw/scene-${name}.json`, 'utf8')).elements;

const roads = raw.filter((e) => e.tags?.highway && e.geometry);
const buildingsRaw = raw.filter((e) => e.tags?.building && e.geometry);

// 以所有道路座標的中心當原點
const lats = roads.flatMap((w) => w.geometry.map((g) => g.lat));
const lons = roads.flatMap((w) => w.geometry.map((g) => g.lon));
const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
const ky = 110540;
const toXY = (g) => [(g.lon - lon0) * kx, (g.lat - lat0) * ky];

const isLink = (w) => w.tags.highway.endsWith('_link');
const isMain = (w) => /^(motorway|trunk)$/.test(w.tags.highway);
const layerOf = (w) => +w.tags.layer || 0;
const isTunnel = (w) => w.tags.tunnel === 'yes' || w.tags.tunnel === 'building_passage' || layerOf(w) < 0;
const isElevated = (w) => !isTunnel(w) && (w.tags.bridge === 'yes' || layerOf(w) > 0) && !isLink(w);

// ---- 節點 ----
const index = new Map(); // osm node id → 索引
const pos = [];
const nodeWays = [];
for (const w of roads) {
  w.nodes.forEach((id, i) => {
    if (!index.has(id)) {
      index.set(id, pos.length);
      pos.push(toXY(w.geometry[i]));
      nodeWays.push([]);
    }
    nodeWays[index.get(id)].push(w);
  });
}
const N = pos.length;
const dist = (a, b) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);

// ---- 鄰接 ----
const nbrs = Array.from({ length: N }, () => []);
for (const w of roads) {
  for (let i = 1; i < w.nodes.length; i++) {
    const a = index.get(w.nodes[i - 1]);
    const b = index.get(w.nodes[i]);
    nbrs[a].push(b);
    nbrs[b].push(a);
  }
}

// ---- 高度 ----
const h = new Float64Array(N);
const fixed = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const ws = nodeWays[i];
  const elevated = ws.filter(isElevated);
  if (elevated.length) {
    h[i] = LEVEL_HEIGHT * Math.max(1, ...elevated.map(layerOf));
    fixed[i] = 1;
  } else if (ws.some(isTunnel) && !ws.some(isLink)) {
    h[i] = TUNNEL_DEPTH;
    fixed[i] = 1;
  } else if (ws.some((w) => !isLink(w) && !isMain(w))) {
    fixed[i] = 1; // 平面道路
  }
}

// 離高架夠遠的平面主線段視為地面
const fromElevated = new Float64Array(N).fill(Infinity);
const queue = [];
for (let i = 0; i < N; i++) if (fixed[i] && h[i] > 0) { fromElevated[i] = 0; queue.push(i); }
while (queue.length) {
  // 節點數不多，用簡單的反覆鬆弛代替優先佇列
  const a = queue.shift();
  for (const b of nbrs[a]) {
    const d = fromElevated[a] + dist(a, b);
    if (d < fromElevated[b]) { fromElevated[b] = d; queue.push(b); }
  }
}
for (let i = 0; i < N; i++) {
  if (!fixed[i] && nodeWays[i].every(isMain) && fromElevated[i] > GROUND_AFTER) fixed[i] = 1;
}

for (let iter = 0; iter < 2000; iter++) {
  let delta = 0;
  for (let i = 0; i < N; i++) {
    if (fixed[i] || !nbrs[i].length) continue;
    let sw = 0;
    let s = 0;
    for (const j of nbrs[i]) {
      const wgt = 1 / Math.max(dist(i, j), 1);
      sw += wgt;
      s += wgt * h[j];
    }
    const v = s / sw;
    delta = Math.max(delta, Math.abs(v - h[i]));
    h[i] = v;
  }
  if (delta < 0.001) break;
}

// ---- 在路口切開道路 ----
const degree = new Map();
for (const w of roads) for (const id of w.nodes) degree.set(id, (degree.get(id) || 0) + 1);
// 同一條路首尾相接（環狀）時，首尾節點也算路口
const edges = [];
for (const w of roads) {
  let cur = [index.get(w.nodes[0])];
  for (let i = 1; i < w.nodes.length; i++) {
    cur.push(index.get(w.nodes[i]));
    const last = i === w.nodes.length - 1;
    if (last || degree.get(w.nodes[i]) > 1) {
      edges.push({ w: w.id, n: cur });
      cur = [index.get(w.nodes[i])];
    }
  }
}

// ---- 道路屬性 ----
const num = (v) => (v === undefined ? undefined : parseInt(v, 10) || undefined);
const ways = {};
for (const w of roads) {
  const t = w.tags;
  ways[w.id] = {
    name: t.name || t.ref || '',
    hw: t.highway,
    oneway: t.oneway === 'yes' || t.oneway === '1' || (t.oneway === undefined && (t.highway === 'motorway' || t.highway === 'motorway_link' || t.junction === 'roundabout')) ? 1 : t.oneway === '-1' ? -1 : 0,
    lanes: num(t.lanes),
    lanesF: num(t['lanes:forward']),
    lanesB: num(t['lanes:backward']),
    bridge: t.bridge === 'yes' ? 1 : 0,
    tunnel: isTunnel(w) ? 1 : 0,
    layer: layerOf(w),
    dest: t.destination || undefined,
    turnLanes: t['turn:lanes'] || undefined,
    turnLanesF: t['turn:lanes:forward'] || undefined,
    turnLanesB: t['turn:lanes:backward'] || undefined,
    destLanes: t['destination:lanes'] || undefined,
  };
}

// ---- 建物 ----
const meters = (v) => {
  const m = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(m) ? m : undefined;
};
const buildings = buildingsRaw
  .filter((b) => b.geometry.length >= 4)
  .map((b) => {
    const t = b.tags;
    const height = meters(t.height) || (meters(t['building:levels']) ? meters(t['building:levels']) * 3.2 : 9);
    const pts = b.geometry.slice(0, -1).flatMap((g) => toXY(g).map((v) => Math.round(v * 10) / 10));
    return { h: Math.round(height * 10) / 10, p: pts };
  });

const r1 = (v) => Math.round(v * 10) / 10;
const out = {
  name,
  origin: [lon0, lat0],
  nodes: pos.flatMap(([x, y], i) => [r1(x), r1(y), r1(h[i])]),
  nodeIds: [...index.keys()],
  ways,
  edges,
  buildings,
};
mkdirSync('data/scenes', { recursive: true });
writeFileSync(`data/scenes/${name}.json`, JSON.stringify(out));
console.log(`場景 ${name}：節點 ${N}、路段 ${edges.length}、建物 ${buildings.length}`);
