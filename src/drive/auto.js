// 從地圖上的一個出入口自動產生試開任務（不需要手寫 data/scenarios.json）。
//
//   入口：從平面道路上、離匝道口約 ENTRY_BACK 公尺處出發，匯入主線就算成功
//   出口：從主線上、離分岔點約 EXIT_BACK 公尺處出發，開進出口匝道就算成功
//   系統：從來源主線上出發，接上目標主線就算成功

import { isMajor, isLink, alias, dirWord } from './graph.js';

const ENTRY_BACK = 280;
const EXIT_BACK = 450;

// 回傳 { scenario } 或 { error: 無法產生的原因 }
export function autoScenario(graph, ramp) {
  const rampWays = new Set(ramp.ways);
  const rampEdges = graph.edges.filter((e) => rampWays.has(e.w) && (e.way.oneway || e.d === 1));
  if (!rampEdges.length) return { error: '場景裡找不到這個匝道' };
  if (!['入口', '出口', '系統'].includes(ramp.kind)) return { error: `不支援的類型：${ramp.kind}` };

  const inRamp = (e) => rampWays.has(e.w);
  // 匝道的起點邊：前面沒有接其他匝道段
  const entries = rampEdges.filter((e) => !graph.in[e.pts[0]].some(inRamp));
  // 匝道的終點邊：後面沒有接其他匝道段
  const exits = rampEdges.filter((e) => !graph.candidates(e).some(inRamp));
  if (!entries.length || !exits.length) return { error: '匝道的起點或終點不明' };

  // 進入匝道前的來向道路：入口找平面道路，出口／系統找主線
  const wantMajor = ramp.kind !== '入口';
  let entry = null;
  let feeder = null;
  // 先找理想的來向（入口找平面道路、出口找主線），找不到就接受任何不屬於這個匝道的道路
  // （例如平面段的快速道路、其他連接道）
  const preferred = (x) => !inRamp(x) && isMajor(x.way) === wantMajor && !isLink(x.way);
  const anyOther = (x) => !inRamp(x);
  for (const filter of [preferred, anyOther]) {
    for (const e of entries) {
      const f = straightestInto(graph, e, filter);
      if (f) {
        entry = e;
        feeder = f;
        break;
      }
    }
    if (feeder) break;
  }
  if (!feeder) return { error: wantMajor ? '找不到匝道前的主線' : '找不到匝道口前的道路' };

  const sameClass = (x) => !inRamp(x) && isMajor(x.way) === isMajor(feeder.way) && isLink(x.way) === isLink(feeder.way);
  const back = walkBack(graph, feeder, wantMajor ? EXIT_BACK : ENTRY_BACK, sameClass);
  const allowWays = new Set([...back.edges.map((e) => e.w), ...ramp.ways]);

  let goalWays;
  let goalText;
  let briefing;
  const fromLabel = labelOf(graph, feeder);
  if (ramp.kind === '出口') {
    goalWays = [entry.w];
    goalText = `${ramp.title.match(/（(.+)）/)?.[1] || '出口'}出口`;
    briefing = `你在${fromLabel}上。前方要從${goalText}下去，注意車道和指示牌。`;
  } else {
    // 入口／系統：匝道接上的主線
    const { targets, via } = mainlinesAfter(graph, exits, inRamp);
    if (!targets.length) return { error: '找不到匝道接上的主線' };
    for (const w of via) allowWays.add(w);
    goalWays = [...new Set(targets.map((t) => t.w))];
    const toLabel = labelOf(graph, targets[0]);
    goalText = toLabel;
    briefing = ramp.kind === '入口'
      ? `你在「${feeder.way.name || '平面道路'}」上。從前方的入口上${toLabel}，注意入口在哪一側。`
      : `你在${fromLabel}上，要轉往${toLabel}。跟著指示牌，注意車道。`;
  }

  return {
    scenario: {
      id: `auto-${ramp.id}`,
      ramp: ramp.id,
      auto: true,
      title: ramp.title,
      briefing,
      start: { edge: back.edge, s: back.s, lane: 'auto' },
      allowWays: [...allowWays],
      goalWays,
      goalText,
    },
  };
}

function labelOf(graph, edge) {
  const name = edge.way.name ? alias(edge.way.name) : '道路';
  return isMajor(edge.way) ? `${name}（${dirWord(graph.heading(edge, false))}）` : name;
}

// 匝道終點之後接上的主線。有些匝道會先接另一段連接道（例如系統匝道串接），
// 所以沿著連接道往前找，最遠 1 km。
function mainlinesAfter(graph, exits, inRamp) {
  const found = new Set();
  const via = new Set();
  const seen = new Set();
  const queue = exits.map((e) => [e, 0]);
  while (queue.length) {
    const [e, dist] = queue.shift();
    for (const c of graph.candidates(e)) {
      if (seen.has(c.id) || inRamp(c) || !isMajor(c.way)) continue;
      seen.add(c.id);
      if (!isLink(c.way)) found.add(c);
      else if (dist + c.len < 1000) {
        via.add(c.w);
        queue.push([c, dist + c.len]);
      }
    }
  }
  return { targets: [...found], via };
}

// 開進 e 的來向邊中，最直的那一條（且符合 filter）
function straightestInto(graph, e, filter) {
  const list = graph.in[e.pts[0]].filter((x) => filter(x) && !(x.ei === e.ei && x.d !== e.d));
  let best = null;
  for (const x of list) if (!best || Math.abs(graph.turn(x, e)) < Math.abs(graph.turn(best, e))) best = x;
  return best;
}

// 從 edge 的終點往回走 meters 公尺，回傳起點 { edge, s } 與經過的邊
function walkBack(graph, edge, meters, filter) {
  const edges = [edge];
  let cur = edge;
  let remaining = meters;
  while (remaining > cur.len) {
    const prev = straightestInto(graph, cur, filter);
    if (!prev || edges.includes(prev) || Math.abs(graph.turn(prev, cur)) > 0.8) return { edge: cur, s: 0, edges };
    remaining -= cur.len;
    cur = prev;
    edges.push(cur);
  }
  return { edge: cur, s: cur.len - remaining, edges };
}
