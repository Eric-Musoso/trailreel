/**
 * Terrain-aware camera guard. Relive's follow camera often hides the trail behind a ridge;
 * this keeps it in view. For points along the route it finds the steepest pitch (no steeper
 * than the one asked for) at which the line of sight from the camera to the rider, and to the
 * route a little ahead, clears the terrain. The result is smoothed so the camera starts to
 * rise before a ridge rather than at it.
 *
 * Everything is precomputed from the same terrain tiles the map draws, so the preview and
 * the exported video get exactly the same camera.
 */
import { trailreelGeo as G } from './trailreelGeo';
import { trailreelTrack } from './trailreelTrack';
import type { DemSampler } from './trailreelDem';
import type { Track } from './trailreelTypes';

const SAMPLES = 320;
const PITCH_STEP = 3;
const LOS_SAMPLES = 28;
/** terrain must stay this far (exaggerated metres) below the line of sight */
const CLEARANCE_M = 8;
/** ignore terrain this close to the target: DEM noise right next to the rider is not a ridge */
const NEAR_TARGET_M = 40;
const AHEAD_M = 250;
const MAX_PITCH = 78;
const RAD = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
/** smoothing: two box passes of this radius (in samples); erosion is wide enough to cover them */
const SMOOTH_R = 10;
const RISE_EARLY = 16;
/** fastest the cap may change between neighbouring samples (degrees per 1/SAMPLES of the route) */
const MAX_SLEW = 1.5;

/** MapLibre puts the camera 0.5 / tan(fov / 2) × viewport height from the centre (fov 36.87° → 1.5 H), in CSS px. */
function cameraDistanceMeters(zoom: number, lat: number, viewHeight: number): number {
  const metersPerPixel = (40_075_016.686 * Math.cos(lat * RAD)) / (512 * 2 ** zoom);
  return 1.5 * viewHeight * metersPerPixel;
}

export interface GuardParams {
  followZoom: number;
  /** map viewport height in CSS pixels (the export renders the same viewport at a higher pixel ratio) */
  viewHeight: number;
  exaggeration: number;
  /** the camera offsets the timeline would use at route progress p, before the guard */
  offsetsAt: (p: number) => { pitch: number; zoomOffset: number; bearingOffset: number };
}

interface Point3 {
  lon: number;
  lat: number;
  alt: number;
}

function lineOfSightClear(sampler: DemSampler, exaggeration: number, cam: Point3, target: Point3): boolean {
  const kx = M_PER_DEG_LAT * Math.cos(target.lat * RAD);
  const horizontal = Math.hypot((cam.lon - target.lon) * kx, (cam.lat - target.lat) * M_PER_DEG_LAT);
  for (let k = 1; k < LOS_SAMPLES; k++) {
    const u = k / LOS_SAMPLES; // 0 = target, 1 = camera
    if (u * horizontal < NEAR_TARGET_M) continue;
    const ground = sampler.elevation(G.lerp(target.lon, cam.lon, u), G.lerp(target.lat, cam.lat, u));
    if (ground != null && ground * exaggeration > G.lerp(target.alt, cam.alt, u) - CLEARANCE_M) return false;
  }
  return true;
}

/**
 * The highest pitch ≤ `desired` that sees the rider and the route ahead at route progress p.
 * Steps down a few degrees at a time; usually a modest drop clears a ridge, and only a cliff
 * right behind the rider goes as far as straight overhead (0°), which always sees the rider.
 */
function clearPitchAt(track: Track, sampler: DemSampler, params: GuardParams, p: number): number {
  const o = params.offsetsAt(p);
  const desired = G.clamp(o.pitch, 0, MAX_PITCH);
  if (desired <= 0) return 0;
  const E = params.exaggeration;
  const s = trailreelTrack.sampleAt(track, p);
  const a = trailreelTrack.sampleAt(track, Math.min(1, p + AHEAD_M / Math.max(1, track.total)));
  const rider: Point3 = { lon: s.lon, lat: s.lat, alt: (sampler.elevation(s.lon, s.lat) ?? s.ele) * E };
  const ahead: Point3 = { lon: a.lon, lat: a.lat, alt: (sampler.elevation(a.lon, a.lat) ?? a.ele) * E };
  const zoom = G.clamp(params.followZoom + o.zoomOffset, 6, 18.5);
  const d = cameraDistanceMeters(zoom, s.lat, params.viewHeight);
  const bearing = (s.heading + o.bearingOffset) * RAD;
  const kx = M_PER_DEG_LAT * Math.cos(s.lat * RAD);
  const tryPitch = (pitch: number) => {
    const back = d * Math.sin(pitch * RAD);
    const cam: Point3 = {
      lon: s.lon - (back * Math.sin(bearing)) / kx,
      lat: s.lat - (back * Math.cos(bearing)) / M_PER_DEG_LAT,
      alt: rider.alt + d * Math.cos(pitch * RAD),
    };
    return lineOfSightClear(sampler, E, cam, rider) && lineOfSightClear(sampler, E, cam, ahead);
  };
  for (let pitch = desired; pitch > 0; pitch -= PITCH_STEP) if (tryPitch(pitch)) return pitch;
  return 0;
}

/**
 * Pitch caps at SAMPLES evenly spaced route positions. Use with `pitchCapAt`; the camera
 * takes min(its own pitch, the cap).
 */
function computePitchLimits(track: Track, sampler: DemSampler, params: GuardParams): Float32Array {
  const N = SAMPLES;
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) raw[i] = clearPitchAt(track, sampler, params, i / (N - 1));

  // Erode: each point takes the lowest cap from a little behind it to further ahead, so the
  // camera rises before the ridge. The window covers the smoothing radius on both sides, which
  // keeps the smoothed cap at or below the raw cap where the ridge actually is.
  const back = 2 * SMOOTH_R + 1;
  const fwd = 2 * SMOOTH_R + RISE_EARLY;
  let cap = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - back); j <= Math.min(N - 1, i + fwd); j++) m = Math.min(m, raw[j]);
    cap[i] = m;
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, i - SMOOTH_R); j <= Math.min(N - 1, i + SMOOTH_R); j++) {
        sum += cap[j];
        c++;
      }
      next[i] = sum / c;
    }
    cap = next;
  }
  // Rate limit: a cliff can ask for a big drop; spread it into an even tilt. This only ever
  // lowers the cap, so the rider stays visible wherever the steps above guaranteed it.
  for (let i = 1; i < N; i++) cap[i] = Math.min(cap[i], cap[i - 1] + MAX_SLEW);
  for (let i = N - 2; i >= 0; i--) cap[i] = Math.min(cap[i], cap[i + 1] + MAX_SLEW);
  return cap;
}

/** The pitch cap at route progress p (linear between samples). */
function pitchCapAt(limits: Float32Array, p: number): number {
  const x = G.clamp(p, 0, 1) * (limits.length - 1);
  const i = Math.min(limits.length - 2, Math.floor(x));
  return G.lerp(limits[i], limits[i + 1], x - i);
}

/** Terrain the guard needs: the route plus how far behind the rider the camera can sit. */
function guardBounds(track: Track, followZoom: number, viewHeight: number): [[number, number], [number, number]] {
  const [[w, s], [e, n]] = track.bounds;
  const lat = Math.max(Math.abs(s), Math.abs(n));
  // Allow one zoom level further out than the default follow camera; capped so long routes stay light.
  const margin = Math.min(25_000, cameraDistanceMeters(followZoom - 1, lat, viewHeight) * Math.sin(MAX_PITCH * RAD)) + 500;
  const dLat = margin / M_PER_DEG_LAT;
  const dLon = margin / (M_PER_DEG_LAT * Math.cos(Math.min(85, lat) * RAD));
  return [
    [w - dLon, Math.max(-85, s - dLat)],
    [e + dLon, Math.min(85, n + dLat)],
  ];
}

/** True when `outer` contains `inner`. */
function covers(outer: [[number, number], [number, number]], inner: [[number, number], [number, number]]): boolean {
  return outer[0][0] <= inner[0][0] && outer[0][1] <= inner[0][1] && outer[1][0] >= inner[1][0] && outer[1][1] >= inner[1][1];
}

export const trailreelCameraGuard = { computePitchLimits, pitchCapAt, guardBounds, covers, cameraDistanceMeters };
