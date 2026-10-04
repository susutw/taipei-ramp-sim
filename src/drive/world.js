// 3D 場景：路面、高架結構、標線、建物、指示牌。
// 場景座標 (x 東, y 北, h 高) 對應到 three.js 的 (x, h, -y)。

import * as THREE from 'three';
import { LANE_W, isLink, isMajor } from './graph.js';

const ELEVATED = 2; // 高於此高度視為高架，畫橋面側邊、護欄、橋墩
const DECK = 1.4; // 橋面厚度
const PIER_EVERY = 32;

export function buildWorld(scene, graph) {
  const group = new THREE.Group();
  const roads = new Builder();
  const deck = new Builder();
  const marks = new Builder();
  const yellow = new Builder();

  // 依路段等級稍微抬高，避免重疊處閃爍
  const lift = (way) => (isMajor(way) ? (isLink(way) ? 0.1 : 0.14) : 0.04 + (way.hw === 'residential' ? 0 : 0.02));

  scene.edges.forEach((e, ei) => {
    const way = scene.ways[e.w];
    const pts = e.n.map((i) => [graph.x(i), graph.y(i), graph.h(i)]);
    if (pts.length < 2) return;
    const nF = graph.dirEdge.get(`${ei}:${way.oneway === -1 ? -1 : 1}`)?.lanes ?? 1;
    const nB = way.oneway ? 0 : graph.dirEdge.get(`${ei}:-1`)?.lanes ?? 1;
    const half = way.oneway ? (nF * LANE_W) / 2 + 0.5 : ((nF + nB) * LANE_W) / 2 + 0.6;
    const up = lift(way);

    roads.ribbon(pts, -half, half, up);

    const elevated = pts.some((p) => p[2] > ELEVATED);
    if (elevated) {
      deck.wall(pts, -half, up, -DECK);
      deck.wall(pts, half, up, -DECK);
      deck.ribbon(pts, -half, half, -DECK, true);
      deck.wall(pts, -half - 0.15, up + 0.9, up - 0.2);
      deck.wall(pts, half + 0.15, up + 0.9, up - 0.2);
      deck.piers(pts, Math.max(1.6, half * 0.5), DECK);
    }

    // 標線
    const m = up + 0.02;
    if (way.oneway) {
      for (let j = 1; j < nF; j++) marks.strip(pts, (j - nF / 2) * LANE_W, 0.15, m, 4, 6);
      if (isMajor(way)) {
        marks.strip(pts, -half + 0.35, 0.15, m);
        marks.strip(pts, half - 0.35, 0.15, m);
      }
    } else {
      yellow.strip(pts, -0.15, 0.12, m);
      yellow.strip(pts, 0.15, 0.12, m);
      for (let j = 1; j < nF; j++) marks.strip(pts, 0.2 + j * LANE_W, 0.12, m, 4, 6);
      for (let j = 1; j < nB; j++) marks.strip(pts, -0.2 - j * LANE_W, 0.12, m, 4, 6);
    }
  });

  group.add(roads.mesh(new THREE.MeshLambertMaterial({ color: 0x45484e, side: THREE.DoubleSide })));
  group.add(deck.mesh(new THREE.MeshLambertMaterial({ color: 0xb9b6ae, side: THREE.DoubleSide })));
  group.add(marks.mesh(new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide })));
  group.add(yellow.mesh(new THREE.MeshBasicMaterial({ color: 0xf2c230, side: THREE.DoubleSide })));
  group.add(buildBuildings(scene.buildings));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: 0x8f9a86 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  group.add(buildSigns(graph));
  return group;
}

// 收集三角形，最後合併成一個 mesh
class Builder {
  constructor() { this.pos = []; }

  tri(a, b, c) { this.pos.push(...a, ...b, ...c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  // 沿折線往右偏移 off 公尺，回傳 three.js 座標點
  offset(pts, off, up) {
    return pts.map((p, i) => {
      const [nx, ny] = miter(pts, i);
      return [p[0] + nx * off, p[2] + up, -(p[1] + ny * off)];
    });
  }

  ribbon(pts, l, r, up, flip = false) {
    const L = this.offset(pts, l, up);
    const R = this.offset(pts, r, up);
    for (let i = 1; i < pts.length; i++) {
      if (flip) this.quad(L[i - 1], R[i - 1], R[i], L[i]);
      else this.quad(L[i - 1], L[i], R[i], R[i - 1]);
    }
  }

  wall(pts, off, top, bottom) {
    const T = this.offset(pts, off, top);
    const B = this.offset(pts, off, bottom);
    for (let i = 1; i < pts.length; i++) this.quad(B[i - 1], B[i], T[i], T[i - 1]);
  }

  // 標線：寬 w 的細條，dash/gap 有值時畫虛線
  strip(pts, off, w, up, dash = 0, gap = 0) {
    const L = this.offset(pts, off - w / 2, up);
    const R = this.offset(pts, off + w / 2, up);
    if (!dash) {
      for (let i = 1; i < pts.length; i++) this.quad(L[i - 1], L[i], R[i], R[i - 1]);
      return;
    }
    let phase = 0;
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let t = 0;
      while (t < len) {
        const period = dash + gap;
        const inDash = phase % period < dash;
        const step = Math.min(len - t, inDash ? dash - (phase % period) : period - (phase % period));
        if (inDash && step > 0.05) {
          const a = t / len;
          const b = (t + step) / len;
          this.quad(lerp3(L[i - 1], L[i], a), lerp3(L[i - 1], L[i], b), lerp3(R[i - 1], R[i], b), lerp3(R[i - 1], R[i], a));
        }
        t += step;
        phase += step;
      }
    }
  }

  piers(pts, size, deck) {
    let acc = PIER_EVERY / 2;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay, ah] = pts[i - 1];
      const [bx, by, bh] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      while (acc < len) {
        const t = acc / len;
        const h = ah + (bh - ah) * t - deck;
        if (h > 1) this.box(ax + (bx - ax) * t, ay + (by - ay) * t, size, 0, h);
        acc += PIER_EVERY;
      }
      acc -= len;
    }
  }

  box(x, y, s, h0, h1) {
    const c = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([dx, dy]) => [x + dx / 2, y + dy / 2]);
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = c[i];
      const [bx, by] = c[(i + 1) % 4];
      this.quad([ax, h0, -ay], [bx, h0, -by], [bx, h1, -by], [ax, h1, -ay]);
    }
  }

  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 第 i 點的右向法線（轉角處取兩段平均，並限制尖角時的放大倍數）
function miter(pts, i) {
  const seg = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  };
  const n1 = i > 0 ? seg(pts[i - 1], pts[i]) : null;
  const n2 = i < pts.length - 1 ? seg(pts[i], pts[i + 1]) : null;
  if (!n1) return n2;
  if (!n2) return n1;
  let nx = n1[0] + n2[0];
  let ny = n1[1] + n2[1];
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  const cos = nx * n1[0] + ny * n1[1];
  const k = 1 / Math.max(cos, 0.5);
  return [nx * k, ny * k];
}

function buildBuildings(list) {
  const pos = [];
  const col = [];
  const palette = [0xd9d4c7, 0xcfcac0, 0xe3ded2, 0xbfc4c9, 0xd6cfc2, 0xc9c2b4, 0xaeb7bf].map((c) => new THREE.Color(c));
  const push = (p, c) => { pos.push(...p); col.push(c.r, c.g, c.b); };

  list.forEach((b, bi) => {
    let pts = [];
    for (let i = 0; i < b.p.length; i += 2) pts.push(new THREE.Vector2(b.p[i], b.p[i + 1]));
    if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
    const base = palette[bi % palette.length];
    const wallC = base;
    const roofC = base.clone().multiplyScalar(0.82);
    const h = b.h;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      const shade = wallC.clone().multiplyScalar(0.86 + 0.14 * Math.abs(Math.sin(Math.atan2(c.y - a.y, c.x - a.x))));
      const q = [[a.x, 0, -a.y], [c.x, 0, -c.y], [c.x, h, -c.y], [a.x, h, -a.y]];
      for (const k of [0, 1, 2, 0, 2, 3]) push(q[k], shade);
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      for (const v of [i, j, k]) push([pts[v].x, h, -pts[v].y], roofC);
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

// ---- 指示牌 ----
// 在每個需要選擇的岔路前約 90 m 架一座門架，每個選項一塊綠底白字的牌面，
// 掛在該選項對應的車道正上方。文字來自 OSM 的 destination 或道路名稱，
// 與現場實際牌面不一定相同（見 README「人工校對」）。

const SIGN_AHEAD = 90;

function buildSigns(graph) {
  const group = new THREE.Group();
  const posts = [];
  for (const D of graph.edges) {
    const br = graph.branches(D);
    if (br.length < 2) continue;
    if (!br.some((b) => isMajor(b.edge.way))) continue;

    // 找門架位置：沿來向往回 SIGN_AHEAD 公尺
    let edge = D;
    let s = D.len - SIGN_AHEAD;
    while (s < 0) {
      const prev = graph.in[edge.pts[0]].filter((e) => e.w === edge.w || (isMajor(e.way) === isMajor(edge.way) && e.way.name === edge.way.name));
      if (prev.length !== 1) { s = 0; break; }
      edge = prev[0];
      s += edge.len;
    }
    const p = graph.sample(edge, s);
    const fx = p.tx;
    const fy = p.ty;
    const rx = fy;
    const ry = -fx; // 右向
    const y = p.h + (isMajor(edge.way) ? 0.14 : 0.05) + 5.6;
    const rot = Math.atan2(-fx, fy); // 讓牌面朝向來車

    let minOff = Infinity;
    let maxOff = -Infinity;
    for (const b of br) {
      const width = Math.max(1, b.b - b.a) * LANE_W - 0.3;
      const off = graph.laneOffset(D, (b.a + b.b - 1) / 2);
      minOff = Math.min(minOff, off - width / 2);
      maxOff = Math.max(maxOff, off + width / 2);
      const turn = graph.turn(D, b.edge);
      const arrow = b.through ? '↑' : turn > 0 ? '↖' : '↗';
      const panel = signPanel(graph.labelFor(b.edge, D), arrow, width);
      panel.position.set(p.x + rx * off, y, -(p.y + ry * off));
      panel.rotation.y = rot;
      group.add(panel);
    }
    // 門架橫樑與立柱
    const beamLen = maxOff - minOff + 1.2;
    const mid = (minOff + maxOff) / 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.3, 0.3), postMaterial);
    beam.position.set(p.x + rx * mid, y + 1.4, -(p.y + ry * mid));
    beam.rotation.y = rot;
    group.add(beam);
    for (const off of [minOff - 0.6, maxOff + 0.6]) {
      posts.push([p.x + rx * off, p.y + ry * off, p.h, y + 1.4]);
    }
  }
  for (const [x, y, h0, h1] of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h1 - h0, 8), postMaterial);
    post.position.set(x, (h0 + h1) / 2, -y);
    group.add(post);
  }
  return group;
}

const postMaterial = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });

function signPanel(text, arrow, width) {
  const H = 2.6;
  const W = Math.max(width, 2.8);
  const scale = 96; // 每公尺像素
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b6b3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(H * scale * 0.42)}px system-ui, "PingFang TC", "Noto Sans TC", sans-serif`;
  ctx.fillText(arrow, canvas.width / 2, canvas.height * 0.72);
  let size = Math.round(H * scale * 0.3);
  ctx.font = `bold ${size}px system-ui, "PingFang TC", "Noto Sans TC", sans-serif`;
  while (ctx.measureText(text).width > canvas.width - 40 && size > 12) {
    size -= 2;
    ctx.font = `bold ${size}px system-ui, "PingFang TC", "Noto Sans TC", sans-serif`;
  }
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  return mesh;
}
