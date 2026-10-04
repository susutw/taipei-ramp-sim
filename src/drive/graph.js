// 路網：把場景檔的路段轉成有方向的邊，並處理「在岔路依車道決定去向」。
//
// 車道編號一律由左往右，0 是最左側（內側）車道。
// 橫向偏移量以行進方向的右側為正，單位公尺。

export const LANE_W = 3.3;

// 一般人習慣的叫法（地圖與 3D 共用）
const ALIAS = {
  建國快速道路: '建國高架',
  市民大道高架道路: '市民高架',
  新生高架道路: '新生高架',
  基隆路高架道路: '基隆路高架',
  中山高速公路: '國道1號',
  福爾摩沙高速公路: '國道3號',
  汐止五股高架道路: '國1汐五高架',
  台北聯絡線: '國3甲',
};
export const alias = (n) => ALIAS[n] || n;

export const isLink = (way) => way.hw.endsWith('_link');
export const isMajor = (way) => /^(motorway|trunk)(_link)?$/.test(way.hw);

const DEFAULT_LANES = { motorway: 3, trunk: 2, primary: 2, secondary: 2, tertiary: 1, unclassified: 1, residential: 1 };

function lanesFor(way, dir) {
  if (way.oneway) return way.lanes || (isLink(way) ? 1 : DEFAULT_LANES[way.hw] || 1);
  const own = dir === 1 ? way.lanesF : way.lanesB;
  if (own) return own;
  if (way.lanes) return Math.max(1, Math.floor(way.lanes / 2));
  return isLink(way) ? 1 : DEFAULT_LANES[way.hw] || 1;
}

// 角度差，結果在 -π..π，正值代表往左
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const U_TURN = 1.75; // 超過約 100° 視為迴轉，不列入選項

// turn:lanes 的值 → 左（L）、直行（T）、右（R）
const TURN_SIDE = {
  left: 'L', slight_left: 'L', sharp_left: 'L', merge_to_left: 'L',
  right: 'R', slight_right: 'R', sharp_right: 'R', merge_to_right: 'R',
  through: 'T', none: 'T', '': 'T',
};

// 依 OSM turn:lanes（例：「through|through;slight_right|slight_right」）算出每個去向可走的車道範圍。
// opts 已由左到右排序；左轉值對應最左的去向、右轉值對應最右的去向、直行對應 throughIdx。
// 共用車道（through;slight_right）會讓兩個去向的範圍重疊。任一去向沒有車道時回傳 null。
export function lanesFromTurnLanes(value, count, throughIdx) {
  const ranges = Array.from({ length: count }, () => [Infinity, -Infinity]);
  value.split('|').forEach((lane, i) => {
    for (const t of lane.split(';')) {
      const side = TURN_SIDE[t.trim()];
      if (!side) continue;
      const j = side === 'L' ? 0 : side === 'R' ? count - 1 : throughIdx;
      ranges[j][0] = Math.min(ranges[j][0], i);
      ranges[j][1] = Math.max(ranges[j][1], i + 1);
    }
  });
  return ranges.every(([a]) => a !== Infinity) ? ranges : null;
}

export class RoadGraph {
  // forks：data/forks.json 的人工校對資料
  constructor(scene, forks = {}) {
    this.P = scene.nodes;
    this.nodeIds = scene.nodeIds;
    this.forks = forks;
    this.ways = scene.ways;
    this.nodeIndex = new Map(scene.nodeIds.map((id, i) => [id, i]));
    this.edges = [];
    const count = scene.nodeIds.length;
    this.out = Array.from({ length: count }, () => []);
    this.in = Array.from({ length: count }, () => []);
    this.dirEdge = new Map(); // "場景路段索引:方向" → 有向邊
    this.wayFirst = new Map(); // way id → 第一個節點（turn:lanes 只描述道路終點的車道）
    this.wayLast = new Map();
    for (const e of scene.edges) {
      if (!this.wayFirst.has(e.w)) this.wayFirst.set(e.w, e.n[0]);
      this.wayLast.set(e.w, e.n.at(-1));
    }

    scene.edges.forEach((e, ei) => {
      const way = scene.ways[e.w];
      const dirs = way.oneway === 1 ? [1] : way.oneway === -1 ? [-1] : [1, -1];
      for (const d of dirs) {
        const pts = d === 1 ? e.n : [...e.n].reverse();
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(this.x(pts[i]) - this.x(pts[i - 1]), this.y(pts[i]) - this.y(pts[i - 1])));
        }
        const D = { id: this.edges.length, ei, w: e.w, way, d, pts, cum, len: cum.at(-1), twoWay: !way.oneway, lanes: lanesFor(way, d) };
        if (D.len < 0.01) continue;
        this.edges.push(D);
        this.dirEdge.set(`${ei}:${d}`, D);
        this.out[pts[0]].push(D);
        this.in[pts.at(-1)].push(D);
      }
    });
    this._branches = new Map();
  }

  x(i) { return this.P[i * 3]; }
  y(i) { return this.P[i * 3 + 1]; }
  h(i) { return this.P[i * 3 + 2]; }

  // 在邊上距離起點 s 公尺處的位置與切線方向
  sample(D, s) {
    s = Math.min(Math.max(s, 0), D.len);
    let i = 1;
    while (i < D.cum.length - 1 && D.cum[i] < s) i++;
    const a = D.pts[i - 1];
    const b = D.pts[i];
    const seg = D.cum[i] - D.cum[i - 1] || 1;
    const t = (s - D.cum[i - 1]) / seg;
    const tx = (this.x(b) - this.x(a)) / seg;
    const ty = (this.y(b) - this.y(a)) / seg;
    return { x: this.x(a) + (this.x(b) - this.x(a)) * t, y: this.y(a) + (this.y(b) - this.y(a)) * t, h: this.h(a) + (this.h(b) - this.h(a)) * t, tx, ty };
  }

  // 邊在起點或終點附近（約 15 m）的平均方位角
  heading(D, atEnd) {
    const p = atEnd ? this.sample(D, D.len - 15) : this.sample(D, 0);
    const q = atEnd ? this.sample(D, D.len) : this.sample(D, 15);
    return Math.atan2(q.y - p.y, q.x - p.x);
  }

  turn(from, to) {
    return wrap(this.heading(to, false) - this.heading(from, true));
  }

  // 第 lane 車道（可為小數）中心相對道路中心線的右向偏移
  laneOffset(D, lane) {
    if (D.twoWay) return 0.2 + (lane + 0.5) * LANE_W;
    return (lane - (D.lanes - 1) / 2) * LANE_W;
  }

  // 邊終點的所有合法去向（不含迴轉）
  candidates(D) {
    const node = D.pts.at(-1);
    return this.out[node].filter((c) => !(c.ei === D.ei && c.d !== D.d));
  }

  // 岔路代碼：「來向 way id@分岔點 node id」，對應 data/forks.json 的鍵
  forkKey(D) {
    return `${D.w}@${this.nodeIds[D.pts.at(-1)]}`;
  }

  // D 終點的 turn:lanes（只有 D 開到道路終點時才適用）
  turnLanesAt(D) {
    const end = D.d === 1 ? this.wayLast.get(D.w) : this.wayFirst.get(D.w);
    if (D.pts.at(-1) !== end) return null;
    const v = D.way.oneway ? D.way.turnLanes : D.d === 1 ? D.way.turnLanesF : D.way.turnLanesB;
    return v && v.split('|').length === D.lanes ? v : null;
  }

  // 在 D 的終點，駕駛會面臨的選項，以及每個選項對應的車道範圍 [a, b)。
  // 只有一個選項時不需要駕駛決定（路口直行、路段接續）。
  // 車道範圍的來源（src）優先順序：data/forks.json 人工校對 > OSM turn:lanes > 依車道數推算。
  // 共用車道時，不同去向的範圍可能重疊。
  branches(D) {
    if (this._branches.has(D.id)) return this._branches.get(D.id);
    const cands = this.candidates(D).filter((c) => Math.abs(this.turn(D, c)) < U_TURN);
    const straightest = (list) => list.reduce((best, c) => (!best || Math.abs(this.turn(D, c)) < Math.abs(this.turn(D, best)) ? c : best), null);

    let opts;
    if (isMajor(D.way)) {
      // 快速道路上：只有匝道與主線的分岔需要選，下到平面道路後自動直行
      opts = cands.filter((c) => isMajor(c.way));
      if (!opts.length) opts = cands.length ? [straightest(cands)] : [];
    } else {
      // 平面道路上：一般路口自動直行，只有遇到匝道口才需要選
      const surface = cands.filter((c) => !isMajor(c.way));
      const ramps = cands.filter((c) => isMajor(c.way));
      const through = straightest(surface);
      opts = [...ramps];
      if (through && (Math.abs(this.turn(D, through)) < 1.0 || !ramps.length)) opts.push(through);
    }

    opts.sort((p, q) => this.turn(D, q) - this.turn(D, p)); // 由左到右
    const n = D.lanes;
    let result;
    const through = straightest(opts);
    if (opts.length <= 1) {
      result = opts.map((edge) => ({ edge, a: 0, b: n, through: true, src: '推算' }));
    } else {
      const k = opts.length;
      const need = opts.map((o) => (o === through ? 0 : Math.min(o.lanes, Math.max(1, n - (k - 1)))));
      const side = need.reduce((s, v) => s + v, 0);
      if (side < n) {
        need[opts.indexOf(through)] = n - side;
        let a = 0;
        result = opts.map((edge, j) => ({ edge, a, b: (a += need[j]), through: edge === through, src: '推算' }));
      } else {
        // 車道不夠分（例如單車道匝道再分岔）：平均分配，必要時共用
        result = opts.map((edge, j) => {
          let a = Math.floor((j * n) / k);
          let b = Math.floor(((j + 1) * n) / k);
          if (b <= a) { a = Math.min(j, n - 1); b = a + 1; }
          return { edge, a, b, through: edge === through, src: '推算' };
        });
      }
      const tl = this.turnLanesAt(D);
      const ranges = tl && lanesFromTurnLanes(tl, k, opts.indexOf(through));
      if (ranges) {
        result.forEach((r, j) => {
          [r.a, r.b] = ranges[j];
          r.src = 'turn:lanes';
        });
      }
    }
    const fork = this.forks[this.forkKey(D)];
    if (fork?.branches) {
      for (const r of result) {
        const lanes = fork.branches[r.edge.w]?.lanes;
        if (lanes) {
          r.a = Math.max(0, lanes[0] - 1);
          r.b = Math.min(n, lanes[1]);
          r.src = '人工校對';
        }
      }
    }
    this._branches.set(D.id, result);
    return result;
  }

  // 從 D 換到 next 後，原本第 lane 車道會落在新路段的哪一條車道
  laneAfter(D, branch, lane) {
    const next = branch.edge;
    const span = branch.b - branch.a;
    const rel = Math.min(Math.max(lane - branch.a, 0), span - 1);
    let out = rel;
    if (next.lanes > span) {
      // 匯入：從右側匯入就接最右側車道
      const others = this.in[next.pts[0]].filter((m) => m !== D && isMajor(m.way) === isMajor(D.way));
      if (others.length && wrap(this.heading(D, true) - this.heading(others[0], true)) > 0) out = next.lanes - span + rel;
    }
    return Math.min(Math.max(out, 0), next.lanes - 1);
  }

  // 匝道或道路的顯示名稱，例：「建國高架 南下」「忠孝東路」
  labelFor(edge, from) {
    const sign = from && this.forks[this.forkKey(from)]?.branches?.[edge.w]?.sign;
    if (sign) return sign;
    let e = edge;
    const dest = new Set();
    for (let i = 0; i < 12 && e; i++) {
      if (e.way.dest) e.way.dest.split(';').forEach((d) => dest.add(d.trim()));
      if (!isLink(e.way)) break;
      const next = this.candidates(e).filter((c) => Math.abs(this.turn(e, c)) < U_TURN);
      e = next.find((c) => isMajor(c.way) && !isLink(c.way)) || next.find((c) => isLink(c.way)) || next[0];
    }
    if (dest.size) return [...dest].slice(0, 2).join('・');
    if (!e) return edge.way.name || '匝道';
    if (isMajor(e.way) && !isLink(e.way)) return `${alias(e.way.name)} ${dirWord(this.heading(e, false))}`;
    return e.way.name || edge.way.name || '匝道';
  }

  // 從 S 節點往回走 back 公尺，沿著允許的道路找出起點
  findStart(nodeId, back, allowed) {
    const S = this.nodeIndex.get(nodeId);
    let cur = this.in[S].filter((e) => allowed(e)).sort((p, q) => isMajor(p.way) - isMajor(q.way))[0];
    if (!cur) throw new Error(`找不到起點節點 ${nodeId} 的來向道路`);
    let remaining = back;
    while (remaining > cur.len) {
      remaining -= cur.len;
      const prev = this.in[cur.pts[0]].filter((e) => allowed(e) && !(e.ei === cur.ei && e.d !== cur.d) && !isMajor(e.way));
      if (!prev.length) return { edge: cur, s: 0 };
      cur = prev.reduce((best, e) => (Math.abs(this.turn(e, cur)) < Math.abs(this.turn(best, cur)) ? e : best));
    }
    return { edge: cur, s: cur.len - remaining };
  }

  // 從起點邊到任一目標邊的最短路徑（只走允許的道路）
  route(start, isGoal, allowed) {
    const dist = new Map([[start.id, 0]]);
    const prev = new Map();
    const open = [start];
    while (open.length) {
      open.sort((a, b) => dist.get(a.id) - dist.get(b.id));
      const e = open.shift();
      if (isGoal(e)) {
        const path = [e];
        while (prev.has(path[0].id)) path.unshift(prev.get(path[0].id));
        return path;
      }
      for (const c of this.candidates(e)) {
        if (!allowed(c) && !isGoal(c)) continue;
        if (Math.abs(this.turn(e, c)) >= U_TURN) continue;
        const d = dist.get(e.id) + e.len;
        if (d < (dist.get(c.id) ?? Infinity)) {
          dist.set(c.id, d);
          prev.set(c.id, e);
          open.push(c);
        }
      }
    }
    return null;
  }
}

export function dirWord(angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? '北上' : '南下';
  return dx > 0 ? '東行' : '西行';
}

export function laneText(a, b, n) {
  if (b - a >= n) return '任一車道';
  const nums = b - a === 1 ? `第 ${a + 1} 車道` : `第 ${a + 1}–${b} 車道`;
  const side = a === 0 ? '左側' : b === n ? '右側' : '中間';
  return `${side}車道（由左數${nums}）`;
}
