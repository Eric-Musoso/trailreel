/**
 * Trailreel controller: wires the page's DOM (looked up by id inside `root`) to the engine.
 * Started from the page's effect; returns a cleanup function.
 */
import { LngLat, type GeoJSONSource, type LngLatLike, type Map as MLMap } from 'maplibre-gl';
import { trailreelAudio, type AmbientPresetId, type AudioMixInput } from './trailreelAudio';
import { trailreelCameraGuard } from './trailreelCameraGuard';
import { trailreelDem, type DemSampler } from './trailreelDem';
import { trailreelDemo } from './trailreelDemo';
import { trailreelEnrich } from './trailreelEnrich';
import { trailreelExplore } from './trailreelExplore';
import { trailreelExporter, type FrameRenderer } from './trailreelExporter';
import { trailreelFormat as F } from './trailreelFormat';
import { trailreelGeo as G } from './trailreelGeo';
import { trailreelGpx } from './trailreelGpx';
import { trailreelLibrary } from './trailreelLibrary';
import { trailreelMap as M } from './trailreelMap';
import { trailreelOverlay } from './trailreelOverlay';
import { trailreelParse } from './trailreelParse';
import { trailreelPhotos } from './trailreelPhotos';
import { trailreelRecorder } from './trailreelRecorder';
import { attachPointerScrubber, createSpring, prefersReducedMotion } from './trailreelSpring';
import { trailreelStory } from './trailreelStory';
import { trailreelStrava } from './trailreelStrava';
import { trailreelThemes } from './trailreelThemes';
import { trailreelTimeline, type TimelineCameraOptions } from './trailreelTimeline';
import { trailreelTrack } from './trailreelTrack';
import type {
  Activity,
  Aspect,
  BasemapId,
  Camera,
  CameraKeyframe,
  CameraRig,
  Chapter,
  ChapterMeta,
  Enrichment,
  FrameState,
  GhostRider,
  LibraryEntry,
  LightingMode,
  Photo,
  PhotoCropAspect,
  PhotoHold,
  Plan,
  Quality,
  RouteLayer,
  Scene,
  Settings,
  Sport,
  Track,
  Units,
} from './trailreelTypes';

export interface TrailreelClasses {
  portrait: string;
  square: string;
  dragging: string;
  toast: string;
  toastError: string;
  toastOut: string;
  swatch: string;
  libItem: string;
  libDelete: string;
  chipBtn: string;
  keyframeRow: string;
  chapterRow: string;
  ghostRow: string;
  scrubberMarker: string;
  scrubberPhoto: string;
  scrubberChapter: string;
  modalOpen: string;
}

type Mode = 'video' | 'explore';
type PanelId = 'route' | 'camera' | 'media' | 'style' | 'export';

const PANEL_ORDER: PanelId[] = ['route', 'camera', 'media', 'style', 'export'];
const GHOST_COLORS = ['#38bdf8', '#22c55e', '#f43f5e', '#eab308'];
const PREF_LOOKUP = 'trailreel.lookupOnline';
const PREF_AVOID_TERRAIN = 'trailreel.avoidTerrain';

type Bounds = [[number, number], [number, number]];

/** Per-viewer preferences; storage can be missing (private windows), so every access is guarded. */
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* not persisted */
  }
}

export function trailreelApp(root: HTMLElement, classes: TrailreelClasses): () => void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const settings: Settings = {
    title: '',
    duration: 30,
    fps: 30,
    aspect: '16:9',
    units: 'metric',
    exaggeration: 1.4,
    basemap: 'esri',
    quality: 1080,
    theme: 'ember',
    photoHold: 'normal',
    // Clean exports by default: the badge and "Made with Trailreel" card are opt-in.
    // Map attribution is still drawn on every frame, as the tile licences require.
    endCredits: false,
    watermark: false,
    privacy: 0,
    trimStart: 0,
    trimEnd: 1,
    cameraPitch: 62,
    cameraZoomOffset: 0,
    cameraBearingOffset: 0,
    lighting: 'auto',
    musicVolume: 0.8,
    musicOffset: 0,
    voiceoverVolume: 1.0,
    ghostSync: 'time',
    cameraAvoidTerrain: readPref(PREF_AVOID_TERRAIN, true),
    lookupOnline: readPref(PREF_LOOKUP, true),
  };

  let disposed = false;
  let map: MLMap | null = null;
  let explore: ReturnType<typeof trailreelExplore> | null = null;
  let mode: Mode = 'video';
  let activePanel: PanelId = 'route';
  let grabCamera = false;
  let rawActivity: Activity | null = null;
  let chapterItems: { id: string; name: string; activity: Activity }[] = [];
  /** the stitched days/legs, in order; placed on the current (trimmed) track as `chapters` */
  let chapterMetas: ChapterMeta[] = [];
  let chapters: Chapter[] = [];
  let ghosts: GhostRider[] = [];
  let track: Track | null = null;
  let photos: Photo[] = [];
  let keyframes: CameraKeyframe[] = [];
  let plan: Plan | null = null;
  let rig: CameraRig | null = null;
  let enrichment: Enrichment = { place: null, weather: null, timeZone: null };
  let t = 0;
  let playing = false;
  let exporting = false;
  let lastTs = 0;
  let rafId = 0;
  let exportAbort: AbortController | null = null;
  let lastVideo: { url: string; file: File } | null = null;
  let posterUrl: string | null = null;
  let music: { buffer: AudioBuffer; name: string } | null = null;
  let voiceover: { buffer: AudioBuffer; name: string } | null = null;
  const mixPlayer = trailreelAudio.createMixPlayer();
  let library: LibraryEntry[] = [];
  let pendingDelete: string | null = null;
  let editingPhotoId: string | null = null;
  const cleanups: (() => void)[] = [];
  const on = (el: HTMLElement | Window, type: string, fn: (e: never) => void) => {
    el.addEventListener(type, fn as EventListener);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener));
  };

  const stage = $('stage');
  const overlay = $<HTMLCanvasElement>('overlay');
  const octx = overlay.getContext('2d')!;
  const scrubber = $('scrubber');
  const scrubberFill = $('scrubberFill');
  const scrubberThumb = $('scrubberThumb');
  const scrubberMarkers = $('scrubberMarkers');
  const btnPlay = $<HTMLButtonElement>('btnPlay');
  const theme = () => trailreelThemes.get(settings.theme);
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const slug = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'activity';

  function toast(msg: string, kind: 'error' | 'info' = 'info') {
    const el = document.createElement('div');
    el.className = kind === 'error' ? `${classes.toast} ${classes.toastError}` : classes.toast;
    el.textContent = msg;
    $('toasts').appendChild(el);
    // Leave the way it came (fade + slide back down), then remove.
    setTimeout(
      () => {
        el.classList.add(classes.toastOut);
        setTimeout(() => el.remove(), 220);
      },
      kind === 'error' ? 8000 : 4000,
    );
  }

  function setLoading(msg: string | null) {
    const el = $('loading');
    el.hidden = !msg;
    if (msg) $('loadingText').textContent = msg;
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ---------- Segmented Inspector Tabs (Apple spring pill) ----------
  const segPill = $('segPill');
  const segSpring = createSpring(0, (idx) => {
    segPill.style.transform = `translateX(${idx * 100}%)`;
  });
  cleanups.push(() => segSpring.stop());

  function setActivePanel(next: PanelId) {
    activePanel = next;
    const idx = PANEL_ORDER.indexOf(next);
    // A tap carries no momentum, so the pill settles without overshoot (critically damped).
    segSpring.setTarget(idx, { damping: 1.0, response: 0.28 });
    root.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.panel === next));
    });
    root.querySelectorAll<HTMLElement>('[data-panel-body]').forEach((sec) => {
      sec.hidden = sec.dataset.panelBody !== next;
    });
  }

  root.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => {
    on(b, 'click', () => setActivePanel(b.dataset.panel as PanelId));
  });

  // ---------- camera + rendering ----------
  function containerSize() {
    const c = map!.getContainer();
    return { w: c.clientWidth, h: c.clientHeight };
  }

  function computeRig(tr: Track): CameraRig {
    const m = map!;
    const { w, h } = containerSize();
    m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const padding = { top: h * 0.2, bottom: h * 0.16, left: w * 0.1, right: w * 0.1 };
    const endHeading = tr.heading[tr.n - 1];
    const ov = m.cameraForBounds(tr.bounds, { padding }) ?? { center: [tr.lon[0], tr.lat[0]] as LngLatLike, zoom: 12 };
    const ovEnd = m.cameraForBounds(tr.bounds, { padding, bearing: endHeading }) ?? ov;
    const ll = (c: LngLatLike | undefined): [number, number] => {
      const p = LngLat.convert(c ?? [tr.lon[0], tr.lat[0]]);
      return [p.lng, p.lat];
    };
    return {
      overview: { center: ll(ov.center), zoom: ov.zoom ?? 12, pitch: 0, bearing: 0, padTop: 0 },
      outro: { center: ll(ovEnd.center), zoom: (ovEnd.zoom ?? 12) - 0.35, pitch: 40, bearing: endHeading, padTop: 0 },
      // By distance travelled: the transfer between stitched days is flown separately (a hop), so it shouldn't push the camera up.
      followZoom: trailreelTimeline.followZoomFor(tr.stats.distance, h > w),
      followPitch: 62,
      followPadTop: h * 0.32,
    };
  }

  function applyCamera(cam: Camera) {
    map!.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding: { top: cam.padTop, bottom: 0, left: 0, right: 0 } });
  }

  function timelineOpts(): TimelineCameraOptions {
    return {
      pitch: settings.cameraPitch,
      zoomOffset: settings.cameraZoomOffset,
      bearingOffset: settings.cameraBearingOffset,
      keyframes,
      chapters,
      lightingMode: settings.lighting,
      weatherCode: enrichment.weather?.code ?? null,
      pitchLimit,
    };
  }

  // ---------- terrain-aware camera guard ----------
  let demSampler: DemSampler | null = null;
  let demLoading: { bounds: Bounds; promise: Promise<void> } | null = null;
  let demFailed: Bounds | null = null;
  let pitchLimit: Float32Array | null = null;
  let guardFrame = 0;

  /** Recompute the pitch caps now if the terrain is loaded; otherwise start loading it. */
  function updateCameraGuard() {
    if (!settings.cameraAvoidTerrain || !map || !track || !rig) {
      pitchLimit = null;
      return;
    }
    const viewHeight = containerSize().h;
    const need = trailreelCameraGuard.guardBounds(track, rig.followZoom, viewHeight);
    if (demSampler && trailreelCameraGuard.covers(demSampler.bounds, need)) {
      const r = rig;
      const base = { ...timelineOpts(), pitchLimit: null };
      pitchLimit = trailreelCameraGuard.computePitchLimits(track, demSampler, {
        followZoom: r.followZoom,
        viewHeight,
        exaggeration: settings.exaggeration,
        offsetsAt: (p) => trailreelTimeline.cameraOffsetsAt(p, r, base),
      });
      return;
    }
    pitchLimit = null;
    if (demFailed && trailreelCameraGuard.covers(demFailed, need)) return; // offline: camera works as before
    void loadGuardTerrain(need);
  }

  function loadGuardTerrain(need: Bounds): Promise<void> {
    if (demLoading && trailreelCameraGuard.covers(demLoading.bounds, need)) return demLoading.promise;
    const job = {
      bounds: need,
      promise: trailreelDem
        .loadSampler(need)
        .then((s) => {
          if (disposed) return;
          demSampler = s;
          demFailed = null;
        })
        .catch(() => {
          demFailed = need;
        })
        .finally(() => {
          if (demLoading === job) demLoading = null;
          if (disposed) return;
          updateCameraGuard();
          if (!playing && !exporting) renderAt(t);
        }),
    };
    demLoading = job;
    return job.promise;
  }

  /** Camera controls fire many input events: recompute once per frame, then redraw. */
  function scheduleCameraGuard() {
    if (guardFrame) return;
    guardFrame = requestAnimationFrame(() => {
      guardFrame = 0;
      updateCameraGuard();
      if (!playing) renderAt(t);
    });
  }

  /** Export must use the same camera as the preview: wait for the terrain if it is still loading. */
  async function ensureCameraGuard() {
    updateCameraGuard();
    if (settings.cameraAvoidTerrain && !pitchLimit && demLoading) {
      await demLoading.promise;
      updateCameraGuard();
    }
  }

  function sceneFor(scale: number): Scene {
    return {
      track: track!,
      photos,
      chapters,
      ghosts,
      settings,
      theme: theme(),
      title: settings.title.trim() || track!.activity.name,
      sport: track!.activity.sport,
      enrichment,
      attribution: M.attributionText(settings.basemap),
      project: (lon, lat) => {
        const p = map!.project([lon, lat]);
        return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x * scale, y: p.y * scale } : null;
      },
    };
  }

  let lastLightingKey = '';
  function syncLighting(st: FrameState) {
    if (!map) return;
    const key = `${st.lighting.mode}:${st.lighting.skyColor}:${st.lighting.brightnessMax.toFixed(2)}:${Math.round(st.lighting.sunAzimuthDeg / 3)}`;
    if (key === lastLightingKey) return;
    lastLightingKey = key;
    M.applyLighting(map, st.lighting);
    const labelMap = { day: 'Daylight', sunrise: 'Sunrise', golden: 'Golden hour', night: 'Night · Headlamp' };
    $('lightingBadge').textContent = labelMap[st.lighting.mode];
  }

  function frameAt(time: number, moveCamera = true): FrameState | null {
    if (!map || !track || !plan || !rig) return null;
    const st = trailreelTimeline.stateAt(time, plan, track, rig, timelineOpts());
    if (moveCamera) applyCamera(st.camera);
    syncLighting(st);
    M.setRouteProgress(map, st.progress, theme(), track.breaks);
    ghosts.forEach((g, idx) => {
      const gp = trailreelOverlay.ghostProgress(g, track!, st.progress, settings.ghostSync);
      M.setGhostProgress(map!, idx, gp, g.color);
    });
    return st;
  }

  function drawPreviewOverlay(st: FrameState) {
    trailreelOverlay.draw(octx, overlay.width, overlay.height, st, sceneFor(overlay.width / Math.max(1, overlay.clientWidth)));
  }

  function renderAt(time: number, moveCamera = !grabCamera) {
    if (mode !== 'video') return;
    const st = frameAt(time, moveCamera);
    if (st) drawPreviewOverlay(st);
    updateTransport();
  }

  function renderScrubberMarkers() {
    if (!plan || !track) {
      scrubberMarkers.innerHTML = '';
      return;
    }
    const items: HTMLElement[] = [];
    const tr = track;
    const approxTimeFractionForProgress = (p: number) =>
      plan!.total > 0 ? G.clamp(trailreelTimeline.timeAtProgress(plan!, tr, p) / plan!.total, 0.01, 0.99) : 0;
    if (chapters.length > 1) {
      for (let i = 1; i < chapters.length; i++) {
        const div = document.createElement('span');
        div.className = classes.scrubberChapter;
        div.style.left = `${approxTimeFractionForProgress(chapters[i].startAt) * 100}%`;
        items.push(div);
      }
    }
    for (const ph of photos) {
      const seg = plan.segments.find((s) => s.kind === 'photo' && ph === photos[s.photo]);
      const f = seg ? (seg.t0 + seg.t1) / 2 / plan.total : approxTimeFractionForProgress(ph.at);
      const dot = document.createElement('span');
      dot.className = classes.scrubberPhoto;
      dot.style.left = `${f * 100}%`;
      items.push(dot);
    }
    for (const kf of keyframes) {
      const diamond = document.createElement('span');
      diamond.className = classes.scrubberMarker;
      diamond.style.left = `${approxTimeFractionForProgress(kf.at) * 100}%`;
      items.push(diamond);
    }
    scrubberMarkers.replaceChildren(...items);
  }

  function rebuild() {
    if (!track || !map) return;
    rig = computeRig(track);
    plan = trailreelTimeline.buildPlan(photos, settings.duration, { photoHold: settings.photoHold, credits: settings.endCredits, track });
    t = Math.min(t, plan.total);
    updateCameraGuard();
    renderScrubberMarkers();
    if (mode === 'video') renderAt(t);
    else explore?.refresh();
  }

  function updateTransport() {
    const total = plan?.total ?? 0;
    const f = total > 0 ? G.clamp(t / total, 0, 1) : 0;
    scrubber.setAttribute('aria-valuenow', String(Math.round(f * 1000)));
    scrubberFill.style.width = `${f * 100}%`;
    scrubberThumb.style.left = `${f * 100}%`;
    $('timeLabel').textContent = `${F.videoTime(t)} / ${F.videoTime(total)}`;
    btnPlay.textContent = playing ? '❚❚' : '▶';
    btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function currentAudioMix(): AudioMixInput {
    return {
      music: music ? { buffer: music.buffer, volume: settings.musicVolume, offset: settings.musicOffset } : null,
      voiceover: voiceover ? { buffer: voiceover.buffer, volume: settings.voiceoverVolume } : null,
    };
  }

  function setPlaying(v: boolean) {
    if (v && grabCamera) setGrabCamera(false);
    playing = v && mode === 'video' && !exporting && !!plan;
    if (playing && (music || voiceover) && plan) {
      mixPlayer.start(currentAudioMix(), t, plan.total);
    } else {
      mixPlayer.stop();
    }
    updateTransport();
  }

  function setGrabCamera(v: boolean) {
    grabCamera = v && mode === 'video';
    if (grabCamera && playing) setPlaying(false);
    const btn = $<HTMLButtonElement>('btnGrabCamera');
    btn.setAttribute('aria-pressed', String(grabCamera));
    btn.textContent = grabCamera ? 'Lock to route' : 'Free-look 3D view';
    $('grabBanner').hidden = !grabCamera;
    if (map) {
      const m = map;
      const fn = grabCamera ? 'enable' : 'disable';
      m.dragPan[fn]();
      m.dragRotate[fn]();
      m.scrollZoom[fn]();
      m.touchZoomRotate[fn]();
    }
  }

  function resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.max(1, Math.round(overlay.clientWidth * dpr));
    overlay.height = Math.max(1, Math.round(overlay.clientHeight * dpr));
  }

  function tick(ts: number) {
    if (disposed) return;
    if (playing && !exporting && plan && mode === 'video') {
      const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
      t += dt;
      if (t >= plan.total) {
        t = plan.total;
        setPlaying(false);
      }
      renderAt(t);
    }
    lastTs = ts;
    rafId = requestAnimationFrame(tick);
  }

  function setMode(next: Mode) {
    if (!map || !track || next === mode || exporting) return;
    setPlaying(false);
    if (next === 'explore' && grabCamera) setGrabCamera(false);
    mode = next;
    $('tabVideo').setAttribute('aria-selected', String(mode === 'video'));
    $('tabExplore').setAttribute('aria-selected', String(mode === 'explore'));
    $('explorePanel').hidden = mode !== 'explore';
    $('transport').hidden = mode !== 'video';
    if (mode === 'explore') {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      map.dragPan.enable();
      map.dragRotate.enable();
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      explore?.enter();
    } else {
      explore?.exit();
      if (!grabCamera) {
        map.dragPan.disable();
        map.dragRotate.disable();
        map.scrollZoom.disable();
        map.touchZoomRotate.disable();
      }
      renderAt(t);
    }
  }

  // ---------- info panels ----------
  function updateInfo() {
    const strip = $('statsStrip');
    if (!track) {
      strip.innerHTML = '';
      $('activityInfo').textContent = '';
      return;
    }
    const s = track.stats;
    const u = settings.units;
    const speed = s.avgSpeed != null ? F.speed(s.avgSpeed, u, track.activity.sport) : null;
    const cells: [string, string][] = [
      ['Distance', F.distance(s.distance, u)],
      ['Moving time', s.movingTime != null ? F.duration(s.movingTime) : '—'],
      ['Elevation gain', F.elevation(s.elevGain, u)],
      ['Highest point', F.elevation(s.elevMax, u)],
      [speed?.label ?? 'Avg speed', speed?.value ?? '—'],
      ['Weather', enrichment.weather ? `${F.temp(enrichment.weather.tempC, u)} · ${trailreelEnrich.weatherLabel(enrichment.weather.code)}` : '—'],
    ];
    strip.replaceChildren(
      ...cells.map(([k, v]) => {
        const d = document.createElement('div');
        const a = document.createElement('span');
        a.textContent = k;
        const b = document.createElement('strong');
        b.textContent = v;
        d.append(a, b);
        return d;
      }),
    );
    const trimmed = settings.privacy > 0 ? ` · ${F.distance(settings.privacy, u)} hidden at ends` : '';
    // A stitched activity's source already reads "N stitched days/legs".
    $('activityInfo').textContent = `${F.sportLabel[track.activity.sport]} · ${track.activity.points.length.toLocaleString()} pts · ${track.activity.source}${enrichment.place ? ` · ${enrichment.place}` : ''}${trimmed}`;
    $('trimLabel').textContent = `${Math.round(settings.trimStart * 100)}% – ${Math.round(settings.trimEnd * 100)}%`;
  }

  // ---------- Photos & Photo Editor Modal ----------
  function drawPhotoEditorPreview() {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    const canvas = $<HTMLCanvasElement>('photoEditCanvas');
    const ctx = canvas.getContext('2d')!;
    const capH = ph.caption.trim() ? 38 : 0;
    const dim = trailreelPhotos.editedDimensions(ph, 440, 320);
    canvas.width = Math.round(dim.w + 24);
    canvas.height = Math.round(dim.h + 24 + capH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    trailreelPhotos.drawEditedPhoto(ctx, ph, 12, 12, dim.w, dim.h);
    if (ph.caption.trim()) {
      ctx.fillStyle = '#16191d';
      ctx.font = '600 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ph.caption.trim(), canvas.width / 2, dim.h + 12 + capH / 2 + 2);
    }
  }

  function openPhotoEditor(id: string) {
    const ph = photos.find((p) => p.id === id);
    if (!ph) return;
    editingPhotoId = id;
    $('photoModalTitle').textContent = ph.name;
    $<HTMLInputElement>('photoZoom').value = String(ph.crop.zoom);
    $('photoZoomVal').textContent = `${ph.crop.zoom.toFixed(1)}×`;
    $<HTMLInputElement>('photoPanX').value = String(ph.crop.panX);
    $<HTMLInputElement>('photoPanY').value = String(ph.crop.panY);
    $<HTMLInputElement>('photoCaption').value = ph.caption;
    const durVal = ph.duration ?? 0;
    $<HTMLInputElement>('photoDuration').value = String(durVal);
    $('photoDurationVal').textContent = durVal > 0 ? `${durVal.toFixed(1)} s` : 'Default';
    $<HTMLInputElement>('photoPosition').value = String(ph.at);
    $('photoPositionVal').textContent = `${Math.round(ph.at * 100)}%`;
    root.querySelectorAll<HTMLButtonElement>('[data-crop-aspect]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.cropAspect === ph.crop.aspect));
    });
    drawPhotoEditorPreview();
    const modal = $('photoModal');
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add(classes.modalOpen));
  }

  function closePhotoEditor() {
    const modal = $('photoModal');
    modal.classList.remove(classes.modalOpen);
    setTimeout(() => {
      if (!modal.classList.contains(classes.modalOpen)) modal.hidden = true;
    }, 220);
    editingPhotoId = null;
    photos.sort((a, b) => a.at - b.at);
    renderPhotoList();
    rebuild();
  }

  function renderPhotoList() {
    const ul = $('photoList');
    ul.innerHTML = '';
    for (const p of photos) {
      const li = document.createElement('li');
      li.title = 'Click to rotate, crop, caption & set duration';
      const how = { gps: 'GPS', time: 'time', spread: 'auto', manual: 'pin' }[p.placedBy];
      const img = document.createElement('img');
      img.alt = '';
      img.src = p.thumbUrl;
      if (p.rotation) img.style.transform = `rotate(${p.rotation}deg)`;
      const label = document.createElement('span');
      const dur = p.duration ? ` · ${p.duration.toFixed(1)}s` : '';
      label.textContent = `${Math.round(p.at * 100)}% · ${how}${dur}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${p.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        photos = photos.filter((x) => x !== p);
        p.bitmap.close();
        URL.revokeObjectURL(p.thumbUrl);
        renderPhotoList();
        rebuild();
      });
      li.addEventListener('click', () => openPhotoEditor(p.id));
      li.append(img, label, remove);
      ul.appendChild(li);
    }
    $('photoHint').hidden = photos.length > 0;
  }

  // ---------- Keyframes, Chapters, Ghosts UI ----------
  function renderKeyframeList() {
    keyframes.sort((a, b) => a.at - b.at);
    $('keyframeCount').textContent = `${keyframes.length} ${keyframes.length === 1 ? 'pin' : 'pins'}`;
    const ul = $('keyframeList');
    ul.replaceChildren(
      ...keyframes.map((kf) => {
        const li = document.createElement('li');
        li.className = classes.keyframeRow;
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.textContent = `${Math.round(kf.at * 100)}% · Pitch ${Math.round(kf.pitch)}° · Zoom ${kf.zoomOffset >= 0 ? '+' : ''}${kf.zoomOffset.toFixed(1)}`;
        jump.addEventListener('click', () => {
          if (!plan || !track) return;
          setPlaying(false);
          t = trailreelTimeline.timeAtProgress(plan, track, kf.at);
          renderAt(t, true);
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Delete keyframe');
        del.addEventListener('click', () => {
          keyframes = keyframes.filter((k) => k.id !== kf.id);
          renderKeyframeList();
          renderScrubberMarkers();
          scheduleCameraGuard();
        });
        li.append(jump, del);
        return li;
      }),
    );
  }

  function renderChapterList() {
    const ul = $('chapterList');
    $('chapterHint').hidden = chapterItems.length > 1;
    ul.replaceChildren(
      ...chapterItems.map((ch, idx) => {
        const li = document.createElement('li');
        li.className = classes.chapterRow;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = ch.name;
        input.setAttribute('aria-label', `Chapter ${idx + 1} name`);
        input.addEventListener('change', () => {
          ch.name = input.value.trim() || ch.activity.name;
          // Chapters trimmed off the track are not in `chapters`, so match by id, not position.
          for (const c of [...chapters, ...chapterMetas]) if (c.id === ch.id) c.name = ch.name;
          if (!playing) renderAt(t);
        });
        li.append(input);
        if (idx > 0) {
          const up = document.createElement('button');
          up.type = 'button';
          up.textContent = '↑';
          up.title = 'Move chapter earlier';
          up.addEventListener('click', () => {
            [chapterItems[idx - 1], chapterItems[idx]] = [chapterItems[idx], chapterItems[idx - 1]];
            void rebuildStitched();
          });
          li.append(up);
        }
        if (chapterItems.length > 1) {
          const del = document.createElement('button');
          del.type = 'button';
          del.textContent = '×';
          del.title = 'Remove chapter';
          del.addEventListener('click', () => {
            chapterItems = chapterItems.filter((x) => x.id !== ch.id);
            void rebuildStitched();
          });
          li.append(del);
        }
        return li;
      }),
    );
  }

  function renderGhostList() {
    const ul = $('ghostList');
    ul.replaceChildren(
      ...ghosts.map((g) => {
        const li = document.createElement('li');
        li.className = classes.ghostRow;
        const dot = document.createElement('span');
        dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${g.color};flex:0 0 auto`;
        const name = document.createElement('span');
        name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        name.textContent = `${g.name} (${F.distance(g.track.stats.distance, settings.units)})`;
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '×';
        del.addEventListener('click', () => {
          ghosts = ghosts.filter((x) => x.id !== g.id);
          syncGhostMapLayers();
          renderGhostList();
          if (!playing) renderAt(t);
        });
        li.append(dot, name, del);
        return li;
      }),
    );
  }

  function syncGhostMapLayers() {
    if (!map) return;
    M.clearGhostSlots(map);
    ghosts.forEach((g, idx) => {
      M.setGhostData(map!, idx, trailreelTrack.routeGeoJSON(g.track));
    });
  }

  // ---------- library ----------
  async function refreshLibrary() {
    try {
      library = await trailreelLibrary.list();
    } catch {
      library = [];
      $('librarySummary').textContent = 'The activity library is not available in this browser (private window?).';
      return;
    }
    const u = settings.units;
    const totalDist = library.reduce((a, e) => a + e.distance, 0);
    const totalGain = library.reduce((a, e) => a + e.elevGain, 0);
    $('librarySummary').textContent = library.length
      ? `${library.length} ${library.length === 1 ? 'activity' : 'activities'} · ${F.distance(totalDist, u)} · ${F.elevation(totalGain, u)} climbed`
      : 'Activities you open are saved here, in this browser only.';
    const ul = $('libraryList');
    ul.replaceChildren(
      ...library.map((e) => {
        const li = document.createElement('li');
        li.className = classes.libItem;
        const open = document.createElement('button');
        open.type = 'button';
        const name = document.createElement('strong');
        name.textContent = e.name;
        const meta = document.createElement('span');
        meta.textContent = `${e.startTime ? F.shortDate(e.startTime) : 'No date'} · ${F.distance(e.distance, u)} · ${F.sportLabel[e.sport]}`;
        open.append(name, meta);
        open.addEventListener('click', async () => {
          setLoading('Opening from your library…');
          try {
            const act = await trailreelLibrary.get(e.id);
            if (act) await loadActivity(act);
          } catch (err) {
            setLoading(null);
            toast(message(err), 'error');
          }
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = classes.libDelete;
        const confirming = pendingDelete === e.id;
        del.textContent = confirming ? 'Delete?' : '×';
        del.setAttribute('aria-label', confirming ? `Confirm deleting ${e.name}` : `Delete ${e.name} from the library`);
        del.addEventListener('click', async () => {
          if (pendingDelete !== e.id) {
            pendingDelete = e.id;
            void refreshLibrary();
            return;
          }
          pendingDelete = null;
          await trailreelLibrary.remove(e.id).catch((err) => toast(message(err), 'error'));
          void refreshLibrary();
        });
        li.append(open, del);
        return li;
      }),
    );
  }

  // ---------- loading & stitching ----------
  function buildFromRaw() {
    if (!rawActivity || !map) return;
    let points = rawActivity.points.map((p) => ({ ...p }));
    points = trailreelTrack.sliceTrackPoints(points, settings.trimStart, settings.trimEnd);
    points = trailreelTrack.trimEnds(points, settings.privacy);
    track = trailreelTrack.buildTrack({ ...rawActivity, points });
    // Day/leg boundaries come from where each chapter's points actually sit on this (trimmed) track.
    chapters = trailreelTrack.chaptersFor(track, chapterMetas);
    (map.getSource('route') as GeoJSONSource).setData(trailreelTrack.routeGeoJSON(track) as unknown as Parameters<GeoJSONSource['setData']>[0]);
    if (photos.length) {
      trailreelPhotos.placePhotos(photos, track);
      renderPhotoList();
    }
  }

  async function rebuildStitched() {
    if (!chapterItems.length || !map) return;
    const { combined, metas } = trailreelTrack.stitchActivities(chapterItems);
    chapterMetas = metas;
    rawActivity = combined;
    buildFromRaw();
    settings.title = combined.name;
    $<HTMLInputElement>('title').value = combined.name;
    t = 0;
    renderChapterList();
    rebuild();
    updateInfo();
  }

  async function ensureDem(act: Activity) {
    const withEle = act.points.filter((p) => p.ele != null && Number.isFinite(p.ele)).length;
    if (withEle < act.points.length * 0.5) {
      setLoading('Looking up elevation from terrain tiles…');
      await trailreelDem.fillElevationFromDEM(act.points);
    }
  }

  async function loadActivity(act: Activity, opts: { save?: boolean } = {}) {
    if (!map) return;
    try {
      setPlaying(false);
      await ensureDem(act);
      setLoading('Building flyover…');
      chapterItems = [{ id: crypto.randomUUID(), name: act.name, activity: act }];
      const stitched = trailreelTrack.stitchActivities(chapterItems);
      chapterMetas = stitched.metas;
      rawActivity = stitched.combined;
      settings.trimStart = 0;
      settings.trimEnd = 1;
      $<HTMLInputElement>('trimStart').value = '0';
      $<HTMLInputElement>('trimEnd').value = '1';
      keyframes = [];
      ghosts = [];
      syncGhostMapLayers();
      renderGhostList();
      renderKeyframeList();
      renderChapterList();
      buildFromRaw();
      settings.title = act.name;
      $<HTMLInputElement>('title').value = act.name;
      enrichment = { place: null, weather: null, timeZone: null };
      t = 0;
      rebuild();
      if (mode === 'explore') {
        explore?.exit();
        explore?.enter();
      }
      updateInfo();
      $('emptyState').hidden = true;
      for (const id of ['btnExport', 'btnStory', 'btnPoster', 'btnGpx', 'tabExplore']) {
        $<HTMLButtonElement>(id).disabled = id === 'btnExport' ? !trailreelExporter.webCodecsAvailable() : false;
      }
      if (opts.save !== false && act.source !== 'Demo route') {
        trailreelLibrary
          .save(act, track!.stats)
          .then(() => refreshLibrary())
          .catch(() => undefined);
      }
      runEnrichment();
      setLoading('Loading map tiles…');
      await M.waitForIdle(map, 6000);
      // Autoplay is a large moving scene; people who asked for reduced motion press Play themselves.
      if (mode === 'video' && !prefersReducedMotion()) setPlaying(true);
    } catch (e) {
      toast(message(e), 'error');
    } finally {
      setLoading(null);
    }
  }

  /**
   * Place name and weather for the title card. Only when the person allows it, and only the
   * start of the (privacy-trimmed) track leaves the device, rounded to ~1 km (trailreelEnrich).
   */
  let enrichSeq = 0;
  function runEnrichment() {
    const seq = ++enrichSeq;
    enrichment = { place: null, weather: null, timeZone: null };
    if (!track || !settings.lookupOnline) return;
    const tr = track;
    trailreelEnrich.enrich(tr.lat[0], tr.lon[0], tr.stats.startTime).then((e) => {
      // Ignore late answers once another activity was opened or the lookup was switched off.
      if (disposed || seq !== enrichSeq || !settings.lookupOnline) return;
      enrichment = e;
      updateInfo();
      if (!playing) renderAt(t);
    });
  }

  async function importFiles(files: File[]) {
    const tracks = files.filter((f) => /\.(gpx|tcx|fit)$/i.test(f.name));
    if (!tracks.length) return;
    let last: Activity | null = null;
    for (let i = 0; i < tracks.length; i++) {
      setLoading(`Reading ${tracks[i].name} (${i + 1} of ${tracks.length})…`);
      try {
        const act = await trailreelParse.parseActivityFile(tracks[i]);
        if (i < tracks.length - 1) await trailreelLibrary.save(act, trailreelTrack.buildTrack({ ...act, points: act.points.map((p) => ({ ...p })) }).stats).catch(() => undefined);
        last = act;
      } catch (e) {
        toast(`${tracks[i].name}: ${message(e)}`, 'error');
      }
    }
    setLoading(null);
    if (tracks.length > 1) void refreshLibrary();
    if (last) await loadActivity(last);
  }

  async function addChapterFiles(files: File[]) {
    const tracks = files.filter((f) => /\.(gpx|tcx|fit)$/i.test(f.name));
    if (!tracks.length) return;
    try {
      for (const f of tracks) {
        setLoading(`Adding chapter ${f.name}…`);
        const act = await trailreelParse.parseActivityFile(f);
        await ensureDem(act);
        chapterItems.push({ id: crypto.randomUUID(), name: act.name, activity: act });
      }
      await rebuildStitched();
      toast(`Stitched ${chapterItems.length} chapters.`);
    } catch (e) {
      toast(message(e), 'error');
    } finally {
      setLoading(null);
    }
  }

  async function addGhostFiles(files: File[]) {
    const tracks = files.filter((f) => /\.(gpx|tcx|fit)$/i.test(f.name));
    if (!tracks.length) return;
    try {
      for (const f of tracks) {
        if (ghosts.length >= GHOST_COLORS.length) {
          toast(`Up to ${GHOST_COLORS.length} ghost riders are supported at once.`, 'error');
          break;
        }
        setLoading(`Loading ghost ${f.name}…`);
        const act = await trailreelParse.parseActivityFile(f);
        await ensureDem(act);
        const tr = trailreelTrack.buildTrack(act);
        ghosts.push({
          id: crypto.randomUUID(),
          name: act.name,
          color: GHOST_COLORS[ghosts.length % GHOST_COLORS.length],
          activity: act,
          track: tr,
        });
      }
      syncGhostMapLayers();
      renderGhostList();
      if (!playing) renderAt(t);
    } catch (e) {
      toast(message(e), 'error');
    } finally {
      setLoading(null);
    }
  }

  async function addPhotos(files: File[]) {
    setLoading('Reading photos…');
    for (const f of files) {
      try {
        photos.push(await trailreelPhotos.loadPhoto(f));
      } catch (e) {
        toast(message(e), 'error');
      }
    }
    if (track) trailreelPhotos.placePhotos(photos, track);
    renderPhotoList();
    rebuild();
    setLoading(null);
  }

  async function addMusic(file: File) {
    setLoading('Reading music…');
    try {
      const buffer = await trailreelAudio.decodeFile(file);
      music = { buffer, name: file.name };
      $('musicInfo').textContent = `${file.name} · ${F.videoTime(buffer.duration)}${buffer.duration < (plan?.total ?? 0) ? ' · loops to fit' : ''}`;
      $('btnMusicRemove').hidden = false;
      if (playing) setPlaying(true);
    } catch (e) {
      toast(message(e), 'error');
    } finally {
      setLoading(null);
    }
  }

  async function loadPresetMusic(preset: AmbientPresetId, label: string) {
    setLoading(`Generating ${label} soundtrack…`);
    try {
      const buffer = await trailreelAudio.generatePresetTrack(preset);
      music = { buffer, name: `${label} (Ambient)` };
      $('musicInfo').textContent = `${music.name} · seamless loop`;
      $('btnMusicRemove').hidden = false;
      if (playing) setPlaying(true);
    } catch (e) {
      toast(message(e), 'error');
    } finally {
      setLoading(null);
    }
  }

  // ---------- export ----------
  function exportSize(quality: Quality, aspect: Aspect): [number, number] {
    if (aspect === '1:1') {
      return quality === 2160 ? [2160, 2160] : quality === 1080 ? [1080, 1080] : [720, 720];
    }
    const long = quality === 2160 ? 3840 : quality === 1080 ? 1920 : 1280;
    return aspect === '16:9' ? [long, quality] : [quality, long];
  }

  async function renderVideo(opts: { duration?: number; quality?: Quality } = {}) {
    if (!map || !track || !plan) throw new Error('Load an activity first.');
    if (mode !== 'video') setMode('video');
    if (grabCamera) setGrabCamera(false);
    const m = map;
    const [W, H] = exportSize(opts.quality ?? settings.quality, settings.aspect);
    const duration = Math.min(opts.duration ?? plan.total, plan.total);
    setPlaying(false);
    exporting = true;
    exportAbort = new AbortController();
    try {
      $('exportStatus').textContent = 'Checking the terrain along the route…';
      await ensureCameraGuard();
    } catch {
      /* without terrain the camera behaves as before */
    }
    let audio = null;
    if (music || voiceover) {
      $('exportStatus').textContent = 'Mixing music & voiceover…';
      try {
        audio = await trailreelAudio.encodeMix(currentAudioMix(), duration);
      } catch (e) {
        toast(`Exporting without audio: ${message(e)}`, 'error');
      }
    }
    const ovCanvas = document.createElement('canvas');
    ovCanvas.width = W;
    ovCanvas.height = H;
    const ovCtx = ovCanvas.getContext('2d')!;
    m.setPixelRatio(W / containerSize().w);
    try {
      const renderer: FrameRenderer = {
        async renderFrame(time, ctx, w, h) {
          const st = frameAt(time, true)!;
          await M.waitForIdle(m);
          ctx.drawImage(m.getCanvas(), 0, 0, w, h);
          trailreelOverlay.draw(ovCtx, w, h, st, sceneFor(w / containerSize().w));
          ctx.drawImage(ovCanvas, 0, 0);
          drawPreviewOverlay(st);
          t = time;
          updateTransport();
        },
      };
      return await trailreelExporter.exportMp4(renderer, {
        width: W,
        height: H,
        fps: settings.fps,
        duration,
        audio,
        signal: exportAbort.signal,
        onProgress: (f, eta) => {
          $<HTMLProgressElement>('exportProgress').value = f;
          $('exportStatus').textContent = `Rendering ${Math.round(f * 100)}%${eta != null ? ` · about ${F.videoTime(eta)} left` : ''}`;
        },
      });
    } finally {
      if (!disposed) m.setPixelRatio(window.devicePixelRatio);
      exporting = false;
      exportAbort = null;
    }
  }

  async function onExport() {
    const btn = $<HTMLButtonElement>('btnExport');
    const cancel = $<HTMLButtonElement>('btnCancel');
    btn.disabled = true;
    cancel.hidden = false;
    $('exportProgress').hidden = false;
    $('exportResult').hidden = true;
    try {
      const started = performance.now();
      const { blob, codec } = await renderVideo();
      if (lastVideo) URL.revokeObjectURL(lastVideo.url);
      const name = `${slug(settings.title || 'activity')}-trailreel.mp4`;
      lastVideo = { url: URL.createObjectURL(blob), file: new File([blob], name, { type: 'video/mp4' }) };
      const a = $<HTMLAnchorElement>('downloadLink');
      a.href = lastVideo.url;
      a.download = name;
      $<HTMLVideoElement>('resultVideo').src = lastVideo.url;
      $('exportResult').hidden = false;
      $('btnShare').hidden = !(navigator.canShare?.({ files: [lastVideo.file] }) ?? false);
      $('exportStatus').textContent = `Done in ${F.videoTime((performance.now() - started) / 1000)} · ${(blob.size / 1e6).toFixed(1)} MB · ${codec}`;
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      $('exportStatus').textContent = aborted ? 'Export cancelled.' : '';
      if (!aborted) toast(message(e), 'error');
    } finally {
      btn.disabled = false;
      cancel.hidden = true;
      $('exportProgress').hidden = true;
      renderAt(t);
    }
  }

  async function makePoster(): Promise<Blob> {
    if (!map || !track || !rig || !plan) throw new Error('Load an activity first.');
    if (mode !== 'video') setMode('video');
    setPlaying(false);
    const m = map;
    const [W, H] = exportSize(1080, settings.aspect);
    exporting = true;
    try {
      m.setPixelRatio(W / containerSize().w);
      applyCamera(rig.outro);
      M.setRouteProgress(m, 1, theme(), track.breaks);
      await M.waitForIdle(m);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(m.getCanvas(), 0, 0, W, H);
      trailreelOverlay.poster(ctx, W, H, sceneFor(W / containerSize().w));
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the poster image.'))), 'image/png'));
    } finally {
      m.setPixelRatio(window.devicePixelRatio);
      exporting = false;
      renderAt(t);
    }
  }

  async function onPoster() {
    const btn = $<HTMLButtonElement>('btnPoster');
    btn.disabled = true;
    $('exportStatus').textContent = 'Drawing poster…';
    try {
      const blob = await makePoster();
      if (posterUrl) URL.revokeObjectURL(posterUrl);
      posterUrl = URL.createObjectURL(blob);
      $<HTMLImageElement>('posterImg').src = posterUrl;
      const a = $<HTMLAnchorElement>('posterLink');
      a.href = posterUrl;
      a.download = `${slug(settings.title || 'activity')}-poster.png`;
      $('posterResult').hidden = false;
      $('exportStatus').textContent = 'Poster ready.';
    } catch (e) {
      toast(message(e), 'error');
      $('exportStatus').textContent = '';
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- recording (GPS & Voiceover) ----------
  const recorder = trailreelRecorder(
    (s) => {
      $('recordStatus').textContent = `Recording · ${F.distance(s.distance, settings.units)} · ${F.elapsed(s.elapsed)} · ${s.points} points${s.accuracy != null ? ` · GPS ±${Math.round(s.accuracy)} m` : ' · waiting for GPS'}`;
    },
    (msg) => toast(msg, 'error'),
  );
  async function toggleRecording() {
    const btn = $<HTMLButtonElement>('btnRecord');
    if (!recorder.recording) {
      try {
        await recorder.start();
        btn.textContent = 'Stop and save';
        btn.setAttribute('aria-pressed', 'true');
        $('recordStatus').hidden = false;
      } catch (e) {
        toast(message(e), 'error');
      }
      return;
    }
    const act = recorder.stop($<HTMLSelectElement>('recordSport').value as Sport);
    btn.textContent = 'Record GPS';
    btn.setAttribute('aria-pressed', 'false');
    $('recordStatus').hidden = true;
    if (!act) toast('Not enough GPS points were recorded to make an activity.', 'error');
    else await loadActivity(act);
  }

  const voiceRec = trailreelAudio.createVoiceRecorder((rms) => {
    $('voiceMeter').style.width = `${Math.round(rms * 100)}%`;
  });
  async function toggleVoiceRecording() {
    const btn = $<HTMLButtonElement>('btnVoiceRecord');
    if (!voiceRec.recording) {
      try {
        await voiceRec.start();
        btn.textContent = 'Stop recording';
        btn.setAttribute('aria-pressed', 'true');
        $('voiceInfo').textContent = 'Recording…';
      } catch (e) {
        toast(message(e), 'error');
      }
      return;
    }
    try {
      const buffer = await voiceRec.stop();
      voiceover = { buffer, name: 'Voiceover' };
      $('voiceInfo').textContent = `${F.videoTime(buffer.duration)} recorded`;
      $('btnVoiceClear').hidden = false;
      if (playing) setPlaying(true);
    } catch (e) {
      toast(message(e), 'error');
      $('voiceInfo').textContent = voiceover ? `${F.videoTime(voiceover.buffer.duration)} recorded` : 'None';
    } finally {
      btn.textContent = 'Record voiceover';
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  // ---------- Strava (only when the local connector is running) ----------
  async function initStrava() {
    const st = await trailreelStrava.status();
    if (!st || disposed) return;
    $('stravaBox').hidden = false;
    const hint = $('stravaHint');
    const btn = $<HTMLButtonElement>('btnStrava');
    const select = $<HTMLSelectElement>('stravaList');
    if (!st.configured) {
      btn.disabled = true;
      hint.textContent = 'Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env.local to enable Strava import.';
      return;
    }
    if (!st.connected) {
      btn.textContent = 'Connect with Strava';
      btn.onclick = () => (location.href = '/api/strava/login');
      return;
    }
    btn.textContent = 'Disconnect Strava';
    btn.onclick = async () => {
      await trailreelStrava.logout();
      location.href = '/';
    };
    hint.textContent = `Connected${st.athlete ? ` as ${st.athlete}` : ''}. Pick an activity:`;
    try {
      const list = await trailreelStrava.activities();
      select.replaceChildren(
        new Option(`${list.length} recent activities`, ''),
        ...list.map((a) => new Option(`${new Date(a.start).toLocaleDateString()} · ${a.name} (${F.distance(a.distance, settings.units)})`, String(a.id))),
      );
      select.hidden = false;
      select.onchange = async () => {
        if (!select.value) return;
        setLoading('Downloading activity from Strava…');
        try {
          await loadActivity(trailreelParse.activityFromJSON(await trailreelStrava.track(Number(select.value))));
        } catch (e) {
          setLoading(null);
          toast(message(e), 'error');
        }
      };
    } catch (e) {
      toast(message(e), 'error');
    }
  }

  // ---------- wiring ----------
  const fileInput = $<HTMLInputElement>('fileActivity');
  on(fileInput, 'change', () => {
    if (fileInput.files?.length) void importFiles([...fileInput.files]);
    fileInput.value = '';
  });
  const chapterInput = $<HTMLInputElement>('fileChapter');
  on(chapterInput, 'change', () => {
    if (chapterInput.files?.length) void addChapterFiles([...chapterInput.files]);
    chapterInput.value = '';
  });
  const ghostInput = $<HTMLInputElement>('fileGhost');
  on(ghostInput, 'change', () => {
    if (ghostInput.files?.length) void addGhostFiles([...ghostInput.files]);
    ghostInput.value = '';
  });
  on($('ghostSync'), 'change', (e: Event) => {
    settings.ghostSync = (e.target as HTMLSelectElement).value as 'time' | 'progress';
    if (!playing) renderAt(t);
  });

  // Trim sliders
  const trimStart = $<HTMLInputElement>('trimStart');
  const trimEnd = $<HTMLInputElement>('trimEnd');
  const applyTrim = () => {
    let s = Number(trimStart.value);
    let e = Number(trimEnd.value);
    if (s >= e - 0.04) {
      s = Math.max(0, e - 0.04);
      trimStart.value = String(s);
    }
    settings.trimStart = s;
    settings.trimEnd = e;
    if (!rawActivity) return;
    try {
      buildFromRaw();
      rebuild();
      updateInfo();
    } catch (err) {
      toast(message(err), 'error');
    }
  };
  on(trimStart, 'input', applyTrim);
  on(trimEnd, 'input', applyTrim);

  // Camera controls + Presets + Keyframes
  const camPitch = $<HTMLInputElement>('camPitch');
  const camZoom = $<HTMLInputElement>('camZoom');
  const camBearing = $<HTMLInputElement>('camBearing');
  const syncCamOutputs = () => {
    $('camPitchVal').textContent = `${Math.round(settings.cameraPitch)}°`;
    $('camZoomVal').textContent = `${settings.cameraZoomOffset >= 0 ? '+' : ''}${settings.cameraZoomOffset.toFixed(1)}`;
    $('camBearingVal').textContent = `${Math.round(settings.cameraBearingOffset)}°`;
  };
  on(camPitch, 'input', () => {
    settings.cameraPitch = Number(camPitch.value);
    syncCamOutputs();
    scheduleCameraGuard();
  });
  on(camZoom, 'input', () => {
    settings.cameraZoomOffset = Number(camZoom.value);
    syncCamOutputs();
    scheduleCameraGuard();
  });
  on(camBearing, 'input', () => {
    settings.cameraBearingOffset = Number(camBearing.value);
    syncCamOutputs();
    scheduleCameraGuard();
  });
  const avoidTerrain = $<HTMLInputElement>('avoidTerrain');
  avoidTerrain.checked = settings.cameraAvoidTerrain;
  on(avoidTerrain, 'change', () => {
    settings.cameraAvoidTerrain = avoidTerrain.checked;
    writePref(PREF_AVOID_TERRAIN, settings.cameraAvoidTerrain);
    scheduleCameraGuard();
  });

  const PRESETS: Record<string, { pitch: number; zoom: number; bearing: number }> = {
    follow: { pitch: 62, zoom: 0, bearing: 0 },
    cinematic: { pitch: 72, zoom: 0.9, bearing: -18 },
    overhead: { pitch: 18, zoom: -0.6, bearing: 0 },
    side: { pitch: 58, zoom: 0.2, bearing: 90 },
    reverse: { pitch: 56, zoom: 0.1, bearing: 180 },
  };
  root.querySelectorAll<HTMLButtonElement>('[data-cam-preset]').forEach((b) => {
    on(b, 'click', () => {
      const p = PRESETS[b.dataset.camPreset!];
      if (!p) return;
      settings.cameraPitch = p.pitch;
      settings.cameraZoomOffset = p.zoom;
      settings.cameraBearingOffset = p.bearing;
      camPitch.value = String(p.pitch);
      camZoom.value = String(p.zoom);
      camBearing.value = String(p.bearing);
      syncCamOutputs();
      scheduleCameraGuard();
    });
  });

  on($('btnGrabCamera'), 'click', () => setGrabCamera(!grabCamera));
  on($('btnAddKeyframe'), 'click', () => {
    if (!map || !track || !plan || !rig) return;
    const st = trailreelTimeline.stateAt(t, plan, track, rig, timelineOpts());
    const p = st.progress;
    const sample = trailreelTrack.sampleAt(track, p);
    let pitch = settings.cameraPitch;
    let zoomOffset = settings.cameraZoomOffset;
    let bearingOffset = settings.cameraBearingOffset;
    if (grabCamera) {
      pitch = G.clamp(map.getPitch(), 10, 78);
      zoomOffset = G.clamp(map.getZoom() - rig.followZoom, -3, 3);
      bearingOffset = G.angleDiff(sample.heading, map.getBearing());
    }
    keyframes = keyframes.filter((k) => Math.abs(k.at - p) > 0.015);
    keyframes.push({ id: crypto.randomUUID(), at: p, pitch, zoomOffset, bearingOffset });
    if (grabCamera) setGrabCamera(false);
    renderKeyframeList();
    renderScrubberMarkers();
    scheduleCameraGuard();
    toast(`Pinned camera keyframe at ${Math.round(p * 100)}%`);
  });

  // Photos + Modal Sheet Editor
  const photoInput = $<HTMLInputElement>('filePhotos');
  on(photoInput, 'change', () => {
    if (photoInput.files?.length) void addPhotos([...photoInput.files]);
    photoInput.value = '';
  });
  on($('btnPhotoDone'), 'click', closePhotoEditor);
  on($('photoModal'), 'click', (e: MouseEvent) => {
    if (e.target === $('photoModal')) closePhotoEditor();
  });
  on($('btnPhotoRotate'), 'click', () => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.rotation = ((ph.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    drawPhotoEditorPreview();
  });
  on($('btnPhotoReset'), 'click', () => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.crop = { aspect: 'free', zoom: 1, panX: 0, panY: 0 };
    $<HTMLInputElement>('photoZoom').value = '1';
    $('photoZoomVal').textContent = '1.0×';
    $<HTMLInputElement>('photoPanX').value = '0';
    $<HTMLInputElement>('photoPanY').value = '0';
    root.querySelectorAll<HTMLButtonElement>('[data-crop-aspect]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.cropAspect === 'free'));
    });
    drawPhotoEditorPreview();
  });
  on($('btnPhotoDelete'), 'click', () => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    photos = photos.filter((x) => x !== ph);
    ph.bitmap.close();
    URL.revokeObjectURL(ph.thumbUrl);
    closePhotoEditor();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-crop-aspect]').forEach((b) => {
    on(b, 'click', () => {
      const ph = photos.find((p) => p.id === editingPhotoId);
      if (!ph) return;
      ph.crop.aspect = b.dataset.cropAspect as PhotoCropAspect;
      root.querySelectorAll<HTMLButtonElement>('[data-crop-aspect]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawPhotoEditorPreview();
    });
  });
  on($('photoZoom'), 'input', (e: Event) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.crop.zoom = Number((e.target as HTMLInputElement).value);
    $('photoZoomVal').textContent = `${ph.crop.zoom.toFixed(1)}×`;
    drawPhotoEditorPreview();
  });
  on($('photoPanX'), 'input', (e: Event) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.crop.panX = Number((e.target as HTMLInputElement).value);
    drawPhotoEditorPreview();
  });
  on($('photoPanY'), 'input', (e: Event) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.crop.panY = Number((e.target as HTMLInputElement).value);
    drawPhotoEditorPreview();
  });
  // Direct manipulation: drag the photo inside the crop (1:1 with the pointer), scroll to zoom.
  const photoCanvas = $<HTMLCanvasElement>('photoEditCanvas');
  let cropDrag: { id: number; x: number; y: number; panX: number; panY: number } | null = null;
  const syncCropInputs = (ph: Photo) => {
    $<HTMLInputElement>('photoPanX').value = String(ph.crop.panX);
    $<HTMLInputElement>('photoPanY').value = String(ph.crop.panY);
    $<HTMLInputElement>('photoZoom').value = String(ph.crop.zoom);
    $('photoZoomVal').textContent = `${ph.crop.zoom.toFixed(1)}×`;
  };
  on(photoCanvas, 'pointerdown', (e: PointerEvent) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    photoCanvas.setPointerCapture(e.pointerId);
    cropDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: ph.crop.panX, panY: ph.crop.panY };
    photoCanvas.dataset.dragging = 'true';
  });
  on(photoCanvas, 'pointermove', (e: PointerEvent) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph || !cropDrag || e.pointerId !== cropDrag.id) return;
    const dim = trailreelPhotos.editedDimensions(ph, 440, 320); // same box drawPhotoEditorPreview uses
    const range = trailreelPhotos.panRange(ph, dim.w, dim.h);
    const k = photoCanvas.width / Math.max(1, photoCanvas.getBoundingClientRect().width); // CSS px → canvas px
    if (range.x > 0) ph.crop.panX = G.clamp(cropDrag.panX + ((e.clientX - cropDrag.x) * k) / range.x, -1, 1);
    if (range.y > 0) ph.crop.panY = G.clamp(cropDrag.panY + ((e.clientY - cropDrag.y) * k) / range.y, -1, 1);
    syncCropInputs(ph);
    drawPhotoEditorPreview();
  });
  const endCropDrag = (e: PointerEvent) => {
    if (!cropDrag || e.pointerId !== cropDrag.id) return;
    cropDrag = null;
    delete photoCanvas.dataset.dragging;
  };
  on(photoCanvas, 'pointerup', endCropDrag);
  on(photoCanvas, 'pointercancel', endCropDrag);
  on(photoCanvas, 'wheel', (e: WheelEvent) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    e.preventDefault();
    ph.crop.zoom = G.clamp(ph.crop.zoom * Math.exp(-e.deltaY * 0.0015), 1, 2.5);
    syncCropInputs(ph);
    drawPhotoEditorPreview();
  });

  on($('photoCaption'), 'input', (e: Event) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.caption = (e.target as HTMLInputElement).value;
    drawPhotoEditorPreview();
  });
  on($('photoDuration'), 'input', (e: Event) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    const v = Number((e.target as HTMLInputElement).value);
    ph.duration = v >= 0.8 ? v : null;
    $('photoDurationVal').textContent = ph.duration ? `${ph.duration.toFixed(1)} s` : 'Default';
  });
  on($('photoPosition'), 'input', (e: Event) => {
    const ph = photos.find((p) => p.id === editingPhotoId);
    if (!ph) return;
    ph.at = Number((e.target as HTMLInputElement).value);
    ph.placedBy = 'manual';
    $('photoPositionVal').textContent = `${Math.round(ph.at * 100)}%`;
  });

  // Audio controls
  const musicInput = $<HTMLInputElement>('fileMusic');
  on(musicInput, 'change', () => {
    if (musicInput.files?.[0]) void addMusic(musicInput.files[0]);
    musicInput.value = '';
  });
  root.querySelectorAll<HTMLButtonElement>('[data-music-preset]').forEach((b) => {
    on(b, 'click', () => void loadPresetMusic(b.dataset.musicPreset as AmbientPresetId, b.textContent ?? 'Ambient'));
  });
  on($('btnMusicRemove'), 'click', () => {
    music = null;
    $('musicInfo').textContent = 'No music. Videos export silent unless voiceover is added.';
    $('btnMusicRemove').hidden = true;
    if (playing) setPlaying(true);
  });
  on($('musicVolume'), 'input', (e: Event) => {
    settings.musicVolume = Number((e.target as HTMLInputElement).value);
    if (playing) setPlaying(true);
  });
  on($('musicOffset'), 'input', (e: Event) => {
    settings.musicOffset = Number((e.target as HTMLInputElement).value);
    if (playing) setPlaying(true);
  });
  on($('btnVoiceRecord'), 'click', () => void toggleVoiceRecording());
  on($('btnVoiceClear'), 'click', () => {
    voiceover = null;
    $('voiceInfo').textContent = 'None';
    $('btnVoiceClear').hidden = true;
    if (playing) setPlaying(true);
  });
  on($('voiceVolume'), 'input', (e: Event) => {
    settings.voiceoverVolume = Number((e.target as HTMLInputElement).value);
    if (playing) setPlaying(true);
  });

  // Drag & Drop files
  on(window, 'dragover', (e: DragEvent) => {
    e.preventDefault();
    root.classList.add(classes.dragging);
  });
  on(window, 'dragleave', (e: DragEvent) => {
    if (!e.relatedTarget) root.classList.remove(classes.dragging);
  });
  on(window, 'drop', (e: DragEvent) => {
    e.preventDefault();
    root.classList.remove(classes.dragging);
    const files = [...(e.dataTransfer?.files ?? [])];
    // Windows and Chrome often report HEIC with an empty MIME type, so check the extension too.
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    const audio = files.find((f) => f.type.startsWith('audio/'));
    void importFiles(files).then(async () => {
      if (images.length) await addPhotos(images);
      if (audio) await addMusic(audio);
    });
  });

  on($('btnDemo'), 'click', () => loadActivity(trailreelDemo()));
  on($('btnRecord'), 'click', () => toggleRecording());
  on($('btnGpx'), 'click', () => {
    if (rawActivity) download(new Blob([trailreelGpx(rawActivity)], { type: 'application/gpx+xml' }), `${slug(settings.title || rawActivity.name)}.gpx`);
  });
  on($('btnStory'), 'click', () => {
    if (!track) return;
    const html = trailreelStory.buildInteractiveStoryHtml({
      title: settings.title.trim() || track.activity.name,
      track,
      photos,
      chapters,
      ghosts,
      settings,
      theme: theme(),
      enrichment,
    });
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slug(settings.title || track.activity.name)}-story.html`);
    toast('Interactive 3D Web Story exported.');
  });
  on($('btnPoster'), 'click', () => onPoster());
  on($('btnShare'), 'click', async () => {
    if (!lastVideo) return;
    try {
      await navigator.share({ files: [lastVideo.file], title: settings.title || 'My Trailreel' });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast(message(e), 'error');
    }
  });
  on($('tabVideo'), 'click', () => setMode('video'));
  on($('tabExplore'), 'click', () => setMode('explore'));
  root.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) => on(b, 'click', () => explore?.setLayer(b.dataset.layer as RouteLayer)));
  on($('btnRecenter'), 'click', () => explore?.recenter());
  on(btnPlay, 'click', () => {
    if (!plan) return;
    if (!playing && t >= plan.total) t = 0;
    setPlaying(!playing);
  });

  // 1:1 Pointer Scrubber with rubber-band edges; it stops exactly where it is released
  let wasPlayingBeforeScrub = false;
  let scrubbingNow = false;
  cleanups.push(
    attachPointerScrubber(scrubber, {
      onScrub(fraction, dragging) {
        if (!plan) return;
        if (dragging && !scrubbingNow) {
          scrubbingNow = true;
          wasPlayingBeforeScrub = playing;
          if (playing) mixPlayer.stop();
        }
        t = fraction * plan.total;
        renderAt(t);
        if (!dragging && scrubbingNow) {
          scrubbingNow = false;
          if (wasPlayingBeforeScrub && playing) setPlaying(true);
        }
      },
      onOvershoot(px) {
        scrubber.style.transform = px ? `translateX(${px.toFixed(1)}px)` : '';
      },
    }),
  );
  on(window, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && editingPhotoId) closePhotoEditor();
  });
  on(scrubber, 'keydown', (e: KeyboardEvent) => {
    if (!plan) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      t = G.clamp(t + (e.key === 'ArrowRight' ? 0.5 : -0.5), 0, plan.total);
      renderAt(t);
    }
  });
  on(stage, 'keydown', (e: KeyboardEvent) => {
    if (e.key === ' ' && mode === 'video') {
      e.preventDefault();
      btnPlay.click();
    }
  });

  const lookupOnline = $<HTMLInputElement>('lookupOnline');
  lookupOnline.checked = settings.lookupOnline;
  on(lookupOnline, 'change', () => {
    settings.lookupOnline = lookupOnline.checked;
    writePref(PREF_LOOKUP, settings.lookupOnline);
    runEnrichment(); // looks up when switched on, clears place and weather when switched off
    updateInfo();
    lastLightingKey = '';
    if (!playing) renderAt(t);
  });

  const title = $<HTMLInputElement>('title');
  on(title, 'input', () => {
    settings.title = title.value;
    if (!playing) renderAt(t);
  });

  // Theme swatches
  const themesBox = $('themes');
  themesBox.replaceChildren(
    ...trailreelThemes.all.map((th) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = classes.swatch;
      b.title = th.name;
      b.setAttribute('aria-label', `${th.name} theme`);
      b.setAttribute('aria-pressed', String(th.id === settings.theme));
      b.style.background = `linear-gradient(135deg, ${th.route} 0 55%, ${th.accent} 55% 100%)`;
      b.addEventListener('click', () => {
        settings.theme = th.id;
        themesBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        $('themeName').textContent = th.name;
        explore?.refresh();
        if (!playing) renderAt(t);
      });
      return b;
    }),
  );

  const basemap = $<HTMLSelectElement>('basemap');
  basemap.replaceChildren(...Object.entries(M.BASEMAPS).map(([id, b]) => new Option(b.label, id)));
  on(basemap, 'change', () => {
    settings.basemap = basemap.value as BasemapId;
    if (map) M.setBasemap(map, settings.basemap);
    lastLightingKey = '';
    if (!playing) renderAt(t);
  });
  on($('lighting'), 'change', (e: Event) => {
    settings.lighting = (e.target as HTMLSelectElement).value as LightingMode;
    lastLightingKey = '';
    if (!playing) renderAt(t);
  });
  on($('aspect'), 'change', (e: Event) => {
    settings.aspect = (e.target as HTMLSelectElement).value as Aspect;
    stage.classList.toggle(classes.portrait, settings.aspect === '9:16');
    stage.classList.toggle(classes.square, settings.aspect === '1:1');
  });
  on($('duration'), 'change', (e: Event) => {
    settings.duration = Number((e.target as HTMLSelectElement).value);
    rebuild();
  });
  on($('photoHold'), 'change', (e: Event) => {
    settings.photoHold = (e.target as HTMLSelectElement).value as PhotoHold;
    rebuild();
  });
  on($('watermark'), 'change', (e: Event) => {
    settings.watermark = (e.target as HTMLInputElement).checked;
    if (!playing) renderAt(t);
  });
  on($('endCredits'), 'change', (e: Event) => {
    settings.endCredits = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  on($('privacy'), 'change', (e: Event) => {
    settings.privacy = Number((e.target as HTMLSelectElement).value);
    if (!rawActivity) return;
    try {
      buildFromRaw();
      rebuild();
      updateInfo();
    } catch (err) {
      toast(message(err), 'error');
    }
  });
  on($('units'), 'change', (e: Event) => {
    settings.units = (e.target as HTMLSelectElement).value as Units;
    if (map) M.setUnits(map, settings.units);
    updateInfo();
    renderGhostList();
    void refreshLibrary();
    explore?.refresh();
    if (!playing) renderAt(t);
  });
  on($('quality'), 'change', (e: Event) => {
    settings.quality = Number((e.target as HTMLSelectElement).value) as Quality;
  });
  on($('fps'), 'change', (e: Event) => {
    settings.fps = Number((e.target as HTMLSelectElement).value) as 30 | 60;
  });
  const exag = $<HTMLInputElement>('exaggeration');
  on(exag, 'input', () => {
    settings.exaggeration = Number(exag.value);
    $('exaggerationValue').textContent = `${settings.exaggeration.toFixed(1)}×`;
    map?.setTerrain({ source: 'dem', exaggeration: settings.exaggeration });
    scheduleCameraGuard();
  });
  on($('btnExport'), 'click', () => onExport());
  on($('btnCancel'), 'click', () => exportAbort?.abort());

  const ro = new ResizeObserver(() => {
    resizeOverlay();
    map?.resize();
    if (track) rebuild();
  });
  ro.observe(stage);
  cleanups.push(() => ro.disconnect());

  resizeOverlay();
  setActivePanel('route');
  if (!trailreelExporter.webCodecsAvailable()) $('exportStatus').textContent = 'Video export needs WebCodecs (a recent Chrome, Edge, Safari or Firefox).';
  if (!('geolocation' in navigator)) $<HTMLButtonElement>('btnRecord').disabled = true;
  void refreshLibrary();
  void initStrava();

  M.createMap($('map'), settings.basemap, settings.exaggeration, settings.units)
    .then((m) => {
      if (disposed) {
        m.remove();
        return;
      }
      map = m;
      m.on('error', (e) => console.warn('[map]', (e as unknown as { error?: Error }).error?.message ?? e));
      // Video mode keeps camera locked unless Free-look 3D view or Explore mode is active.
      m.dragPan.disable();
      m.dragRotate.disable();
      m.scrollZoom.disable();
      m.touchZoomRotate.disable();
      explore = trailreelExplore({ root, map: m, overlay, getTrack: () => track, getSettings: () => settings, getTheme: theme, getRig: () => rig });
      rafId = requestAnimationFrame(tick);
      void loadActivity(trailreelDemo());
    })
    .catch((e) => toast(`Map failed to load: ${message(e)}`, 'error'));

  // Automation hook for smoke tests (read-only state plus the same actions the UI offers).
  const hook = {
    state: () => ({
      t,
      total: plan?.total ?? 0,
      hasTrack: Boolean(track),
      playing,
      mode,
      activePanel,
      stats: track?.stats,
      enrichment,
      library: library.length,
      theme: settings.theme,
      chapters: chapters.length,
      chapterLabels: chapters.map((c) => `${c.unit} ${c.ordinal}/${c.count} @${c.startAt.toFixed(3)}`),
      breaks: track?.breaks ?? [],
      ghosts: ghosts.length,
      keyframes: keyframes.length,
      watermark: settings.watermark,
      endCredits: settings.endCredits,
      lookupOnline: settings.lookupOnline,
      cameraGuard: pitchLimit ? { samples: pitchLimit.length, minPitch: Math.min(...pitchLimit), maxPitch: Math.max(...pitchLimit) } : null,
      photos: photos.length,
    }),
    addPhotos: (fs: File[]) => addPhotos(fs),
    addChapterFiles: (fs: File[]) => addChapterFiles(fs),
    camera: () => (map ? { pitch: map.getPitch(), zoom: map.getZoom(), bearing: map.getBearing() } : null),
    seek: (time: number) => {
      setPlaying(false);
      t = Math.max(0, Math.min(time, plan?.total ?? 0));
      renderAt(t);
    },
    setMode,
    setActivePanel,
    exploreHover: (f: number) => explore?.hoverAt(f),
    setLayer: (l: RouteLayer) => explore?.setLayer(l),
    renderVideo: async (o: { duration?: number; quality?: Quality }) => {
      const r = await renderVideo(o);
      return { size: r.blob.size, codec: r.codec, url: URL.createObjectURL(r.blob) };
    },
    poster: async () => {
      const b = await makePoster();
      return { size: b.size, url: URL.createObjectURL(b) };
    },
    storyHtml: () =>
      track
        ? trailreelStory.buildInteractiveStoryHtml({
            title: settings.title.trim() || track.activity.name,
            track,
            photos,
            chapters,
            ghosts,
            settings,
            theme: theme(),
            enrichment,
          })
        : null,
    addMusic: (f: File) => addMusic(f),
    importFiles: (fs: File[]) => importFiles(fs),
    gpx: () => (rawActivity ? trailreelGpx(rawActivity) : null),
  };
  (window as unknown as { __trailreel?: typeof hook }).__trailreel = hook;

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(guardFrame);
    exportAbort?.abort();
    if (recorder.recording) recorder.stop('other');
    if (voiceRec.recording) voiceRec.cancel();
    mixPlayer.close();
    explore?.dispose();
    cleanups.forEach((fn) => fn());
    map?.remove();
    map = null;
    for (const p of photos) {
      p.bitmap.close();
      URL.revokeObjectURL(p.thumbUrl);
    }
    if (lastVideo) URL.revokeObjectURL(lastVideo.url);
    if (posterUrl) URL.revokeObjectURL(posterUrl);
    delete (window as unknown as { __trailreel?: unknown }).__trailreel;
  };
}
