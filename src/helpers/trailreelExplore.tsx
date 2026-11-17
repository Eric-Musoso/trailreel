/**
 * Interactive 3D route explorer (Relive's "View interactive route"): free camera over the
 * terrain, the route coloured by grade or speed, and an elevation profile you can scrub.
 * Scrubbing moves a marker and the camera and shows distance, elevation, time, grade and pace.
 */
import { NavigationControl, type Map as MLMap } from 'maplibre-gl';
import { trailreelFormat as F } from './trailreelFormat';
import { trailreelMap } from './trailreelMap';
import { trailreelTrack } from './trailreelTrack';
import type { CameraRig, RouteLayer, Settings, Theme, Track } from './trailreelTypes';

interface ExploreDeps {
  root: HTMLElement;
  map: MLMap;
  overlay: HTMLCanvasElement;
  getTrack: () => Track | null;
  getSettings: () => Settings;
  getTheme: () => Theme;
  getRig: () => CameraRig | null;
}

type Stop = [number, string];
const GRADE_STOPS: Stop[] = [
  [-12, '#1d4ed8'],
  [-6, '#0ea5e9'],
  [-2, '#22c55e'],
  [2, '#22c55e'],
  [5, '#eab308'],
  [8, '#f97316'],
  [12, '#dc2626'],
];
const SPEED_STOPS: Stop[] = [
  [0, '#1d4ed8'],
  [0.35, '#22c55e'],
  [0.7, '#eab308'],
  [1, '#dc2626'],
];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function ramp(stops: Stop[], v: number): string {
  if (!Number.isFinite(v)) return '#9aa4ad';
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      const A = hexToRgb(ca);
      const B = hexToRgb(cb);
      return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
    }
  }
  return stops[stops.length - 1][1];
}

function percentile(values: number[], p: number) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * p)))];
}

export function trailreelExplore(deps: ExploreDeps) {
  const { root, map, overlay } = deps;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const profile = $<HTMLCanvasElement>('exploreProfile');
  const octx = overlay.getContext('2d')!;
  const nav = new NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true });
  let active = false;
  let layer: RouteLayer = 'route';
  let hover: number | null = null;
  let lastEase = 0;
  let speedRange: [number, number] = [0, 1];

  function colorAt(track: Track, i: number): string {
    if (layer === 'grade') return ramp(GRADE_STOPS, track.grade[i]);
    if (layer === 'speed') {
      const [lo, hi] = speedRange;
      return ramp(SPEED_STOPS, (track.speed[i] - lo) / Math.max(1e-6, hi - lo));
    }
    return deps.getTheme().route;
  }

  function applyRoute() {
    const track = deps.getTrack();
    if (!track) return;
    const theme = deps.getTheme();
    if (layer === 'route') {
      trailreelMap.setRouteGradient(map, trailreelMap.progressGradient(1, theme.route, track.breaks), theme.casing, track.breaks);
      return;
    }
    const N = 160;
    const stops: [number, string][] = [];
    for (let k = 0; k < N; k++) {
      const f = k / (N - 1);
      stops.push([f, colorAt(track, Math.round(f * (track.n - 1)))]);
    }
    trailreelMap.setRouteGradient(map, trailreelMap.rampGradient(stops, track.breaks), '#ffffff', track.breaks);
  }

  function updateLegend() {
    const legend = $('exploreLegend');
    const units = deps.getSettings().units;
    if (layer === 'grade') legend.textContent = 'Grade: blue downhill · green flat · red steep climb (±12%)';
    else if (layer === 'speed') {
      const track = deps.getTrack();
      const sport = track?.activity.sport ?? 'other';
      legend.textContent = track?.hasTime
        ? `Speed: blue ${F.speed(speedRange[0], units, sport).value} → red ${F.speed(speedRange[1], units, sport).value}`
        : 'Speed needs timestamps; this activity has none.';
    } else legend.textContent = 'Drag to pan, right-drag or Ctrl+drag to tilt and rotate, scroll to zoom.';
    root.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layer)));
  }

  function setReadout(f: number | null) {
    const track = deps.getTrack();
    if (!track) return;
    const { units } = deps.getSettings();
    const sport = track.activity.sport;
    if (f == null) {
      const s = track.stats;
      $('exDist').textContent = F.distance(s.distance, units);
      $('exEle').textContent = `${F.elevation(s.elevGain, units)} gain`;
      $('exTime').textContent = s.movingTime != null ? F.duration(s.movingTime) : '–';
      $('exGrade').textContent = `max ${F.elevation(s.elevMax, units)}`;
      $('exSpeed').textContent = s.avgSpeed != null ? F.speed(s.avgSpeed, units, sport).value : '–';
      return;
    }
    const p = trailreelTrack.sampleAt(track, f);
    $('exDist').textContent = F.distance(p.dist, units);
    $('exEle').textContent = F.elevation(p.ele, units);
    $('exTime').textContent = track.hasTime && Number.isFinite(p.time) ? F.elapsed((p.time - track.time[0]) / 1000) : '–';
    $('exGrade').textContent = F.grade(p.grade);
    $('exSpeed').textContent = Number.isFinite(p.speed) ? F.speed(p.speed, units, sport).value : '–';
  }

  function drawProfile() {
    const track = deps.getTrack();
    if (!track) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(profile.clientWidth * dpr));
    const H = Math.max(1, Math.round(profile.clientHeight * dpr));
    if (profile.width !== W || profile.height !== H) {
      profile.width = W;
      profile.height = H;
    }
    const c = profile.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    const lo = track.stats.elevMin;
    const span = Math.max(20, track.stats.elevMax - lo);
    const top = 6 * dpr;
    const usable = H - top - 2 * dpr;
    const yAt = (i: number) => top + usable - ((track.ele[i] - lo) / span) * usable;
    // x is the distance travelled, so a transfer between stitched days takes no width.
    const cols = Math.min(W, 600);
    const idxAt = (k: number) => Math.round(trailreelTrack.travelToProgress(track, k / (cols - 1)) * (track.n - 1));
    for (let k = 0; k < cols; k++) {
      const i = idxAt(k);
      const x0 = (k / cols) * W;
      const x1 = ((k + 1) / cols) * W + 1;
      c.fillStyle = colorAt(track, i);
      c.globalAlpha = 0.85;
      c.fillRect(x0, yAt(i), x1 - x0, H - yAt(i));
    }
    c.globalAlpha = 1;
    c.beginPath();
    for (let k = 0; k < cols; k++) {
      const i = idxAt(k);
      const x = (k / (cols - 1)) * W;
      if (k) c.lineTo(x, yAt(i));
      else c.moveTo(x, yAt(i));
    }
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 1.5 * dpr;
    c.stroke();
    if (hover != null) {
      const x = trailreelTrack.progressToTravel(track, hover) * W;
      c.fillStyle = '#fff';
      c.fillRect(x - dpr, 0, 2 * dpr, H);
      c.beginPath();
      c.arc(x, yAt(Math.round(hover * (track.n - 1))), 5 * dpr, 0, Math.PI * 2);
      c.fill();
    }
  }

  function drawMarkers() {
    if (!active) return;
    const track = deps.getTrack();
    if (!track) return;
    const scale = overlay.width / Math.max(1, overlay.clientWidth);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const dot = (f: number, fill: string, r: number) => {
      const p = trailreelTrack.sampleAt(track, f);
      const pt = map.project([p.lon, p.lat]);
      if (!Number.isFinite(pt.x)) return;
      octx.beginPath();
      octx.arc(pt.x * scale, pt.y * scale, r * scale, 0, Math.PI * 2);
      octx.fillStyle = '#fff';
      octx.fill();
      octx.beginPath();
      octx.arc(pt.x * scale, pt.y * scale, (r - 3) * scale, 0, Math.PI * 2);
      octx.fillStyle = fill;
      octx.fill();
    };
    dot(0, '#16a34a', 9);
    dot(1, '#111418', 9);
    if (hover != null) dot(hover, deps.getTheme().accent === '#f4f6f8' ? '#111418' : deps.getTheme().accent, 11);
  }

  function setHover(f: number | null, fly = true) {
    hover = f == null ? null : Math.min(1, Math.max(0, f));
    setReadout(hover);
    drawProfile();
    map.triggerRepaint();
    const track = deps.getTrack();
    if (fly && hover != null && track && performance.now() - lastEase > 140) {
      lastEase = performance.now();
      const p = trailreelTrack.sampleAt(track, hover);
      map.easeTo({ center: [p.lon, p.lat], duration: 350 });
    }
  }

  // The profile's x axis is distance travelled; hover itself is route progress.
  const onPointer = (e: PointerEvent) => {
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType !== 'mouse') return;
    const track = deps.getTrack();
    if (!track) return;
    const r = profile.getBoundingClientRect();
    setHover(trailreelTrack.travelToProgress(track, (e.clientX - r.left) / Math.max(1, r.width)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const track = deps.getTrack();
    if (!track) return;
    const x = hover == null ? 0 : trailreelTrack.progressToTravel(track, hover);
    setHover(trailreelTrack.travelToProgress(track, x + (e.key === 'ArrowRight' ? 0.01 : -0.01)));
  };
  profile.addEventListener('pointermove', onPointer);
  profile.addEventListener('pointerdown', onPointer);
  profile.addEventListener('keydown', onKey);

  function recenter() {
    const rig = deps.getRig();
    if (!rig) return;
    map.easeTo({ center: rig.outro.center, zoom: rig.outro.zoom, pitch: 55, bearing: rig.outro.bearing, padding: { top: 0, bottom: 90, left: 0, right: 0 }, duration: 1200 });
  }

  return {
    get active() {
      return active;
    },
    enter() {
      const track = deps.getTrack();
      if (!track) return;
      active = true;
      speedRange = [percentile(Array.from(track.speed), 0.08), percentile(Array.from(track.speed), 0.92)];
      if (!(speedRange[1] > speedRange[0])) speedRange = [0, 1];
      if (!map.hasControl(nav)) map.addControl(nav, 'top-left');
      applyRoute();
      updateLegend();
      hover = null;
      setReadout(null);
      drawProfile();
      map.on('render', drawMarkers);
      recenter();
    },
    exit() {
      active = false;
      map.off('render', drawMarkers);
      if (map.hasControl(nav)) map.removeControl(nav);
      octx.clearRect(0, 0, overlay.width, overlay.height);
    },
    setLayer(l: RouteLayer) {
      layer = l;
      if (!active) return;
      applyRoute();
      updateLegend();
      drawProfile();
    },
    refresh() {
      if (!active) return;
      applyRoute();
      updateLegend();
      setReadout(hover);
      drawProfile();
      map.triggerRepaint();
    },
    recenter,
    hoverAt(f: number) {
      setHover(f);
    },
    dispose() {
      this.exit();
      profile.removeEventListener('pointermove', onPointer);
      profile.removeEventListener('pointerdown', onPointer);
      profile.removeEventListener('keydown', onKey);
    },
  };
}
