// Shared types for the Trailreel engine (type-only module).
export interface TrackPoint {
  lat: number;
  lon: number;
  /** metres above sea level, null when the source had no elevation */
  ele: number | null;
  /** epoch milliseconds, null when the source had no timestamps */
  time: number | null;
  hr?: number | null;
  /** index of the stitched chapter this point came from (multi-day / multi-sport) */
  chapter?: number;
}

export type Sport = 'ride' | 'run' | 'hike' | 'walk' | 'ski' | 'water' | 'other';

export interface Activity {
  name: string;
  sport: Sport;
  source: string;
  points: TrackPoint[];
}

export type PhotoCropAspect = 'free' | '1:1' | '4:3' | '16:9' | '3:4';

export interface PhotoCrop {
  aspect: PhotoCropAspect;
  zoom: number;
  panX: number;
  panY: number;
}

export interface Photo {
  id: string;
  name: string;
  bitmap: ImageBitmap;
  thumbUrl: string;
  lat: number | null;
  lon: number | null;
  time: number | null;
  /** fraction 0..1 along the route where the photo is shown */
  at: number;
  placedBy: 'gps' | 'time' | 'spread' | 'manual';
  /** clockwise rotation in degrees */
  rotation: 0 | 90 | 180 | 270;
  crop: PhotoCrop;
  caption: string;
  /** per-photo display duration override in seconds; null = global photoHold */
  duration: number | null;
}

export type Units = 'metric' | 'imperial';
export type Aspect = '16:9' | '9:16' | '1:1';
export type Quality = 720 | 1080 | 2160;
export type BasemapId = 'esri' | 'eox' | 'topo';
export type PhotoHold = 'short' | 'normal' | 'long';
export type RouteLayer = 'route' | 'grade' | 'speed';
export type LightingMode = 'auto' | 'day' | 'sunrise' | 'golden' | 'night';

export interface CameraKeyframe {
  id: string;
  /** fraction 0..1 along the route */
  at: number;
  pitch: number;
  zoomOffset: number;
  bearingOffset: number;
  label?: string;
}

/** One stitched day or leg, before it is placed on a (possibly trimmed) track. */
export interface ChapterMeta {
  id: string;
  name: string;
  sport: Sport;
  distance: number;
  elevGain: number;
  activity: Activity;
  /** 1-based position among all stitched chapters */
  ordinal: number;
  /** how many chapters were stitched */
  count: number;
  /** "Day" when every chapter is the same sport, "Leg" for multi-sport (triathlon) */
  unit: 'Day' | 'Leg';
}

/** A chapter placed on the track: it covers route progress [startAt, endAt). */
export interface Chapter extends ChapterMeta {
  startAt: number;
  endAt: number;
}

export interface GhostRider {
  id: string;
  name: string;
  color: string;
  activity: Activity;
  track: Track;
}

export interface LightingState {
  mode: 'day' | 'sunrise' | 'golden' | 'night';
  skyColor: string;
  horizonColor: string;
  fogColor: string;
  hillshadeShadow: string;
  hillshadeHighlight: string;
  hillshadeExag: number;
  brightnessMax: number;
  saturation: number;
  headlampAlpha: number;
  sunElevationDeg: number;
  /** compass direction the sunlight comes from (0 = north, clockwise) */
  sunAzimuthDeg: number;
}

export interface Theme {
  id: string;
  name: string;
  /** route line colour */
  route: string;
  /** outline drawn under the route line */
  casing: string;
  /** HUD accent (avatar, chips, brand box) */
  accent: string;
  /** text colour on top of the accent */
  onAccent: string;
}

export interface Settings {
  title: string;
  duration: number;
  fps: 30 | 60;
  aspect: Aspect;
  units: Units;
  exaggeration: number;
  basemap: BasemapId;
  quality: Quality;
  theme: string;
  photoHold: PhotoHold;
  endCredits: boolean;
  watermark: boolean;
  /** metres hidden at the start and end of the route (privacy zone); 0 = off */
  privacy: number;
  /** normalized route clip trim bounds (0..1) */
  trimStart: number;
  trimEnd: number;
  /** camera rig overrides */
  cameraPitch: number;
  cameraZoomOffset: number;
  cameraBearingOffset: number;
  lighting: LightingMode;
  musicVolume: number;
  musicOffset: number;
  voiceoverVolume: number;
  ghostSync: 'time' | 'progress';
  /** lower the camera pitch where terrain would hide the rider or the route ahead */
  cameraAvoidTerrain: boolean;
  /** look up the place name and weather online (sends the start point rounded to ~1 km) */
  lookupOnline: boolean;
}

export interface Weather {
  tempC: number;
  code: number;
}

export interface Enrichment {
  place: string | null;
  weather: Weather | null;
  timeZone: string | null;
}

export interface Stats {
  distance: number;
  duration: number | null;
  movingTime: number | null;
  elevGain: number;
  elevLoss: number;
  elevMax: number;
  elevMin: number;
  avgSpeed: number | null;
  maxSpeed: number | null;
  startTime: number | null;
}

/** A route resampled at even distance steps. */
export interface Track {
  activity: Activity;
  n: number;
  lon: Float64Array;
  lat: Float64Array;
  ele: Float64Array;
  time: Float64Array;
  dist: Float64Array;
  heading: Float64Array;
  /** slope in percent, smoothed */
  grade: Float32Array;
  /** speed in m/s, NaN when the activity has no timestamps */
  speed: Float32Array;
  total: number;
  hasTime: boolean;
  bounds: [[number, number], [number, number]];
  stats: Stats;
  /**
   * Progress intervals [from, to] that were not travelled: the jump between two stitched
   * chapters (e.g. a drive between days). Hidden on the map, excluded from distance and
   * flown through quickly.
   */
  breaks: [number, number][];
  /** chapter index → progress span [first, last] of that chapter's points on this track */
  chapterSpans: Map<number, [number, number]>;
  /** piecewise-linear knots mapping story fraction u (breaks compressed) ↔ route progress p */
  warpU: Float64Array;
  warpP: Float64Array;
}

export interface Sample {
  lon: number;
  lat: number;
  ele: number;
  time: number;
  heading: number;
  dist: number;
  grade: number;
  speed: number;
}

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  padTop: number;
}

export interface CameraRig {
  overview: Camera;
  outro: Camera;
  followZoom: number;
  followPitch: number;
  followPadTop: number;
}

export type Segment =
  | { kind: 'fly'; t0: number; t1: number; p0: number; p1: number }
  | { kind: 'photo'; t0: number; t1: number; p: number; photo: number };

export interface Plan {
  total: number;
  intro: number;
  outro: number;
  credits: number;
  segments: Segment[];
}

export interface FrameState {
  t: number;
  phase: 'intro' | 'fly' | 'photo' | 'outro' | 'credits';
  progress: number;
  camera: Camera;
  titleAlpha: number;
  statsAlpha: number;
  hudAlpha: number;
  creditsAlpha: number;
  photo: { index: number; k: number } | null;
  chapterIndex: number;
  lighting: LightingState;
}

export interface Scene {
  track: Track;
  photos: Photo[];
  chapters: Chapter[];
  ghosts: GhostRider[];
  settings: Settings;
  theme: Theme;
  title: string;
  sport: Sport;
  enrichment: Enrichment;
  attribution: string;
  project: (lon: number, lat: number) => { x: number; y: number } | null;
}

export interface LibraryEntry {
  id: string;
  name: string;
  sport: Sport;
  source: string;
  startTime: number | null;
  distance: number;
  elevGain: number;
  savedAt: number;
  lat: number;
  lon: number;
}
