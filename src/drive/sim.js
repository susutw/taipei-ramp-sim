// 駕駛模擬（不含畫面）：試開頁與 Node 驗證腳本共用。

import { laneText } from './graph.js';

// 把任務設定轉成路線與岔路清單。
// scenario.start 可以是 { node, back }（從 OSM 節點往回退），或 { edge, s }（直接給有向邊）。
// 回傳 null 表示找不到路線。
export function planScenario(graph, scenario) {
  const goalWays = new Set(scenario.goalWays);
  const allowWays = new Set(scenario.allowWays || []);
  const allowNames = scenario.allowNames || [];
  const isGoal = (e) => goalWays.has(e.w);
  const allowed = (e) => allowNames.includes(e.way.name) || allowWays.has(e.w) || isGoal(e);

  const start = scenario.start.edge ? { edge: scenario.start.edge, s: scenario.start.s } : graph.findStart(scenario.start.node, scenario.start.back, allowed);
  const route = graph.route(start.edge, isGoal, allowed);
  if (!route) return null;

  // 路線上每個需要選擇的岔路
  const steps = [];
  let at = -start.s;
  route.forEach((D, i) => {
    at += D.len;
    const next = route[i + 1];
    if (!next) return;
    const br = graph.branches(D);
    if (br.length < 2) return;
    const ok = br.find((b) => b.edge === next);
    if (!ok) return;
    const others = br.filter((b) => b !== ok).map((b) => `「${graph.labelFor(b.edge, D)}」`);
    const lanes = laneText(ok.a, ok.b, D.lanes);
    const text = ok.through
      ? `保持${lanes}直行，不要往${others.join('、')}`
      : `走${lanes}，往「${graph.labelFor(ok.edge, D)}」`;
    steps.push({ i, D, ok, br, text, at });
  });

  // 起始車道：預設放在第一個岔路「不正確」的那一側，讓駕駛必須換車道
  let lane = scenario.start.lane;
  if (lane === undefined || lane === 'auto') {
    const first = steps[0];
    lane = first && first.ok.a > 0 ? 'left' : 'right';
  }
  const startLane = lane === 'left' ? 0 : start.edge.lanes - 1;

  return { start, route, steps, isGoal, startLane };
}

export class Drive {
  constructor(graph, plan) {
    this.graph = graph;
    this.plan = plan;
    this.car = {};
    this.reset();
  }

  reset() {
    const { start, startLane } = this.plan;
    Object.assign(this.car, {
      edge: start.edge,
      s: start.s,
      lane: startLane,
      lat: this.graph.laneOffset(start.edge, startLane),
      speed: 40 / 3.6,
      target: 40 / 3.6,
    });
    this.routeIdx = 0;
  }

  changeLane(delta) {
    const car = this.car;
    car.lane = Math.min(Math.max(car.lane + delta, 0), car.edge.lanes - 1);
  }

  // 前進 dt 秒。judge 為 true 時會判定開錯／抵達，回傳第一個事件：
  //   { type: 'fail', message } 開錯
  //   { type: 'goal' }          抵達終點
  //   { type: 'end', message }  道路在場景範圍外結束
  step(dt, judge = true) {
    const { graph, car } = this;
    const { route, steps, isGoal } = this.plan;
    let event = null;
    const emit = (e) => {
      if (judge && !event) event = e;
    };

    const accel = car.speed < car.target ? 2.5 : 5;
    car.speed += Math.sign(car.target - car.speed) * Math.min(Math.abs(car.target - car.speed), accel * dt);
    car.s += car.speed * dt;

    while (car.s >= car.edge.len) {
      const D = car.edge;
      const br = graph.branches(D);
      if (!br.length) {
        car.s = D.len;
        car.speed = car.target = 0;
        emit({ type: 'end', message: '道路在這裡結束了（場景範圍外）。' });
        break;
      }
      let b;
      const want = route[this.routeIdx + 1];
      if (br.length === 1) {
        b = br[0];
        // 非決策點但路線要轉彎時，跟著路線走
        if (want && want !== b.edge && graph.candidates(D).includes(want) && car.edge === route[this.routeIdx]) b = { edge: want, a: 0, b: D.lanes };
      } else {
        // 共用車道可以往兩個方向，照路線走
        const hits = br.filter((x) => car.lane >= x.a && car.lane < x.b);
        b = hits.find((x) => x.edge === want) || hits[0] || br.at(-1);
      }
      car.lane = graph.laneAfter(D, b, car.lane);
      car.s -= D.len;
      car.edge = b.edge;

      if (car.edge === want && route[this.routeIdx] === D) {
        this.routeIdx++;
      } else {
        const st = steps.find((x) => x.D === D);
        emit({ type: 'fail', message: `你開往了「${graph.labelFor(b.edge, D)}」。${st ? `正確做法：${st.text}。` : ''}` });
      }
      if (isGoal(car.edge)) emit({ type: 'goal' });
    }

    const targetLat = graph.laneOffset(car.edge, car.lane);
    const maxStep = 2.6 * dt;
    car.lat += Math.min(Math.max(targetLat - car.lat, -maxStep), maxStep);
    return event;
  }

  // 下一個岔路與距離
  upcoming() {
    const { route, steps } = this.plan;
    const step = steps.find((st) => st.i >= this.routeIdx);
    if (!step || this.car.edge !== route[this.routeIdx]) return null;
    let d = this.car.edge.len - this.car.s;
    for (let i = this.routeIdx + 1; i <= step.i; i++) d += route[i].len;
    return { step, d };
  }

  // 目前路段上，哪些車道照路線開下去，到岔路時會落在正確的車道範圍。
  // 岔路常落在很短的路段上，所以要從現在的位置一路推算過去。
  goodLanes(step) {
    const { graph, car } = this;
    const { route } = this.plan;
    const good = [];
    for (let start = 0; start < car.edge.lanes; start++) {
      let lane = start;
      for (let i = this.routeIdx; i < step.i; i++) {
        const D = route[i];
        const b = graph.branches(D).find((x) => x.edge === route[i + 1]) || { edge: route[i + 1], a: 0, b: D.lanes };
        lane = graph.laneAfter(D, b, lane);
      }
      if (lane >= step.ok.a && lane < step.ok.b) good.push(start);
    }
    return good.length ? good : [Math.min(step.ok.a, car.edge.lanes - 1)];
  }

  // 自動駕駛：岔路前 400 m 內換到正確車道（一次換一線）
  autopilot() {
    const up = this.upcoming();
    if (!up || up.d > 400) return;
    const good = this.goodLanes(up.step);
    if (!good.includes(this.car.lane)) this.changeLane(good[0] > this.car.lane ? 1 : -1);
  }
}

// 不開畫面，直接用自動駕駛跑完一個任務。回傳最後的事件（逾時回傳 { type: 'timeout' }）。
export function simulate(graph, plan, { maxSeconds = 600, dt = 0.1 } = {}) {
  const drive = new Drive(graph, plan);
  let timer = 0;
  for (let t = 0; t < maxSeconds; t += dt) {
    if ((timer -= dt) < 0) {
      drive.autopilot();
      timer = 1.2;
    }
    const e = drive.step(dt);
    if (e) return e;
  }
  return { type: 'timeout' };
}
