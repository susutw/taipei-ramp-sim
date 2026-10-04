// 地圖頁：顯示所有出入口，點選後顯示資訊與試開入口。

import { alias } from './drive/graph.js';

const KIND_COLOR = { 入口: '#16a34a', 出口: '#dc2626', 系統: '#2563eb', 雙向: '#9333ea', 其他: '#6b7280' };

const [ramps, mainlines, scenarios] = await Promise.all([
  fetch('data/ramps.geojson').then((r) => r.json()),
  fetch('data/mainlines.geojson').then((r) => r.json()),
  fetch('data/scenarios.json').then((r) => r.json()),
]);

const scenarioByRamp = new Map(scenarios.map((s) => [s.ramp, s]));
for (const f of ramps.features) {
  f.properties.drive = scenarioByRamp.has(f.properties.id);
}
const points = {
  type: 'FeatureCollection',
  features: ramps.features.map((f) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: f.properties.point },
    properties: { id: f.properties.id, kind: f.properties.kind, drive: f.properties.drive },
  })),
};
const byId = new Map(ramps.features.map((f) => [f.properties.id, f]));

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [121.545, 25.05],
  zoom: 12,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

const kindMatch = ['match', ['get', 'kind'], ...Object.entries(KIND_COLOR).flat(), '#6b7280'];

map.on('load', () => {
  map.addSource('mainlines', { type: 'geojson', data: mainlines });
  map.addSource('ramps', { type: 'geojson', data: ramps, promoteId: 'id' });
  map.addSource('points', { type: 'geojson', data: points, promoteId: 'id' });

  map.addLayer({
    id: 'mainlines',
    type: 'line',
    source: 'mainlines',
    paint: {
      'line-color': ['case', ['get', 'elevated'], '#f59e0b', '#fbbf24'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 8],
      'line-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'ramps',
    type: 'line',
    source: 'ramps',
    paint: {
      'line-color': kindMatch,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['boolean', ['feature-state', 'selected'], false], 4, 1.5], 16, ['case', ['boolean', ['feature-state', 'selected'], false], 9, 4]],
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0.75],
    },
  });
  map.addLayer({
    id: 'drive-ring',
    type: 'circle',
    source: 'points',
    filter: ['get', 'drive'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 15],
      'circle-color': '#facc15',
      'circle-stroke-color': '#a16207',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8],
      'circle-color': kindMatch,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5],
    },
  });

  map.on('click', 'points', (e) => select(e.features[0].properties.id, { fly: false }));
  map.on('click', 'ramps', (e) => select(e.features[0].properties.id, { fly: false }));
  for (const layer of ['points', 'ramps']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (byId.has(fromHash)) select(fromHash);
});

// ---- 選取 ----
let selected = null;
let popup = null;

function select(id, { fly = true } = {}) {
  const f = byId.get(id);
  if (!f) return;
  if (selected) {
    map.setFeatureState({ source: 'ramps', id: selected }, { selected: false });
    map.setFeatureState({ source: 'points', id: selected }, { selected: false });
  }
  selected = id;
  map.setFeatureState({ source: 'ramps', id }, { selected: true });
  map.setFeatureState({ source: 'points', id }, { selected: true });
  history.replaceState(null, '', `#${id}`);

  const p = f.properties;
  if (fly) map.flyTo({ center: p.point, zoom: Math.max(map.getZoom(), 16), speed: 1.6 });

  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '320px', offset: 10 }).setLngLat(p.point).setHTML(popupHTML(p)).addTo(map);

  for (const li of listEl.querySelectorAll('li')) li.classList.toggle('on', li.dataset.id === id);
  listEl.querySelector(`li[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  if (window.matchMedia('(max-width: 720px)').matches) document.body.classList.remove('panel-open');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function popupHTML(p) {
  const [lon, lat] = p.point;
  const rows = [
    ['類型', `<span class="badge" style="background:${KIND_COLOR[p.kind]}">${esc(p.kind)}</span>`],
    p.from.length && ['從', esc(p.from.map(alias).join('、'))],
    p.to.length && ['接到', esc(p.to.map(alias).join('、'))],
    p.surface.length && ['平面道路', esc(p.surface.join('、'))],
    p.destination && ['指引', esc(p.destination.replaceAll(';', '、'))],
    p.lanes && ['車道數', `${p.lanes}`],
    p.name && ['OSM 名稱', esc(p.name)],
    p.note && ['備註', esc(p.note)],
  ].filter(Boolean);
  const scenario = scenarioByRamp.get(p.id);
  const drive = scenario
    ? `<a class="btn primary" href="drive.html?s=${encodeURIComponent(scenario.id)}">3D 試開：${esc(scenario.title)}</a>`
    : `<span class="muted">這個出入口還沒有 3D 試開，<a href="https://github.com/susutw/taipei-ramp-sim/issues" target="_blank" rel="noopener">看進度</a></span>`;
  return `
    <h3>${esc(p.title)}</h3>
    <table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    <div class="actions">
      ${drive}
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}">街景</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.openstreetmap.org/way/${p.ways[0]}">OSM</a>
    </div>`;
}

// ---- 列表 ----
const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const driveOnlyEl = document.getElementById('driveOnly');
const countEl = document.getElementById('count');
let kind = '';

function renderList() {
  const q = searchEl.value.trim();
  const items = ramps.features
    .map((f) => f.properties)
    .filter((p) => p.kind !== '其他')
    .filter((p) => !kind || p.kind === kind)
    .filter((p) => !driveOnlyEl.checked || p.drive)
    .filter((p) => !q || [p.title, p.name, p.destination, ...p.road, ...p.surface].join(' ').includes(q));

  // 依主要道路分組
  const groups = new Map();
  for (const p of items) {
    const key = p.title.split(/[ →]/)[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  countEl.textContent = `${items.length} 個出入口`;
  listEl.innerHTML = [...groups]
    .sort((a, b) => b[1].some((p) => p.drive) - a[1].some((p) => p.drive) || b[1].length - a[1].length)
    .map(([road, ps]) => `
      <li class="group">${esc(road)}<span>${ps.length}</span></li>
      ${ps.map((p) => `
        <li data-id="${p.id}" class="${p.id === selected ? 'on' : ''}">
          <i style="background:${KIND_COLOR[p.kind]}"></i>
          <span>${esc(p.title.replace(road, '').trim() || p.title)}</span>
          ${p.drive ? '<span class="badge drive">可試開</span>' : ''}
        </li>`).join('')}`)
    .join('');
}

listEl.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) select(li.dataset.id);
});
searchEl.addEventListener('input', renderList);
driveOnlyEl.addEventListener('change', renderList);
document.getElementById('kinds').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  kind = b.dataset.kind;
  for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
  renderList();
});
document.getElementById('togglePanel').addEventListener('click', () => document.body.classList.toggle('panel-open'));
renderList();
