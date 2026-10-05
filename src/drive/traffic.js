// 塞車模式的車流：其他車沿著玩家的路線分布在各車道，用 IDM 跟車模型走走停停。
//
// 只模擬玩家路線前後一段距離內的車，不是整個城市的交通。
// 位置以「路線距離 S」表示：路線第 i 段的起點是 cum[i]。
// 通往匝道／出口的車道（非直行去向）車速慢、車距短，會排隊。

export const LEVELS = {
  none: { label: '無車' },
  light: { label: '順暢', through: 50, queue: 35, gap: 70, yield: 0.8 },
  busy: { label: '車多', through: 40, queue: 18, gap: 28, yield: 0.6 },
  jam: { label: '塞車', through: 28, queue: 12, gap: 13, yield: 0.45 },
};

const CAR_LEN = 4.5;
const AHEAD = 650; // 玩家前方維持車流的距離
const BEHIND = 220; // 玩家後方
const QUEUE_LOOKAHEAD = 400; // 岔路前多遠開始排隊
// IDM 參數
const A_MAX = 1.2;
const B_COMF = 2.0;
const S0 = 2.5;
const T_HEAD = 1.4;

export function idmAccel(v, v0, gap, dv) {
  const sStar = S0 + Math.max(0, v * T_HEAD + (v * dv) / (2 * Math.sqrt(A_MAX * B_COMF)));
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  const inter = gap < Infinity ? Math.pow(sStar / Math.max(gap, 0.1), 2) : 0;
  return A_MAX * (free - inter);
}

// 固定種子的亂數，讓同一個任務每次的車流都一樣，方便重現與驗證
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Traffic {
  constructor(graph, route, level, seed = 1) {
    this.graph = graph;
    this.route = route;
    this.cfg = LEVELS[level];
    this.level = level;
    this.rng = mulberry32(seed);
    this.cum = [0];
    for (const e of route) this.cum.push(this.cum.at(-1) + e.len);
    this.cars = [];
    this.queueCache = new Map();
    this.t = 0;
  }

  get active() {
    return this.level !== 'none';
  }

  // S 落在路線第幾段
  indexAt(S) {
    let i = 0;
    while (i < this.route.length - 1 && this.cum[i + 1] <= S) i++;
    return i;
  }

  // 第 i 段的第 lane 車道，照路線開下去是否會進入「非直行」的去向（出口、匝道）→ 排隊車道
  isQueueLane(i, lane) {
    const key = `${i}:${lane}`;
    if (this.queueCache.has(key)) return this.queueCache.get(key);
    const { graph, route } = this;
    let result = false;
    let dist = 0;
    for (let j = i; j < route.length && dist < QUEUE_LOOKAHEAD; j++) {
      const D = route[j];
      const br = graph.branches(D);
      if (br.length > 1) {
        const hit = br.filter((b) => lane >= b.a && lane < b.b);
        result = hit.length > 0 && hit.every((b) => !b.through);
        break;
      }
      const next = route[j + 1];
      if (!next) break;
      lane = graph.laneAfter(D, br[0] || { edge: next, a: 0, b: D.lanes }, lane);
      dist += D.len;
    }
    this.queueCache.set(key, result);
    return result;
  }

  speedFor(i, lane) {
    const v = this.isQueueLane(i, lane) ? this.cfg.queue : this.cfg.through;
    // 平面道路速限較低
    const cap = /^(motorway|trunk)/.test(this.route[i].way.hw) ? 90 : 40;
    return Math.min(v, cap) / 3.6;
  }

  spacingFor(i, lane) {
    const g = this.cfg.gap * (this.isQueueLane(i, lane) ? 0.6 : 1);
    return Math.max(CAR_LEN + S0, g * (0.7 + this.rng() * 0.6));
  }

  makeCar(S, lane) {
    const i = this.indexAt(S);
    if (lane >= this.route[i].lanes) return null;
    const v0 = this.speedFor(i, lane);
    return { S, i, lane, v: v0, lat: this.graph.laneOffset(this.route[i], lane), yieldUntil: 0, askedAt: -Infinity };
  }

  // 依玩家位置把路線前後鋪滿車（玩家周圍留空）
  populate(player) {
    this.cars = [];
    if (!this.active) return;
    const end = this.cum.at(-1);
    const from = Math.max(0, player.S - BEHIND);
    const to = Math.min(end, player.S + AHEAD);
    const maxLanes = Math.max(...this.route.map((e) => e.lanes));
    for (let lane = 0; lane < maxLanes; lane++) {
      let S = from + this.rng() * this.cfg.gap;
      while (S < to) {
        const i = this.indexAt(S);
        const clear = Math.abs(S - player.S) > 15 || lane !== player.lane;
        if (lane < this.route[i].lanes && clear) {
          const c = this.makeCar(S, lane);
          if (c) this.cars.push(c);
        }
        S += this.spacingFor(i, Math.min(lane, this.route[i].lanes - 1));
      }
    }
  }

  // 在 lane 車道上，S 前方最近的車（含玩家），回傳 { gap, v } 或 null
  leader(S, lane, player, self) {
    let best = null;
    const consider = (s2, v2) => {
      const gap = s2 - S - CAR_LEN;
      if (s2 > S && (!best || gap < best.gap)) best = { gap, v: v2 };
    };
    for (const c of this.cars) if (c !== self && c.lane === lane) consider(c.S, c.v);
    if (player && player.lane === lane) consider(player.S, player.v);
    return best;
  }

  // 在 lane 車道上，S 後方最近的車
  follower(S, lane) {
    let best = null;
    for (const c of this.cars) {
      if (c.lane !== lane || c.S >= S) continue;
      if (!best || c.S > best.S) best = c;
    }
    return best;
  }

  // 玩家想切到 lane：前後空隙夠不夠（低速時可以接受較小的空隙，就像塞車時一台一台擠進去）
  canMerge(player, lane) {
    const lead = this.leader(player.S - 0.01, lane, null, null);
    if (lead && lead.gap < 2 + player.v * 0.4) return false;
    const back = this.follower(player.S + 0.01, lane);
    if (back) {
      const gap = player.S - back.S - CAR_LEN;
      if (gap < 2.5 + Math.max(0, back.v - player.v) * 1.2 + back.v * 0.4) return false;
    }
    return true;
  }

  // 玩家打方向燈時，目標車道後方的車有機率禮讓（把玩家當成前車，放慢拉開距離）。
  // 不讓的車過幾秒可以再問一次
  askYield(player, lane) {
    const back = this.follower(player.S, lane);
    if (!back || player.S - back.S > 40 || this.t - back.askedAt < 4) return;
    back.askedAt = this.t;
    if (this.rng() < this.cfg.yield) back.yieldUntil = this.t + 10;
  }

  step(dt, player) {
    if (!this.active) return;
    this.t += dt;
    const { graph, route } = this;

    // 跟車
    for (const c of this.cars) {
      const v0 = this.speedFor(c.i, c.lane);
      let lead = this.leader(c.S, c.lane, player, c);
      if (c.yieldUntil > this.t && player && player.S > c.S) {
        const gap = player.S - c.S - CAR_LEN;
        if (!lead || gap < lead.gap) lead = { gap, v: player.v };
      }
      const a = lead ? idmAccel(c.v, v0, lead.gap, c.v - lead.v) : idmAccel(c.v, v0, Infinity, 0);
      c.v = Math.max(0, c.v + a * dt);
    }

    // 前進、跨段、離開
    const keep = [];
    for (const c of this.cars) {
      c.S += c.v * dt;
      let alive = true;
      while (alive && c.i < route.length - 1 && c.S >= this.cum[c.i + 1]) {
        const D = route[c.i];
        const next = route[c.i + 1];
        const br = graph.branches(D);
        let b = br.length > 1 ? br.find((x) => x.edge === next) : br[0];
        if (!b || b.edge !== next) b = { edge: next, a: 0, b: D.lanes };
        if (br.length > 1 && !(c.lane >= b.a && c.lane < b.b)) alive = false; // 開往別的去向
        else {
          c.lane = graph.laneAfter(D, b, c.lane);
          c.i++;
        }
      }
      if (c.S >= this.cum.at(-1)) alive = false;
      if (player && (c.S < player.S - BEHIND - 50 || c.S > player.S + AHEAD + 100)) alive = false;
      const target = graph.laneOffset(route[c.i], c.lane);
      c.lat += Math.min(Math.max(target - c.lat, -2.6 * dt), 2.6 * dt);
      if (alive) keep.push(c);
    }
    this.cars = keep;

    // 補車：前方與後方
    if (player) this.refill(player);
  }

  refill(player) {
    const end = this.cum.at(-1);
    const front = Math.min(end - 5, player.S + AHEAD);
    const back = Math.max(0, player.S - BEHIND);
    for (const [edgeS, isFront] of [[front, true], [back, false]]) {
      const i = this.indexAt(edgeS);
      for (let lane = 0; lane < this.route[i].lanes; lane++) {
        const inLane = this.cars.filter((c) => c.lane === lane);
        const nearest = inLane.reduce((m, c) => Math.min(m, Math.abs(c.S - edgeS)), Infinity);
        if (nearest > this.spacingFor(i, lane) && !(lane === player.lane && Math.abs(edgeS - player.S) < 20)) {
          const c = this.makeCar(edgeS, lane);
          if (c) {
            // 後方補進來的車用自由速度，前方的跟著該車道的速度
            if (!isFront) c.v = this.speedFor(i, lane);
            this.cars.push(c);
          }
        }
      }
    }
  }

  // 其他車在場景中的位置（畫面用）
  pose(c) {
    const edge = this.route[c.i];
    const s = c.S - this.cum[c.i];
    const p = this.graph.sample(edge, s);
    const len = Math.hypot(p.tx, p.ty) || 1;
    const fx = p.tx / len;
    const fy = p.ty / len;
    return { x: p.x + fy * c.lat, y: p.y - fx * c.lat, h: p.h, fx, fy, major: /^(motorway|trunk)/.test(edge.way.hw) };
  }
}
