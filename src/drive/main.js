// 試開頁：載入任務與場景，處理駕駛、鏡頭、提示與成功／失敗判定。
//
// 網址參數：
//   s=<任務 id>   要開的任務（data/scenarios.json）
//   auto=1        自動駕駛走正確路線（測試用）
//   fast=1        時間加速 4 倍（測試用）
//   debug=1       顯示岔路代碼與各去向的 way id（人工校對 data/forks.json 用）

import * as THREE from 'three';
import { RoadGraph, isMajor, laneText, alias } from './graph.js';
import { buildWorld } from './world.js';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');
const DEBUG = params.has('debug');
const TIME_SCALE = params.has('fast') ? 4 : 1;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- 載入 ----
let scenario;
let graph;
try {
  const scenarios = await fetch('data/scenarios.json').then((r) => r.json());
  scenario = scenarios.find((s) => s.id === params.get('s')) || scenarios[0];
  const [scene, forks] = await Promise.all([
    fetch(`data/scenes/${scenario.scene}.json`).then((r) => r.json()),
    fetch('data/forks.json').then((r) => (r.ok ? r.json() : {})),
  ]);
  graph = new RoadGraph(scene, forks);
  var world = buildWorld(scene, graph);
} catch (err) {
  $('loading').textContent = `載入失敗：${err.message}`;
  throw err;
}

const goalWays = new Set(scenario.goalWays);
const isGoal = (e) => goalWays.has(e.w);
const allowed = (e) => scenario.allowNames.includes(e.way.name) || isGoal(e);

const start = graph.findStart(scenario.start.node, scenario.start.back, allowed);
const route = graph.route(start.edge, isGoal, allowed);
if (!route) {
  $('loading').textContent = '這個任務找不到可行路線，請檢查 data/scenarios.json。';
  throw new Error('no route');
}

// 路線上每個需要選擇的岔路
const steps = [];
{
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
}

// ---- three.js ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$('view').appendChild(renderer.domElement);

const scene3 = new THREE.Scene();
scene3.background = new THREE.Color(0xa9cdee);
scene3.fog = new THREE.Fog(0xa9cdee, 180, 1400);
scene3.add(new THREE.HemisphereLight(0xffffff, 0x7d8a70, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(300, 500, 200);
scene3.add(sun);
scene3.add(world);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const carMesh = makeCar();
scene3.add(carMesh);
$('loading').remove();
$('title').textContent = scenario.title;

// ---- 狀態 ----
const car = {};
let routeIdx = 0;
let status = 'brief'; // brief | run | pause | ending | done
let hints = true;
let camMode = 0; // 0 追車 1 駕駛座 2 鳥瞰
const CAM_NAMES = ['追車', '駕駛座', '鳥瞰'];
let elapsed = 0;
let fwd = new THREE.Vector2();
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

function reset() {
  car.edge = start.edge;
  car.s = start.s;
  car.lane = scenario.start.lane === 'left' ? 0 : start.edge.lanes - 1;
  car.lat = graph.laneOffset(car.edge, car.lane);
  car.speed = 40 / 3.6;
  car.target = 40 / 3.6;
  routeIdx = 0;
  elapsed = 0;
  const p = graph.sample(car.edge, car.s);
  fwd.set(p.tx, p.ty).normalize();
  placeCar(0, true);
}

// ---- 駕駛 ----
function changeLane(delta) {
  if (status !== 'run' && status !== 'ending') return;
  car.lane = Math.min(Math.max(car.lane + delta, 0), car.edge.lanes - 1);
}

function advance(dt) {
  const accel = car.speed < car.target ? 2.5 : 5;
  car.speed += Math.sign(car.target - car.speed) * Math.min(Math.abs(car.target - car.speed), accel * dt);
  car.s += car.speed * dt;

  while (car.s >= car.edge.len) {
    const D = car.edge;
    const br = graph.branches(D);
    if (!br.length) {
      car.s = D.len;
      car.speed = car.target = 0;
      if (status === 'run') endRun(false, '道路在這裡結束了（場景範圍外）。');
      break;
    }
    let b;
    const want = route[routeIdx + 1];
    if (br.length === 1) {
      b = br[0];
      // 非決策點但路線要轉彎時，跟著路線走
      if (want && want !== b.edge && graph.candidates(D).includes(want) && car.edge === route[routeIdx]) b = { edge: want, a: 0, b: D.lanes };
    } else {
      b = br.find((x) => car.lane >= x.a && car.lane < x.b) || br.at(-1);
    }
    car.lane = graph.laneAfter(D, b, car.lane);
    car.s -= D.len;
    car.edge = b.edge;

    if (car.edge === want && route[routeIdx] === D) {
      routeIdx++;
    } else if (status === 'run') {
      const step = steps.find((st) => st.D === D);
      endRun(false, `你開往了「${graph.labelFor(b.edge, D)}」。${step ? `正確做法：${step.text}。` : ''}`);
    }
    if (status === 'run' && isGoal(car.edge)) endRun(true);
  }

  const targetLat = graph.laneOffset(car.edge, car.lane);
  const maxStep = 2.6 * dt;
  car.lat += Math.min(Math.max(targetLat - car.lat, -maxStep), maxStep);
}

function placeCar(dt, snap = false) {
  const p = graph.sample(car.edge, car.s);
  const k = snap ? 1 : 1 - Math.exp(-dt * 5);
  fwd.lerp(new THREE.Vector2(p.tx, p.ty), k).normalize();
  const rx = fwd.y;
  const ry = -fwd.x;
  const lift = isMajor(car.edge.way) ? 0.14 : 0.06;
  const x = p.x + rx * car.lat;
  const y = p.y + ry * car.lat;
  const ahead = graph.sample(car.edge, car.s + 3);
  const behind = graph.sample(car.edge, car.s - 3);
  const run = Math.max(Math.hypot(ahead.x - behind.x, ahead.y - behind.y), 0.5);
  carMesh.position.set(x, p.h + lift, -y);
  carMesh.rotation.set(Math.atan((ahead.h - behind.h) / run), Math.atan2(-fwd.x, fwd.y), 0, 'YXZ');

  const f3 = new THREE.Vector3(fwd.x, 0, -fwd.y);
  const base = carMesh.position;
  let pos;
  let look;
  if (camMode === 0) {
    pos = base.clone().addScaledVector(f3, -13).add(new THREE.Vector3(0, 5.5, 0));
    look = base.clone().addScaledVector(f3, 18).add(new THREE.Vector3(0, 1.5, 0));
  } else if (camMode === 1) {
    pos = base.clone().addScaledVector(f3, 0.4).add(new THREE.Vector3(0, 1.3, 0));
    look = base.clone().addScaledVector(f3, 30).add(new THREE.Vector3(0, 1.1, 0));
  } else {
    pos = base.clone().addScaledVector(f3, -70).add(new THREE.Vector3(0, 110, 0));
    look = base.clone().addScaledVector(f3, 40);
  }
  const ck = snap ? 1 : 1 - Math.exp(-dt * (camMode === 1 ? 20 : 4));
  camPos.lerp(pos, ck);
  camLook.lerp(look, ck);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// 目前路段上，哪些車道照路線開下去，到岔路時會落在正確的車道範圍。
// 岔路常落在很短的路段上，所以要從現在的位置一路推算過去。
function goodLanes(step) {
  const good = [];
  for (let start = 0; start < car.edge.lanes; start++) {
    let lane = start;
    for (let i = routeIdx; i < step.i; i++) {
      const D = route[i];
      const b = graph.branches(D).find((x) => x.edge === route[i + 1]) || { edge: route[i + 1], a: 0, b: D.lanes };
      lane = graph.laneAfter(D, b, lane);
    }
    if (lane >= step.ok.a && lane < step.ok.b) good.push(start);
  }
  return good.length ? good : [Math.min(step.ok.a, car.edge.lanes - 1)];
}

// 自動駕駛（測試用）：在岔路前換到正確車道
function autopilot() {
  const up = upcoming();
  if (!up || up.d > 400) return;
  const good = goodLanes(up.step);
  if (good.includes(car.lane)) return;
  changeLane(good[0] > car.lane ? 1 : -1);
}

// ---- 提示與 HUD ----
function upcoming() {
  const step = steps.find((st) => st.i >= routeIdx);
  if (!step || car.edge !== route[routeIdx]) return null;
  let d = car.edge.len - car.s;
  for (let i = routeIdx + 1; i <= step.i; i++) d += route[i].len;
  return { step, d };
}

let lastHud = '';
function updateHud() {
  const up = upcoming();
  const kmh = Math.round(car.speed * 3.6);
  $('road').textContent = car.edge.way.name ? alias(car.edge.way.name) : '（未命名道路）';
  $('speed').textContent = `${kmh} km/h　視角：${CAM_NAMES[camMode]}　提示：${hints ? '開' : '關'}`;

  let hint = '';
  const good = up && up.d < 450 ? goodLanes(up.step) : null;
  if (status === 'run' && hints && good) {
    const ok = good.includes(car.lane);
    const dist = up.d < 30 ? '現在' : `前方 ${Math.round(up.d / 10) * 10} m`;
    hint = `<div class="card${ok ? '' : ' warn'}">${dist}：${esc(up.step.text)}${ok ? '' : '<br>⚠ 請換車道'}</div>`;
  }
  if (DEBUG && up) {
    const D = up.step.D;
    hint += `<div class="card" style="font-size:13px;font-weight:400;margin-top:6px;text-align:left">岔路代碼 <b>${graph.forkKey(D)}</b>（來向 ${D.lanes} 車道）<br>${up.step.br
      .map((b) => `way ${b.edge.w}：第 ${b.a + 1}–${b.b} 車道 → ${esc(graph.labelFor(b.edge, D))}${b.checked ? '（已校對）' : ''}`)
      .join('<br>')}</div>`;
  }
  if (status === 'pause') {
    hint = '<div class="card">暫停中（按空白鍵繼續）</div>';
  }

  // 車道示意：目前路段的每一條車道，岔路前顯示各車道去向
  const n = car.edge.lanes;
  const atDecision = up && up.step.i === routeIdx && up.d < 450;
  const br = atDecision ? up.step.br : null;
  let lanes = '';
  for (let i = 0; i < n; i++) {
    const b = br?.find((x) => i >= x.a && i < x.b);
    const arrow = !b ? '↑' : b.through ? '↑' : graph.turn(car.edge, b.edge) > 0 ? '↖' : '↗';
    const isGood = hints && good?.includes(i);
    lanes += `<div class="${isGood ? 'good' : ''} ${i === car.lane ? 'me' : ''}">${arrow}</div>`;
  }
  const html = hint + '|' + lanes;
  if (html !== lastHud) {
    $('hint').innerHTML = hint;
    $('lanes').innerHTML = lanes;
    lastHud = html;
  }
}

// ---- 小地圖（車頭朝上） ----
const mini = $('minimap').getContext('2d');
const sceneEdges = graph.edges.filter((D) => D.d === 1 || D.way.oneway === -1);
function drawMinimap() {
  const W = mini.canvas.width;
  const scale = W / 2 / 420;
  mini.setTransform(1, 0, 0, 1, 0, 0);
  mini.clearRect(0, 0, W, W);
  const p = carMesh.position;
  const cx = p.x;
  const cy = -p.z;
  mini.translate(W / 2, W / 2);
  mini.rotate(-Math.PI / 2 - Math.atan2(-fwd.y, fwd.x));
  mini.scale(scale, -scale);
  mini.translate(-cx, -cy);
  mini.lineCap = 'round';
  mini.lineJoin = 'round';
  const draw = (D, color, width) => {
    mini.strokeStyle = color;
    mini.lineWidth = width / scale;
    mini.beginPath();
    D.pts.forEach((i, k) => (k ? mini.lineTo(graph.x(i), graph.y(i)) : mini.moveTo(graph.x(i), graph.y(i))));
    mini.stroke();
  };
  for (const D of sceneEdges) {
    const i = D.pts[0];
    if (Math.abs(graph.x(i) - cx) > 900 || Math.abs(graph.y(i) - cy) > 900) continue;
    draw(D, isMajor(D.way) ? '#f59e0b' : 'rgba(255,255,255,.35)', isMajor(D.way) ? 4 : 2);
  }
  if (hints) for (const D of route) draw(D, 'rgba(45,212,191,.9)', 3);
  mini.setTransform(1, 0, 0, 1, 0, 0);
  mini.fillStyle = '#facc15';
  mini.beginPath();
  mini.moveTo(W / 2, W / 2 - 14);
  mini.lineTo(W / 2 - 9, W / 2 + 10);
  mini.lineTo(W / 2 + 9, W / 2 + 10);
  mini.closePath();
  mini.fill();
}

// ---- 開始／結束畫面 ----
function overlay(html) {
  $('overlayBox').innerHTML = html;
  $('overlay').classList.add('show');
}
function hideOverlay() {
  $('overlay').classList.remove('show');
}

function stepList() {
  return `<ol>${steps.map((s) => `<li>${esc(s.text)}</li>`).join('')}<li>抵達：${esc(scenario.goalText)}</li></ol>`;
}

function showBriefing() {
  status = 'brief';
  overlay(`
    <h2>${esc(scenario.title)}</h2>
    <p>${esc(scenario.briefing)}</p>
    <details ${hints ? 'open' : ''}><summary>路線重點（${steps.length} 個岔路）</summary>${stepList()}</details>
    <p class="muted">車子會自動沿道路前進，你只要決定車道：<b>← →</b> 換車道、<b>↑ ↓</b> 加減速。手機請用畫面下方按鈕。<br>
    指示牌與車道配置由開放資料自動產生，可能和現場不同，實際開車請以現場標誌為準。</p>
    <div class="actions">
      <button class="btn primary" data-act="go">開始（有提示）</button>
      <button class="btn" data-act="go-nohint">挑戰（不提示）</button>
      <a class="btn" href="index.html#${esc(scenario.ramp)}">回地圖</a>
    </div>`);
}

function endRun(success, message = '') {
  status = 'ending';
  const time = Math.round(elapsed);
  setTimeout(() => {
    status = 'done';
    overlay(success
      ? `<h2>✅ 成功抵達${esc(scenario.goalText)}</h2>
         <p>用時 ${time} 秒${hints ? '（有提示）' : '（無提示）'}。${hints ? '試試看關掉提示再開一次！' : '你已經記住這條路了 👍'}</p>
         <details><summary>路線重點</summary>${stepList()}</details>`
      : `<h2>❌ 開錯了</h2><p>${esc(message)}</p><details open><summary>路線重點</summary>${stepList()}</details>`)
      ;
    $('overlayBox').insertAdjacentHTML('beforeend', `
      <div class="actions">
        <button class="btn primary" data-act="${hints ? 'go' : 'go-nohint'}">再開一次</button>
        ${hints ? '<button class="btn" data-act="go-nohint">挑戰（不提示）</button>' : '<button class="btn" data-act="go">開提示再開</button>'}
        <a class="btn" href="index.html#${esc(scenario.ramp)}">回地圖</a>
      </div>`);
  }, success ? 1500 : 2200);
}

$('overlay').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  hints = act === 'go';
  reset();
  hideOverlay();
  status = 'run';
});

// ---- 操作 ----
function onKey(code) {
  switch (code) {
    case 'ArrowLeft': case 'KeyA': changeLane(-1); break;
    case 'ArrowRight': case 'KeyD': changeLane(1); break;
    case 'ArrowUp': case 'KeyW': car.target = Math.min(car.target + 10 / 3.6, 90 / 3.6); break;
    case 'ArrowDown': case 'KeyS': car.target = Math.max(car.target - 10 / 3.6, 0); break;
    case 'Space':
      if (status === 'run') status = 'pause';
      else if (status === 'pause') status = 'run';
      break;
    case 'KeyC': camMode = (camMode + 1) % 3; break;
    case 'KeyH': hints = !hints; break;
    case 'KeyR': reset(); hideOverlay(); status = 'run'; break;
    default: return false;
  }
  return true;
}
addEventListener('keydown', (e) => {
  if (onKey(e.code)) e.preventDefault();
});
for (const b of document.querySelectorAll('#touch button')) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onKey(b.dataset.key);
  });
}

// ---- 主迴圈 ----
reset();
showBriefing();
if (AUTO) {
  hideOverlay();
  status = 'run';
}

const clock = new THREE.Clock();
let autoTimer = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1) * TIME_SCALE;
  if (status === 'run' || status === 'ending') {
    elapsed += dt;
    if (AUTO && (autoTimer -= dt) < 0) {
      autopilot();
      autoTimer = 1.2;
    }
    advance(dt);
  }
  placeCar(dt);
  updateHud();
  drawMinimap();
  renderer.render(scene3, camera);
});

// 給自動測試讀取狀態
window.__drive = { graph, route, steps, car, camera, scene: scene3, THREE, get status() { return status; }, get routeIdx() { return routeIdx; }, overlayText: () => $('overlayBox').innerText };

// ---- 車子模型 ----
function makeCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.4), new THREE.MeshLambertMaterial({ color: 0xd62828 }));
  body.position.y = 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), new THREE.MeshLambertMaterial({ color: 0x1f2a36 }));
  cabin.position.set(0, 1.2, 0.2);
  g.add(body, cabin);
  for (const [x, z] of [[-0.85, -1.4], [0.85, -1.4], [-0.85, 1.4], [0.85, 1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  return g;
}
