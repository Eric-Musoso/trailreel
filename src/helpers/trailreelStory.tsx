/**
 * Exports a self-contained, single-file Interactive 3D Web Story (.html).
 * Friends can open it in any browser to play the 3D flyover, scrub the elevation profile,
 * orbit the 3D terrain, switch multi-day chapters, watch ghost riders, and click pinned photos.
 */
import { trailreelDem } from './trailreelDem';
import { trailreelFormat as F } from './trailreelFormat';
import { trailreelMap } from './trailreelMap';
import { trailreelPhotos } from './trailreelPhotos';
import type { Chapter, Enrichment, GhostRider, Photo, Settings, Theme, Track } from './trailreelTypes';

interface StoryInput {
  title: string;
  track: Track;
  photos: Photo[];
  chapters: Chapter[];
  ghosts: GhostRider[];
  settings: Settings;
  theme: Theme;
  enrichment: Enrichment;
}

/** Same MapLibre version the app bundles (package.json), served by the CDN the app already uses for its worker. */
const MAPLIBRE_CDN = 'https://unpkg.com/maplibre-gl@6.16.0/dist';

/**
 * [lon, lat, ele, distance travelled, elapsed s (-1 = none), line part] per kept point.
 * The part number goes up after each transfer between stitched days; points inside a
 * transfer get part -1, so the story draws the route without the untravelled jump.
 */
function downsampleTrack(tr: Track, maxPts = 360) {
  const step = Math.max(1, Math.floor(tr.n / maxPts));
  const idx: number[] = [];
  for (let i = 0; i < tr.n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== tr.n - 1) idx.push(tr.n - 1);
  return idx.map((i) => {
    const f = i / (tr.n - 1);
    const inside = tr.breaks.some(([a, b]) => f > a && f < b);
    const part = inside ? -1 : tr.breaks.filter(([, b]) => b <= f).length;
    return [
      Number(tr.lon[i].toFixed(5)),
      Number(tr.lat[i].toFixed(5)),
      Math.round(tr.ele[i]),
      Math.round(tr.dist[i]),
      Number.isFinite(tr.time[i]) ? Math.round((tr.time[i] - tr.time[0]) / 1000) : -1,
      part,
    ];
  });
}

function buildInteractiveStoryHtml(input: StoryInput): string {
  const { title, track, photos, chapters, ghosts, settings, theme, enrichment } = input;
  const basemap = trailreelMap.BASEMAPS[settings.basemap];
  const u = settings.units;
  const speed = track.stats.avgSpeed != null ? F.speed(track.stats.avgSpeed, u, track.activity.sport) : null;

  const payload = {
    title,
    sport: F.sportLabel[track.activity.sport],
    place: enrichment.place,
    date: track.stats.startTime != null ? F.date(track.stats.startTime, enrichment.timeZone) : null,
    theme,
    basemap: { tiles: basemap.tiles, maxzoom: basemap.maxzoom, attribution: basemap.attribution },
    demUrl: trailreelDem.TERRARIUM_URL,
    exaggeration: settings.exaggeration,
    units: u,
    stats: [
      ['Distance', F.distance(track.stats.distance, u)],
      ['Moving time', track.stats.movingTime != null ? F.duration(track.stats.movingTime) : '—'],
      ['Elevation gain', F.elevation(track.stats.elevGain, u)],
      [speed?.label ?? 'Highest point', speed?.value ?? F.elevation(track.stats.elevMax, u)],
    ],
    points: downsampleTrack(track, 400),
    chapters: chapters.map((c) => ({ name: c.name, startAt: c.startAt, unit: c.unit, ordinal: c.ordinal })),
    ghosts: ghosts.map((g) => ({ name: g.name, color: g.color, points: downsampleTrack(g.track, 220) })),
    ghostSync: settings.ghostSync,
    // Story fraction ↔ route progress knots: playback skims the transfers between days.
    warp: { u: Array.from(track.warpU, (v) => Number(v.toFixed(5))), p: Array.from(track.warpP, (v) => Number(v.toFixed(5))) },
    photos: photos.map((p) => ({
      at: p.at,
      caption: p.caption,
      dataUrl: trailreelPhotos.toDataUrl(p, 720),
    })),
  };

  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${safeTitle} · Interactive 3D Story</title>
<link rel="stylesheet" href="${MAPLIBRE_CDN}/maplibre-gl.css" />
<style>
  :root { --accent: ${theme.accent}; --on-accent: ${theme.onAccent}; --bg: #0b1015; --glass: rgba(16, 22, 29, 0.72); --line: rgba(255,255,255,0.14); }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: #f3f6f9; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; overflow: hidden; }
  #map { position: fixed; inset: 0; }
  .hud-top { position: fixed; top: 16px; left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; z-index: 4; }
  .card { pointer-events: auto; background: var(--glass); backdrop-filter: blur(22px) saturate(180%); -webkit-backdrop-filter: blur(22px) saturate(180%); border: 1px solid var(--line); border-radius: 18px; padding: 14px 18px; box-shadow: 0 18px 40px rgba(0,0,0,0.45); }
  .title { margin: 0; font-size: clamp(18px, 2.5vw, 26px); font-weight: 800; letter-spacing: -0.02em; }
  .sub { margin: 4px 0 10px; font-size: 12px; color: rgba(255,255,255,0.72); letter-spacing: 0.03em; text-transform: uppercase; }
  .stats { display: flex; flex-wrap: wrap; gap: 16px; }
  .stat span { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.62); }
  .stat strong { font-size: 15px; font-variant-numeric: tabular-nums; }
  .chapters { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .chap-btn { border: 1px solid var(--line); background: rgba(255,255,255,0.08); color: #fff; border-radius: 999px; padding: 5px 11px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .chap-btn.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .hud-bottom { position: fixed; bottom: 16px; left: 16px; right: 16px; z-index: 4; pointer-events: none; display: flex; justify-content: center; }
  .player { pointer-events: auto; width: min(860px, 100%); display: flex; flex-direction: column; gap: 8px; }
  .controls { display: flex; align-items: center; gap: 12px; }
  .play { width: 42px; height: 42px; border-radius: 50%; border: none; background: var(--accent); color: var(--on-accent); font-size: 15px; font-weight: 700; cursor: pointer; flex: 0 0 auto; }
  .play:active { transform: scale(0.95); }
  #profile { width: 100%; height: 56px; display: block; cursor: crosshair; touch-action: none; }
  .readout { display: flex; justify-content: space-between; font-size: 12.5px; color: rgba(255,255,255,0.82); font-variant-numeric: tabular-nums; }
  .pin { width: 38px; height: 38px; border-radius: 10px; border: 2.5px solid #fff; box-shadow: 0 6px 16px rgba(0,0,0,0.45); background-size: cover; background-position: center; cursor: pointer; transition: transform 150ms ease; }
  .pin:hover { transform: scale(1.12); }
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); display: none; place-items: center; z-index: 10; padding: 20px; }
  .modal.open { display: grid; }
  .polaroid { background: #fff; color: #16191d; padding: 12px 12px 16px; border-radius: 16px; max-width: min(560px, 92vw); max-height: 85vh; box-shadow: 0 24px 60px rgba(0,0,0,0.6); text-align: center; }
  .polaroid img { max-width: 100%; max-height: 68vh; border-radius: 8px; display: block; }
  .polaroid p { margin: 10px 4px 0; font-weight: 600; font-size: 15px; }
  @media (prefers-reduced-transparency: reduce) { .card { backdrop-filter: none; background: #141b22; } }
</style>
</head>
<body>
<div id="map"></div>
<div class="hud-top">
  <div class="card">
    <h1 class="title" id="storyTitle"></h1>
    <p class="sub" id="storySub"></p>
    <div class="stats" id="storyStats"></div>
    <div class="chapters" id="storyChapters"></div>
  </div>
</div>
<div class="hud-bottom">
  <div class="card player">
    <div class="readout"><span id="rDist">0</span><span id="rEle">–</span><span id="rTime">–</span></div>
    <div class="controls">
      <button class="play" id="btnPlay" aria-label="Play">▶</button>
      <canvas id="profile"></canvas>
    </div>
  </div>
</div>
<div class="modal" id="photoModal"><div class="polaroid"><img id="modalImg" alt="" /><p id="modalCap"></p></div></div>
<script type="module">
// MapLibre 6 ships as an ES module only (there is no maplibre-gl.js UMD build), with its worker
// loaded from the same CDN, exactly as the app itself does.
import * as maplibregl from '${MAPLIBRE_CDN}/maplibre-gl.mjs';
maplibregl.setWorkerUrl('${MAPLIBRE_CDN}/maplibre-gl-worker.mjs');
const STORY = ${safeJson};
document.getElementById('storyTitle').textContent = STORY.title;
document.getElementById('storySub').textContent = [STORY.sport, STORY.date, STORY.place].filter(Boolean).join(' · ');
document.getElementById('storyStats').innerHTML = STORY.stats.map(([k, v]) => '<div class="stat"><span>' + k + '</span><strong>' + v + '</strong></div>').join('');
const pts = STORY.points;
function routeParts() {
  const parts = [];
  pts.forEach(p => {
    if (p[5] < 0) return;
    (parts[p[5]] = parts[p[5]] || []).push([p[0], p[1]]);
  });
  return parts.filter(part => part && part.length > 1);
}
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const span = xs[i] - xs[i - 1]; return span > 0 ? ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / span : ys[i]; }
  return ys[ys.length - 1];
}
const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: STORY.basemap.tiles, tileSize: 256, maxzoom: STORY.basemap.maxzoom, attribution: STORY.basemap.attribution },
      dem: { type: 'raster-dem', tiles: [STORY.demUrl], encoding: 'terrarium', tileSize: 256, maxzoom: 14 },
      route: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: routeParts() } } }
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': STORY.theme.casing, 'line-width': 8 } },
      { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': STORY.theme.route, 'line-width': 4.5 } }
    ],
    terrain: { source: 'dem', exaggeration: STORY.exaggeration },
    sky: { 'sky-color': '#6fa8dc', 'horizon-color': '#dceaf5', 'fog-color': '#e6eef4', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.88 }
  },
  bounds, fitBoundsOptions: { padding: 80 }, pitch: 52, maxPitch: 80
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
const markerEl = document.createElement('div');
markerEl.style.cssText = 'width:18px;height:18px;border-radius:50%;background:' + STORY.theme.accent + ';border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)';
const avatar = new maplibregl.Marker({ element: markerEl }).setLngLat([pts[0][0], pts[0][1]]).addTo(map);
const ghostMarkers = STORY.ghosts.map((g, gi) => {
  const el = document.createElement('div');
  el.style.cssText = 'padding:2px 7px;border-radius:99px;background:rgba(14,19,24,0.8);border:2px solid ' + g.color + ';color:#fff;font-size:11px;font-weight:700';
  el.textContent = g.name;
  return { g, marker: new maplibregl.Marker({ element: el }).setLngLat([g.points[0][0], g.points[0][1]]).addTo(map) };
});
STORY.photos.forEach(ph => {
  const idx = Math.min(pts.length - 1, Math.max(0, Math.round(ph.at * (pts.length - 1))));
  const el = document.createElement('button');
  el.className = 'pin';
  el.style.backgroundImage = 'url(' + ph.dataUrl + ')';
  el.onclick = () => {
    document.getElementById('modalImg').src = ph.dataUrl;
    document.getElementById('modalCap').textContent = ph.caption || '';
    document.getElementById('photoModal').classList.add('open');
  };
  new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([pts[idx][0], pts[idx][1]]).addTo(map);
});
document.getElementById('photoModal').onclick = () => document.getElementById('photoModal').classList.remove('open');
const chapterButtons = [];
if (STORY.chapters.length > 1) {
  const box = document.getElementById('storyChapters');
  STORY.chapters.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'chap-btn' + (i === 0 ? ' active' : '');
    b.textContent = c.unit + ' ' + c.ordinal + ': ' + c.name;
    b.onclick = () => { playing = false; document.getElementById('btnPlay').textContent = '▶'; setProgress(c.startAt, true); };
    box.appendChild(b);
    chapterButtons.push(b);
  });
}
const canvas = document.getElementById('profile');
const ctx = canvas.getContext('2d');
let progress = 0, playing = false, lastTs = 0;
function sample(arr, f) {
  const x = Math.max(0, Math.min(1, f)) * (arr.length - 1);
  const i = Math.min(arr.length - 2, Math.floor(x)), t = x - i;
  return arr[i].map((v, k) => v + (arr[i + 1][k] - v) * t);
}
// Race mode: a ghost is where it was after the same elapsed time; otherwise at the same share of its route.
function ghostAt(g, f, here) {
  const gp = g.points;
  if (STORY.ghostSync !== 'time' || here[4] < 0 || gp[0][4] < 0) return sample(gp, f);
  if (here[4] >= gp[gp.length - 1][4]) return gp[gp.length - 1];
  let lo = 0, hi = gp.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (gp[mid][4] < here[4]) lo = mid; else hi = mid; }
  const span = Math.max(1, gp[hi][4] - gp[lo][4]);
  return sample(gp, (lo + (here[4] - gp[lo][4]) / span) / (gp.length - 1));
}
// The profile's x axis is distance travelled (p[3]), so a transfer between days takes no width.
const totalDist = Math.max(1, pts[pts.length - 1][3]);
const travelX = f => sample(pts, f)[3] / totalDist;
function progressAtX(x) {
  const target = Math.max(0, Math.min(1, x)) * totalDist;
  for (let i = 1; i < pts.length; i++) if (pts[i][3] >= target) {
    const span = pts[i][3] - pts[i - 1][3];
    return (i - 1 + (span > 0 ? (target - pts[i - 1][3]) / span : 1)) / (pts.length - 1);
  }
  return 1;
}
const profilePts = pts.filter(p => p[5] >= 0);
function drawProfile() {
  const dpr = devicePixelRatio || 1;
  const W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const eles = profilePts.map(p => p[2]);
  const lo = Math.min(...eles), span = Math.max(20, Math.max(...eles) - lo);
  const done = travelX(progress);
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(0, H);
  profilePts.forEach(p => ctx.lineTo((p[3] / totalDist) * W, H - 6 * dpr - ((p[2] - lo) / span) * (H - 12 * dpr)));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W * done, H);
  ctx.clip();
  ctx.fillStyle = STORY.theme.accent;
  ctx.globalAlpha = 0.65;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.fillRect(W * done - dpr, 0, 2 * dpr, H);
}
function setProgress(f, fly) {
  progress = Math.max(0, Math.min(1, f));
  const s = sample(pts, progress);
  avatar.setLngLat([s[0], s[1]]);
  ghostMarkers.forEach(({ g, marker }) => { const gs = ghostAt(g, progress, s); marker.setLngLat([gs[0], gs[1]]); });
  let current = 0;
  STORY.chapters.forEach((c, i) => { if (progress >= c.startAt) current = i; });
  chapterButtons.forEach((b, i) => b.classList.toggle('active', i === current));
  document.getElementById('rDist').textContent = STORY.units === 'imperial' ? (s[3] / 1609.344).toFixed(2) + ' mi' : (s[3] / 1000).toFixed(2) + ' km';
  document.getElementById('rEle').textContent = STORY.units === 'imperial' ? Math.round(s[2] * 3.28084) + ' ft' : Math.round(s[2]) + ' m';
  const sec = Math.round(s[4]);
  document.getElementById('rTime').textContent = s[4] < 0 ? '–' : sec >= 3600 ? Math.floor(sec / 3600) + 'h ' + String(Math.floor((sec % 3600) / 60)).padStart(2, '0') + 'm' : Math.floor(sec / 60) + 'm ' + String(sec % 60).padStart(2, '0') + 's';
  if (fly) map.easeTo({ center: [s[0], s[1]], zoom: Math.max(map.getZoom(), 13.5), pitch: 58, duration: 400 });
  drawProfile();
}
canvas.addEventListener('pointerdown', e => {
  playing = false; document.getElementById('btnPlay').textContent = '▶';
  const r = canvas.getBoundingClientRect(); setProgress(progressAtX((e.clientX - r.left) / r.width), true);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => { if (e.buttons) { const r = canvas.getBoundingClientRect(); setProgress(progressAtX((e.clientX - r.left) / r.width), true); } });
document.getElementById('btnPlay').onclick = () => {
  if (progress >= 1) progress = 0;
  playing = !playing;
  document.getElementById('btnPlay').textContent = playing ? '❚❚' : '▶';
};
function loop(ts) {
  if (playing) {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    // Advance in story time so a long transfer between days passes in a moment.
    const u = interp(STORY.warp.p, STORY.warp.u, progress) + dt / 24;
    progress = u >= 1 ? 1 : interp(STORY.warp.u, STORY.warp.p, u);
    if (progress >= 1) { progress = 1; playing = false; document.getElementById('btnPlay').textContent = '▶'; }
    const s = sample(pts, progress);
    setProgress(progress, false);
    map.jumpTo({ center: [s[0], s[1]], zoom: 13.8, pitch: 60 });
  }
  lastTs = ts;
  requestAnimationFrame(loop);
}
window.addEventListener('resize', drawProfile);
map.on('load', () => { setProgress(0, false); requestAnimationFrame(loop); });
</script>
</body>
</html>`;
}

export const trailreelStory = { buildInteractiveStoryHtml };
