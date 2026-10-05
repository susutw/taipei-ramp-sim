// 岔路車道分配的單元測試：node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoadGraph, lanesFromTurnLanes } from '../src/drive/graph.js';

// 用簡單的路網建立場景：來向道路 A 從南往北開到岔路點，分成直行 B 與匝道 C
function forkScene({ lanes = 3, turnLanes, rampSide = 'right', rampLanes = 1, throughLanes = 2, throughHw = 'trunk', rampHw = 'trunk_link' } = {}) {
  const dx = rampSide === 'right' ? 40 : -40;
  const nodes = [[0, -300], [0, 0], [0, 300], [dx, 250]];
  return {
    nodes: nodes.flatMap(([x, y]) => [x, y, 0]),
    nodeIds: [101, 102, 103, 104],
    ways: {
      1: { name: 'A', hw: 'trunk', oneway: 1, lanes, turnLanes },
      2: { name: 'B', hw: throughHw, oneway: 1, lanes: throughLanes },
      3: { name: 'C', hw: rampHw, oneway: 1, lanes: rampLanes },
    },
    edges: [
      { w: 1, n: [0, 1] },
      { w: 2, n: [1, 2] },
      { w: 3, n: [1, 3] },
    ],
  };
}

const ranges = (g) => {
  const D = g.edges.find((e) => e.w === 1);
  return Object.fromEntries(g.branches(D).map((b) => [g.ways[b.edge.w].name, [b.a, b.b, b.src]]));
};

test('右側出口：最右車道下匝道，其餘直行', () => {
  const g = new RoadGraph(forkScene({ rampSide: 'right' }));
  assert.deepEqual(ranges(g), { B: [0, 2, '推算'], C: [2, 3, '推算'] });
});

test('左側匝道：最左車道進匝道', () => {
  const g = new RoadGraph(forkScene({ rampSide: 'left' }));
  assert.deepEqual(ranges(g), { C: [0, 1, '推算'], B: [1, 3, '推算'] });
});

test('turn:lanes 共用車道：中間車道兩個方向都可以', () => {
  const g = new RoadGraph(forkScene({ turnLanes: 'through|through;slight_right|slight_right' }));
  assert.deepEqual(ranges(g), { B: [0, 2, 'turn:lanes'], C: [1, 3, 'turn:lanes'] });
});

test('turn:lanes 優先於推算：出口有兩條專用車道', () => {
  const g = new RoadGraph(forkScene({ lanes: 4, turnLanes: 'through|through|slight_right|slight_right' }));
  assert.deepEqual(ranges(g), { B: [0, 2, 'turn:lanes'], C: [2, 4, 'turn:lanes'] });
});

test('turn:lanes 車道數與 lanes 不符時不採用', () => {
  const g = new RoadGraph(forkScene({ lanes: 3, turnLanes: 'through|slight_right' }));
  assert.equal(ranges(g).C[2], '推算');
});

test('人工校對（forks.json）優先於 turn:lanes', () => {
  const forks = { '1@102': { branches: { 2: { lanes: [1, 1] }, 3: { lanes: [2, 3] } } } };
  const g = new RoadGraph(forkScene({ turnLanes: 'through|through|slight_right' }), forks);
  assert.deepEqual(ranges(g), { B: [0, 1, '人工校對'], C: [1, 3, '人工校對'] });
});

test('lanesFromTurnLanes：中間分岔（左右都不是直行）', () => {
  // 兩個去向，左邊的被當成「直行」（較直的那個）
  assert.deepEqual(lanesFromTurnLanes('slight_left|slight_left;slight_right|slight_right', 2, 0), [[0, 2], [1, 3]]);
});

test('lanesFromTurnLanes：某個去向沒有車道時回傳 null', () => {
  assert.equal(lanesFromTurnLanes('through|through', 2, 0), null);
});

test('laneAfter：從右側匯入主線，接最右側車道', () => {
  // 匝道 C 從右後方匯入 3 車道主線 B
  const scene = {
    nodes: [0, -300, 0, 0, 0, 0, 0, 300, 0, 40, -250, 0],
    nodeIds: [1, 2, 3, 4],
    ways: {
      1: { name: 'A', hw: 'trunk', oneway: 1, lanes: 2 },
      2: { name: 'B', hw: 'trunk', oneway: 1, lanes: 3 },
      3: { name: 'C', hw: 'trunk_link', oneway: 1, lanes: 1 },
    },
    edges: [{ w: 1, n: [0, 1] }, { w: 2, n: [1, 2] }, { w: 3, n: [3, 1] }],
  };
  const g = new RoadGraph(scene);
  const C = g.edges.find((e) => e.w === 3);
  const [b] = g.branches(C);
  assert.equal(g.ways[b.edge.w].name, 'B');
  assert.equal(g.laneAfter(C, b, 0), 2);
});
