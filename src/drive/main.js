// 試開頁：載入任務與場景，處理駕駛、鏡頭、提示與成功／失敗判定。
//
// 網址參數：
//   s=<任務 id>   要開的手寫任務（data/scenarios.json）
//   r=<出入口 id> 自動產生該出入口的任務（場景見 data/regions.json）
//   auto=1        自動駕駛走正確路線（測試用）
//   fast=1        時間加速 4 倍；fast=N 加速 N 倍（測試用）
//   traffic=none|light|busy|jam  車流程度（預設：順暢；auto 測試時預設無車）
//   debug=1       顯示岔路代碼與各去向的 way id（人工校對 data/forks.json 用）

import * as THREE from 'three';
import { RoadGraph, isMajor, alias } from './graph.js';
import { buildWorld } from './world.js';
import { planScenario, Drive } from './sim.js';
import { autoScenario } from './auto.js';
import { LEVELS } from './traffic.js';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');
const DEBUG = params.has('debug');
const fastArg = params.get('fast');
const TIME_SCALE = fastArg === null ? 1 : +fastArg > 1 ? +fastArg : 4;
let trafficLevel = params.get('traffic') in LEVELS ? params.get('traffic') : AUTO ? 'none' : 'light';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- 載入 ----
const getJSON = (url) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${url}（HTTP ${r.status}）`);
  return r.json();
});
let scenario;
let graph;
let plan;
try {
  const forks = await getJSON('data/forks.json').catch(() => ({}));
  const rampId = params.get('r');
  let scene;
  if (rampId) {
    const [ramps, regions] = await Promise.all([getJSON('data/ramps.geojson'), getJSON('data/regions.json')]);
    const ramp = ramps.features.find((f) => f.properties.id === rampId)?.properties;
    const region = Object.entries(regions).find(([, r]) => r.ramps.includes(rampId))?.[0];
    if (!ramp) throw new Error(`找不到出入口 ${rampId}`);
    if (!region) throw new Error('這個出入口還沒有 3D 場景');
    scene = await getJSON(`data/scenes/${region}.json`);
    graph = new RoadGraph(scene, forks);
    const res = autoScenario(graph, ramp);
    if (res.error) throw new Error(res.error);
    scenario = res.scenario;
  } else {
    const scenarios = await getJSON('data/scenarios.json');
    scenario = scenarios.find((x) => x.id === params.get('s')) || scenarios[0];
    scene = await getJSON(`data/scenes/${scenario.scene}.json`);
    graph = new RoadGraph(scene, forks);
  }
  plan = planScenario(graph, scenario);
  if (!plan) throw new Error('這個任務找不到可行路線');
  var world = buildWorld(scene, graph);
} catch (err) {
  $('loading').innerHTML = `無法開始試開：${esc(err.message)}<br><a href="index.html" style="color:#fff">回地圖</a>`;
  throw err;
}
const { route, steps } = plan;
const drive = new Drive(graph, plan, { traffic: trafficLevel });
const car = drive.car;

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

// 其他車：用 InstancedMesh 一次畫完
const MAX_NPC = 260;
const NPC_COLORS = [0xf3f4f6, 0x9ca3af, 0x374151, 0x1e3a8a, 0xb91c1c, 0xe5e7eb, 0x6b7280, 0x0f766e].map((c) => new THREE.Color(c));
const npcBody = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.75, 4.4), new THREE.MeshLambertMaterial(), MAX_NPC);
const npcCabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), new THREE.MeshLambertMaterial({ color: 0x1f2a36 }), MAX_NPC);
for (let i = 0; i < MAX_NPC; i++) npcBody.setColorAt(i, NPC_COLORS[i % NPC_COLORS.length]);
npcBody.count = npcCabin.count = 0;
npcBody.frustumCulled = npcCabin.frustumCulled = false;
scene3.add(npcBody, npcCabin);
const npcMat = new THREE.Matrix4();
const npcQ = new THREE.Quaternion();
const npcPos = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const npcIds = new WeakMap();
let npcSeq = 0;
function drawTraffic() {
  const cars = drive.traffic.cars;
  const n = Math.min(cars.length, MAX_NPC);
  for (let i = 0; i < n; i++) {
    const c = cars[i];
    if (!npcIds.has(c)) npcIds.set(c, npcSeq++);
    const p = drive.traffic.pose(c);
    const lift = p.major ? 0.14 : 0.06;
    npcQ.setFromAxisAngle(UP, Math.atan2(-p.fx, p.fy));
    npcPos.set(p.x, p.h + lift + 0.6, -p.y);
    npcMat.compose(npcPos, npcQ, ONE);
    npcBody.setMatrixAt(i, npcMat);
    npcBody.setColorAt(i, NPC_COLORS[npcIds.get(c) % NPC_COLORS.length]);
    npcPos.set(p.x - p.fx * 0.2, p.h + lift + 1.2, -(p.y - p.fy * 0.2));
    npcMat.compose(npcPos, npcQ, ONE);
    npcCabin.setMatrixAt(i, npcMat);
  }
  npcBody.count = npcCabin.count = n;
  npcBody.instanceMatrix.needsUpdate = npcCabin.instanceMatrix.needsUpdate = true;
  if (npcBody.instanceColor) npcBody.instanceColor.needsUpdate = true;
}
$('loading').remove();
$('title').textContent = scenario.title;

// ---- 狀態 ----
let status = 'brief'; // brief | run | pause | ending | done
let hints = true;
let camMode = 0; // 0 追車 1 駕駛座 2 鳥瞰
const CAM_NAMES = ['追車', '駕駛座', '鳥瞰'];
let elapsed = 0;
let fwd = new THREE.Vector2();
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

function reset() {
  drive.reset();
  elapsed = 0;
  const p = graph.sample(car.edge, car.s);
  fwd.set(p.tx, p.ty).normalize();
  placeCar(0, true);
}

// ---- 駕駛 ----
function changeLane(delta) {
  if (status === 'run' || status === 'ending') drive.changeLane(delta);
}

function advance(dt) {
  const e = drive.step(dt, status === 'run');
  if (e) endRun(e.type === 'goal', e.message);
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

// ---- 提示與 HUD ----
let lastHud = '';
function updateHud() {
  const up = drive.upcoming();
  const kmh = Math.round(car.speed * 3.6);
  $('road').textContent = car.edge.way.name ? alias(car.edge.way.name) : '（未命名道路）';
  $('speed').textContent = `${kmh} km/h　車流：${LEVELS[drive.level].label}　視角：${CAM_NAMES[camMode]}　提示：${hints ? '開' : '關'}`;

  let hint = '';
  const good = up && up.d < 450 ? drive.goodLanes(up.step) : null;
  if (status === 'run' && hints && good) {
    const ok = good.includes(car.lane);
    const dist = up.d < 30 ? '現在' : `前方 ${Math.round(up.d / 10) * 10} m`;
    hint = `<div class="card${ok ? '' : ' warn'}">${dist}：${esc(up.step.text)}${ok ? '' : '<br>⚠ 請換車道'}</div>`;
  }
  if (DEBUG && up) {
    const D = up.step.D;
    hint += `<div class="card" style="font-size:13px;font-weight:400;margin-top:6px;text-align:left">岔路代碼 <b>${graph.forkKey(D)}</b>（來向 ${D.lanes} 車道）<br>${up.step.br
      .map((b) => `way ${b.edge.w}：第 ${b.a + 1}–${b.b} 車道 → ${esc(graph.labelFor(b.edge, D))}（${b.src}）`)
      .join('<br>')}</div>`;
  }
  if (car.signal !== null && (status === 'run' || status === 'ending')) {
    const dir = car.signal < car.lane ? '⬅' : '➡';
    hint += `<div class="card signal">${dir} 方向燈：等待空隙${car.waitT > 3 ? '（放慢一點，讓旁邊的車先過）' : '…'}</div>`;
  }
  if (status === 'pause') {
    hint = '<div class="card">暫停中（按空白鍵繼續）</div>';
  }

  // 車道示意：目前路段的每一條車道，岔路前顯示各車道去向
  const n = car.edge.lanes;
  const atDecision = up && up.step.i === drive.routeIdx && up.d < 450;
  const br = atDecision ? up.step.br : null;
  let lanes = '';
  for (let i = 0; i < n; i++) {
    const hits = br?.filter((x) => i >= x.a && i < x.b) || [];
    const arrow = hits.length ? hits.map((b) => (b.through ? '↑' : graph.turn(car.edge, b.edge) > 0 ? '↖' : '↗')).join('') : '↑';
    const isGood = hints && good?.includes(i);
    lanes += `<div class="${isGood ? 'good' : ''} ${i === car.lane ? 'me' : ''} ${i === car.signal ? 'sig' : ''}">${arrow}</div>`;
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
    ${scenario.auto ? '<p class="muted">這是程式依地圖資料自動產生的任務，尚未經人工校對。</p>' : ''}
    <p class="muted">車子會自動沿道路前進，你只要決定車道：<b>← →</b> 換車道、<b>↑ ↓</b> 加減速。手機請用畫面下方按鈕。<br>
    指示牌與車道配置由開放資料自動產生，可能和現場不同，實際開車請以現場標誌為準。</p>
    <div class="levels">車流：${Object.entries(LEVELS)
      .map(([k, v]) => `<button class="${k === trafficLevel ? 'on' : ''}" data-level="${k}">${v.label}</button>`)
      .join('')}</div>
    <p class="muted" style="margin-top:6px">有車流時，換車道要先打方向燈，等到空隙才切得過去。越塞越要提早切。</p>
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
  const level = e.target.closest('[data-level]')?.dataset.level;
  if (level) {
    trafficLevel = level;
    for (const b of document.querySelectorAll('[data-level]')) b.classList.toggle('on', b.dataset.level === level);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  hints = act === 'go';
  if (drive.level !== trafficLevel) drive.setTraffic(trafficLevel);
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
  // 模擬固定用 0.1 秒以下的小步前進；加速或畫面很慢時一幀跑多步，跟車模型才會穩定
  const dt = Math.min(clock.getDelta(), 0.1) * TIME_SCALE;
  for (let left = dt; left > 1e-6 && (status === 'run' || status === 'ending'); left -= 0.1) {
    const h = Math.min(0.1, left);
    elapsed += h;
    if (AUTO && (autoTimer -= h) < 0) {
      drive.autopilot();
      autoTimer = 1.2;
    }
    advance(h);
  }
  placeCar(dt);
  drawTraffic();
  const blink = car.signal !== null && Math.floor(performance.now() / 350) % 2 === 0;
  blinkL.visible = blink && car.signal < car.lane;
  blinkR.visible = blink && car.signal > car.lane;
  updateHud();
  drawMinimap();
  renderer.render(scene3, camera);
});

// 給自動測試讀取狀態
window.__drive = { graph, route, steps, car, drive, camera, scene: scene3, THREE, scenario, get status() { return status; }, get routeIdx() { return drive.routeIdx; }, overlayText: () => $('overlayBox').innerText };

// ---- 車子模型 ----
var blinkL;
var blinkR;
function makeCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.4), new THREE.MeshLambertMaterial({ color: 0xd62828 }));
  body.position.y = 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), new THREE.MeshLambertMaterial({ color: 0x1f2a36 }));
  cabin.position.set(0, 1.2, 0.2);
  g.add(body, cabin);
  // 車尾方向燈（車頭朝 -Z，車尾在 +Z）
  const lamp = () => new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.1), new THREE.MeshBasicMaterial({ color: 0xffa500 }));
  blinkL = lamp();
  blinkR = lamp();
  blinkL.position.set(-0.7, 0.75, 2.22);
  blinkR.position.set(0.7, 0.75, 2.22);
  blinkL.visible = blinkR.visible = false;
  g.add(blinkL, blinkR);
  for (const [x, z] of [[-0.85, -1.4], [0.85, -1.4], [-0.85, 1.4], [0.85, 1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  return g;
}
