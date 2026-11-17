/**
 * The "director": a pure function from video time t to what the frame shows.
 * Preview and export both call stateAt(t), so the exported video matches the preview.
 */
import { trailreelCameraGuard } from './trailreelCameraGuard';
import { trailreelGeo as G } from './trailreelGeo';
import { trailreelLighting } from './trailreelLighting';
import { trailreelTrack } from './trailreelTrack';
import type { Camera, CameraKeyframe, CameraRig, Chapter, FrameState, LightingMode, Photo, PhotoHold, Plan, Segment, Track } from './trailreelTypes';

const INTRO = 4.6;
const INTRO_HOLD = 2.0;
const OUTRO = 5.5;
const CREDITS = 3.0;
const MIN_FLY = 6;
const HOLD: Record<PhotoHold, number> = { short: 2.2, normal: 3.2, long: 5.0 };

/**
 * Flight time is shared out by story distance: the transfer between two stitched days is
 * compressed (see trailreelTrack.storyToProgress), everything else by distance travelled.
 */
function buildPlan(photos: Photo[], duration: number, opts: { photoHold: PhotoHold; credits: boolean; track?: Track | null }): Plan {
  const story = (p: number) => (opts.track ? trailreelTrack.progressToStory(opts.track, p) : p);
  const defaultHold = HOLD[opts.photoHold];
  const credits = opts.credits ? CREDITS : 0;
  const totalPhotoHold = photos.reduce((acc, ph) => acc + (ph.duration ?? defaultHold), 0);
  const fly = Math.max(MIN_FLY, duration - INTRO - OUTRO - credits - totalPhotoHold);
  const segments: Segment[] = [];
  let t = INTRO;
  let p0 = 0;
  photos.forEach((ph, i) => {
    const hold = ph.duration ?? defaultHold;
    const dt = fly * Math.max(0, story(ph.at) - story(p0));
    if (dt > 0.01) segments.push({ kind: 'fly', t0: t, t1: t + dt, p0, p1: ph.at });
    t += Math.max(0, dt);
    segments.push({ kind: 'photo', t0: t, t1: t + hold, p: ph.at, photo: i });
    t += hold;
    p0 = Math.max(p0, ph.at);
  });
  const last = fly * Math.max(0, 1 - story(p0));
  segments.push({ kind: 'fly', t0: t, t1: t + last, p0, p1: 1 });
  t += last;
  return { total: t + OUTRO + credits, intro: INTRO, outro: OUTRO, credits, segments };
}

/** Video time at which the flight reaches route progress p (for timeline markers and jumps). */
function timeAtProgress(plan: Plan, track: Track, p: number): number {
  const story = (x: number) => trailreelTrack.progressToStory(track, x);
  for (const seg of plan.segments) {
    if (seg.kind === 'photo') {
      if (Math.abs(seg.p - p) < 1e-6) return seg.t0;
      continue;
    }
    if (p >= seg.p0 && p <= seg.p1) {
      const span = story(seg.p1) - story(seg.p0);
      const k = span > 0 ? (story(p) - story(seg.p0)) / span : 0;
      // Invert the flight easing (monotone) by bisection so markers sit where the frame is.
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        if (G.lerp(mid, G.easeInOutSine(mid), 0.35) < k) lo = mid;
        else hi = mid;
      }
      return seg.t0 + (seg.t1 - seg.t0) * ((lo + hi) / 2);
    }
  }
  return p <= 0 ? plan.intro : plan.total - plan.credits - plan.outro;
}

/** Zoom that keeps a few km in view; longer routes get a higher camera. */
function followZoomFor(totalMeters: number, portrait: boolean): number {
  const km = Math.max(0.5, totalMeters / 1000);
  return G.clamp(15.1 - 0.85 * Math.log2(km / 4), 11.4, 15.3) - (portrait ? 0.35 : 0);
}

export interface TimelineCameraOptions {
  pitch?: number;
  zoomOffset?: number;
  bearingOffset?: number;
  keyframes?: CameraKeyframe[];
  chapters?: Chapter[];
  lightingMode?: LightingMode;
  weatherCode?: number | null;
  /** terrain guard pitch caps along the route (trailreelCameraGuard); null = no guard */
  pitchLimit?: Float32Array | null;
}

/** The camera offsets (pitch, zoom, orbit) the user asked for at route progress p, keyframes included. */
function cameraOffsetsAt(progress: number, rig: CameraRig, opts?: TimelineCameraOptions) {
  return interpolateCameraOffsets(progress, opts?.pitch ?? rig.followPitch, opts?.zoomOffset ?? 0, opts?.bearingOffset ?? 0, opts?.keyframes);
}

function interpolateCameraOffsets(
  progress: number,
  basePitch: number,
  baseZoomOffset: number,
  baseBearingOffset: number,
  keyframes?: CameraKeyframe[],
): { pitch: number; zoomOffset: number; bearingOffset: number } {
  if (!keyframes || keyframes.length === 0) {
    return { pitch: basePitch, zoomOffset: baseZoomOffset, bearingOffset: baseBearingOffset };
  }
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  if (progress <= sorted[0].at) {
    // Smooth blend from base rig into first keyframe over up to 0.12 progress before it
    const lead = Math.min(0.12, sorted[0].at);
    if (lead <= 0.001) return { pitch: sorted[0].pitch, zoomOffset: sorted[0].zoomOffset, bearingOffset: sorted[0].bearingOffset };
    const u = G.easeInOutCubic((progress - (sorted[0].at - lead)) / lead);
    return {
      pitch: G.lerp(basePitch, sorted[0].pitch, u),
      zoomOffset: G.lerp(baseZoomOffset, sorted[0].zoomOffset, u),
      bearingOffset: G.lerpAngle(baseBearingOffset, sorted[0].bearingOffset, u),
    };
  }
  const last = sorted[sorted.length - 1];
  if (progress >= last.at) {
    const tail = Math.min(0.12, 1 - last.at);
    if (tail <= 0.001) return { pitch: last.pitch, zoomOffset: last.zoomOffset, bearingOffset: last.bearingOffset };
    const u = G.easeInOutCubic((progress - last.at) / tail);
    return {
      pitch: G.lerp(last.pitch, basePitch, u),
      zoomOffset: G.lerp(last.zoomOffset, baseZoomOffset, u),
      bearingOffset: G.lerpAngle(last.bearingOffset, baseBearingOffset, u),
    };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (progress >= a.at && progress <= b.at) {
      const span = Math.max(1e-5, b.at - a.at);
      const u = G.easeInOutCubic((progress - a.at) / span);
      return {
        pitch: G.lerp(a.pitch, b.pitch, u),
        zoomOffset: G.lerp(a.zoomOffset, b.zoomOffset, u),
        bearingOffset: G.lerpAngle(a.bearingOffset, b.bearingOffset, u),
      };
    }
  }
  return { pitch: basePitch, zoomOffset: baseZoomOffset, bearingOffset: baseBearingOffset };
}

function followCamera(track: Track, rig: CameraRig, progress: number, opts?: TimelineCameraOptions): Camera {
  const s = trailreelTrack.sampleAt(track, progress);
  const ov = cameraOffsetsAt(progress, rig, opts);
  // Terrain guard: never steeper than the pitch that keeps the rider and the trail ahead visible.
  const pitch = Math.min(G.clamp(ov.pitch, 0, 78), opts?.pitchLimit ? trailreelCameraGuard.pitchCapAt(opts.pitchLimit, progress) : 78);
  // Transfer between two stitched days: hop up and over instead of skimming the ground at speed.
  const jump = trailreelTrack.breakAt(track, progress);
  const hop = jump ? G.clamp(Math.log2(jump.meters / 1500), 0, 4) * Math.sin(Math.PI * jump.local) : 0;
  return {
    center: [s.lon, s.lat],
    zoom: G.clamp(rig.followZoom + ov.zoomOffset - hop, 6, 18.5),
    pitch,
    bearing: (s.heading + ov.bearingOffset + 360) % 360,
    padTop: rig.followPadTop * G.clamp(pitch / 62, 0.2, 1.15),
  };
}

function mix(a: Camera, b: Camera, k: number): Camera {
  return {
    center: [G.lerp(a.center[0], b.center[0], k), G.lerp(a.center[1], b.center[1], k)],
    zoom: G.lerp(a.zoom, b.zoom, k),
    pitch: G.lerp(a.pitch, b.pitch, k),
    bearing: G.lerpAngle(a.bearing, b.bearing, k),
    padTop: G.lerp(a.padTop, b.padTop, k),
  };
}

function chapterFor(progress: number, chapters?: Chapter[]): number {
  return chapters && chapters.length > 1 ? trailreelTrack.chapterIndexAt(chapters, progress) : 0;
}

function stateAt(t: number, plan: Plan, track: Track, rig: CameraRig, opts?: TimelineCameraOptions): FrameState {
  const tt = G.clamp(t, 0, plan.total);

  const makeState = (phase: FrameState['phase'], progress: number, camera: Camera): FrameState => {
    // During a transfer between days the interpolated clock reads "overnight"; light it like the
    // nearer end instead, so the hop doesn't flash into night mode.
    const jump = trailreelTrack.breakAt(track, progress);
    const s = trailreelTrack.sampleAt(track, jump ? (jump.local < 0.5 ? jump.from : jump.to) : progress);
    const lighting = trailreelLighting.lightingAt(
      opts?.lightingMode ?? 'auto',
      s.lat,
      s.lon,
      s.time,
      opts?.weatherCode,
    );
    return {
      t: tt,
      phase,
      progress,
      camera,
      titleAlpha: 0,
      statsAlpha: 0,
      hudAlpha: 0,
      creditsAlpha: 0,
      photo: null,
      chapterIndex: chapterFor(progress, opts?.chapters),
      lighting,
    };
  };

  if (tt < plan.intro) {
    const k = G.easeInOutCubic((tt - INTRO_HOLD) / (plan.intro - INTRO_HOLD));
    const st = makeState('intro', 0, mix(rig.overview, followCamera(track, rig, 0, opts), k));
    st.titleAlpha = G.smoothstep(tt / 0.5) * (1 - G.smoothstep((tt - (plan.intro - 1.6)) / 0.8));
    st.hudAlpha = G.smoothstep((tt - (plan.intro - 0.8)) / 0.8);
    return st;
  }

  const creditsStart = plan.total - plan.credits;
  const outroStart = creditsStart - plan.outro;
  if (tt >= outroStart) {
    const u = tt - outroStart;
    const k = G.easeInOutCubic(u / 2.2);
    const orbit = { ...rig.outro, bearing: rig.outro.bearing + 4 * u };
    const inCredits = plan.credits > 0 && tt >= creditsStart;
    const st = makeState(inCredits ? 'credits' : 'outro', 1, mix(followCamera(track, rig, 1, opts), orbit, k));
    st.statsAlpha = G.smoothstep((u - 1.2) / 0.7);
    st.hudAlpha = 1 - G.smoothstep((u - 0.2) / 0.8);
    st.creditsAlpha = inCredits ? G.smoothstep((tt - creditsStart) / 0.45) : 0;
    return st;
  }

  const seg = plan.segments.find((s) => tt >= s.t0 && tt < s.t1) ?? plan.segments[plan.segments.length - 1];
  if (seg.kind === 'photo') {
    const k = (tt - seg.t0) / (seg.t1 - seg.t0);
    const cam = followCamera(track, rig, seg.p, opts);
    cam.zoom += 0.25 * Math.sin(Math.PI * k);
    const st = makeState('photo', seg.p, cam);
    st.hudAlpha = 1;
    st.photo = { index: seg.photo, k };
    return st;
  }

  const u = G.clamp((tt - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0), 0, 1);
  const s0 = trailreelTrack.progressToStory(track, seg.p0);
  const s1 = trailreelTrack.progressToStory(track, seg.p1);
  const progress = trailreelTrack.storyToProgress(track, G.lerp(s0, s1, G.lerp(u, G.easeInOutSine(u), 0.35)));
  const st = makeState('fly', progress, followCamera(track, rig, progress, opts));
  st.hudAlpha = 1;
  return st;
}

export const trailreelTimeline = { buildPlan, followZoomFor, stateAt, timeAtProgress, cameraOffsetsAt };
