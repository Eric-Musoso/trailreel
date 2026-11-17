import { trailreelGeo as G } from './trailreelGeo';
import type { Activity, Chapter, ChapterMeta, Sample, Stats, Track, TrackPoint } from './trailreelTypes';

/** True when the step from a to b jumps between two stitched chapters (not travelled). */
function isChapterJump(a: TrackPoint, b: TrackPoint): boolean {
  return a.chapter != null && b.chapter != null && a.chapter !== b.chapter;
}

/** Cumulative travelled distance per point; the jump between stitched chapters adds nothing. */
function travelCum(points: TrackPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const d = isChapterJump(points[i - 1], points[i]) ? 0 : G.haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    cum.push(cum[i - 1] + d);
  }
  return cum;
}

function cleanPoints(points: TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    if (p.lat === 0 && p.lon === 0) continue;
    const prev = out[out.length - 1];
    if (prev && G.haversine(prev.lat, prev.lon, p.lat, p.lon) < 0.5) continue;
    out.push(p);
  }
  return out;
}

/** Linearly fill null elevations; returns false if there is no elevation at all. */
function interpolateElevationGaps(points: TrackPoint[]): boolean {
  const known = points.map((p, i) => (p.ele != null && Number.isFinite(p.ele) ? i : -1)).filter((i) => i >= 0);
  if (known.length === 0) return false;
  for (let k = 0; k < points.length; k++) {
    if (points[k].ele != null) continue;
    let lo = -1;
    let hi = -1;
    for (const i of known) {
      if (i < k) lo = i;
      else {
        hi = i;
        break;
      }
    }
    if (lo < 0) points[k].ele = points[hi].ele;
    else if (hi < 0) points[k].ele = points[lo].ele;
    else points[k].ele = G.lerp(points[lo].ele!, points[hi].ele!, (k - lo) / (hi - lo));
  }
  return true;
}

/**
 * Privacy zone: drop the first and last `meters` of the route so the start and end
 * (often home) are not shown. Returns the original points if the route is too short.
 */
function trimEnds(points: TrackPoint[], meters: number): TrackPoint[] {
  if (meters <= 0 || points.length < 3) return points;
  const cum = travelCum(points);
  const total = cum[cum.length - 1];
  if (total < meters * 2 + 200) return points;
  const out = points.filter((_, i) => cum[i] >= meters && cum[i] <= total - meters);
  return out.length >= 2 ? out : points;
}

/**
 * Route clip trim: slice points to normalized distance bounds [trimStart, trimEnd] (0..1).
 * Returns original points if the resulting slice would be shorter than 2 points or 50 m.
 */
function sliceTrackPoints(points: TrackPoint[], trimStart: number, trimEnd: number): TrackPoint[] {
  const s = Math.max(0, Math.min(0.95, trimStart));
  const e = Math.max(s + 0.02, Math.min(1, trimEnd));
  if (s <= 0.001 && e >= 0.999) return points;
  if (points.length < 3) return points;
  const cum = travelCum(points);
  const total = cum[cum.length - 1];
  if (total < 50) return points;
  const minD = total * s;
  const maxD = total * e;
  const out = points.filter((_, i) => cum[i] >= minD && cum[i] <= maxD);
  if (out.length < 2) return points;
  const slicedCum = travelCum(out);
  return slicedCum[slicedCum.length - 1] >= 50 ? out : points;
}

/**
 * Stitch multiple activities (multi-day trips, triathlon legs) into one combined activity.
 * Every point is tagged with its chapter index, so day boundaries can be placed on the real
 * joined route later — including after trimming and the privacy zone.
 */
function stitchActivities(items: { id?: string; name: string; activity: Activity }[]): { combined: Activity; metas: ChapterMeta[] } {
  if (items.length === 0) throw new Error('No activities to stitch.');
  const unit: ChapterMeta['unit'] = new Set(items.map((it) => it.activity.sport)).size > 1 ? 'Leg' : 'Day';
  const metas: ChapterMeta[] = [];
  const allPoints: TrackPoint[] = [];
  items.forEach((it, k) => {
    const tr = buildTrack({ ...it.activity, points: it.activity.points.map((p) => ({ ...p, chapter: undefined })) });
    metas.push({
      id: it.id ?? crypto.randomUUID(),
      name: it.name || it.activity.name,
      sport: it.activity.sport,
      distance: tr.stats.distance,
      elevGain: tr.stats.elevGain,
      activity: it.activity,
      ordinal: k + 1,
      count: items.length,
      unit,
    });
    for (const p of it.activity.points) allPoints.push({ ...p, chapter: k });
  });

  const first = items[0].activity;
  const combined: Activity =
    items.length === 1
      ? { ...first, points: allPoints }
      : {
          name: items.map((x) => x.name || x.activity.name).slice(0, 2).join(' + ') + (items.length > 2 ? ` (+${items.length - 2})` : ''),
          sport: first.sport,
          source: `${items.length} stitched ${unit === 'Leg' ? 'legs' : 'days'}`,
          points: allPoints,
        };
  return { combined, metas };
}

/**
 * Place stitched chapters on a built track. Chapter k covers [its first point, the next
 * chapter's first point), so the transfer after a day still belongs to that day. Chapters
 * trimmed away completely are dropped; numbering keeps the original order ("Day 3/4").
 */
function chaptersFor(track: Track, metas: ChapterMeta[]): Chapter[] {
  const present = metas
    .map((m, k) => ({ m, span: track.chapterSpans.get(k) }))
    .filter((x): x is { m: ChapterMeta; span: [number, number] } => x.span != null)
    .sort((a, b) => a.span[0] - b.span[0]);
  if (!present.length) return metas.length ? [{ ...metas[0], startAt: 0, endAt: 1 }] : [];
  return present.map((x, i) => ({
    ...x.m,
    startAt: i === 0 ? 0 : x.span[0],
    endAt: i === present.length - 1 ? 1 : present[i + 1].span[0],
  }));
}

/** Index of the chapter shown at `progress` (0 when there is only one). */
function chapterIndexAt(chapters: Chapter[], progress: number): number {
  for (let i = chapters.length - 1; i > 0; i--) if (progress >= chapters[i].startAt) return i;
  return 0;
}

function movingAverage(values: ArrayLike<number>, radius: number): number[] {
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      if (!Number.isFinite(values[j])) continue;
      s += values[j];
      c++;
    }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

/** `cum` is travelled distance; `jumps` holds indices i where the step i-1 → i is a chapter jump. */
function computeStats(pts: TrackPoint[], cum: number[], ele: number[], jumps: Set<number>): Stats {
  const distance = cum[cum.length - 1];
  const times = pts.map((p) => p.time);
  const hasTime = times.every((t) => t != null) && times[times.length - 1]! > times[0]!;

  let elevGain = 0;
  let elevLoss = 0;
  let ref = ele[0];
  for (let i = 0; i < ele.length; i++) {
    const e = ele[i];
    // A new day starts where it starts: the height difference across the jump was not climbed.
    if (jumps.has(i)) {
      ref = e;
      continue;
    }
    // 3 m hysteresis removes GPS/barometer noise that would otherwise inflate gain.
    if (e - ref > 3) {
      elevGain += e - ref;
      ref = e;
    } else if (ref - e > 3) {
      elevLoss += ref - e;
      ref = e;
    }
  }

  let duration: number | null = null;
  let movingTime: number | null = null;
  let maxSpeed: number | null = null;
  if (hasTime) {
    duration = (times[times.length - 1]! - times[0]!) / 1000;
    movingTime = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = (times[i]! - times[i - 1]!) / 1000;
      const dd = cum[i] - cum[i - 1];
      if (dt > 0 && dt < 300 && dd / dt > 0.4) movingTime += dt;
    }
    let j = 0;
    maxSpeed = 0;
    for (let i = 0; i < pts.length; i++) {
      // Shrink the window from the left while it still spans at least 10 s.
      while (j < i - 1 && (times[i]! - times[j + 1]!) / 1000 >= 10) j++;
      const dt = (times[i]! - times[j]!) / 1000;
      if (dt >= 10) maxSpeed = Math.max(maxSpeed, (cum[i] - cum[j]) / dt);
    }
    if (movingTime < 1) movingTime = duration;
  }

  return {
    distance,
    duration,
    movingTime,
    elevGain,
    elevLoss,
    elevMax: Math.max(...ele),
    elevMin: Math.min(...ele),
    avgSpeed: movingTime ? distance / movingTime : null,
    maxSpeed,
    startTime: hasTime ? times[0]! : null,
  };
}

function buildTrack(activity: Activity): Track {
  const pts = cleanPoints(activity.points);
  if (pts.length < 2) throw new Error('The activity has fewer than two usable GPS points.');
  interpolateElevationGaps(pts);
  for (const p of pts) if (p.ele == null) p.ele = 0;

  // `cum` is the path the camera flies (including jumps between stitched chapters);
  // `travel` is the distance actually covered, which every displayed number uses.
  const cum = [0];
  const travel = [0];
  const jumps = new Set<number>();
  for (let i = 1; i < pts.length; i++) {
    const d = G.haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    const jump = isChapterJump(pts[i - 1], pts[i]);
    if (jump) jumps.add(i);
    cum.push(cum[i - 1] + d);
    travel.push(travel[i - 1] + (jump ? 0 : d));
  }
  const total = cum[cum.length - 1];
  if (total < 50) throw new Error('The activity is shorter than 50 m, so there is nothing to fly over.');

  // Smooth elevation within each chapter only, so one day's heights don't bleed into the next.
  const ele: number[] = [];
  for (let start = 0; start < pts.length; ) {
    let end = start + 1;
    while (end < pts.length && !jumps.has(end)) end++;
    ele.push(
      ...movingAverage(
        pts.slice(start, end).map((p) => p.ele!),
        3,
      ),
    );
    start = end;
  }
  const stats = computeStats(pts, travel, ele, jumps);
  const hasTime = stats.startTime != null;

  const breaks: [number, number][] = [];
  for (const i of jumps) if (cum[i] - cum[i - 1] > 1) breaks.push([cum[i - 1] / total, cum[i] / total]);
  breaks.sort((a, b) => a[0] - b[0]);

  const chapterSpans = new Map<number, [number, number]>();
  pts.forEach((p, i) => {
    if (p.chapter == null) return;
    const f = cum[i] / total;
    const span = chapterSpans.get(p.chapter);
    if (span) span[1] = f;
    else chapterSpans.set(p.chapter, [f, f]);
  });

  // Story warp: a long transfer between days takes at most ~4% of the flight instead of its
  // full length, so a drive between two rides doesn't eat half the video.
  const travelled = travel[travel.length - 1];
  const cap = Math.max(150, 0.04 * travelled);
  const knotsP = [0];
  const knotsS = [0];
  let removed = 0;
  for (const [a, b] of breaks) {
    const len = (b - a) * total;
    const kept = Math.min(len, cap);
    knotsP.push(a, b);
    knotsS.push(a * total - removed, a * total - removed + kept);
    removed += len - kept;
  }
  knotsP.push(1);
  knotsS.push(total - removed);
  const storyTotal = Math.max(1e-9, total - removed);
  const warpP = Float64Array.from(knotsP);
  const warpU = Float64Array.from(knotsS, (s) => s / storyTotal);

  // Resample at even distance steps (~5 m, 300..3000 samples).
  const n = Math.max(300, Math.min(3000, Math.round(total / 5)));
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const el = new Float64Array(n);
  const time = new Float64Array(n);
  const dist = new Float64Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[seg]) / span)) : 0;
    const a = pts[seg];
    const b = pts[seg + 1];
    lon[i] = G.lerp(a.lon, b.lon, t);
    lat[i] = G.lerp(a.lat, b.lat, t);
    el[i] = G.lerp(ele[seg], ele[seg + 1], t);
    time[i] = a.time != null && b.time != null ? G.lerp(a.time, b.time, t) : NaN;
    dist[i] = G.lerp(travel[seg], travel[seg + 1], t);
  }

  // Grade over a ±25 m window and speed over a ±60 m window, both lightly smoothed.
  const step = total / (n - 1);
  const gk = Math.max(1, Math.round(25 / step));
  const sk = Math.max(1, Math.round(60 / step));
  const rawGrade = new Float64Array(n);
  const rawSpeed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - gk);
    const b = Math.min(n - 1, i + gk);
    rawGrade[i] = dist[b] > dist[a] ? ((el[b] - el[a]) / (dist[b] - dist[a])) * 100 : 0;
    const sa = Math.max(0, i - sk);
    const sb = Math.min(n - 1, i + sk);
    const dt = (time[sb] - time[sa]) / 1000;
    rawSpeed[i] = hasTime && dt > 0 ? (dist[sb] - dist[sa]) / dt : NaN;
  }
  const grade = Float32Array.from(movingAverage(rawGrade, 2));
  const speed = Float32Array.from(hasTime ? movingAverage(rawSpeed, 3) : rawSpeed);

  // Camera heading: bearing across a look-ahead window, then heavily smoothed as unit vectors.
  const k = Math.max(2, Math.round(n * 0.012));
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k);
    const b = Math.min(n - 1, i + k);
    raw[i] = G.bearing(lat[a], lon[a], lat[b], lon[b]);
  }
  let sx = Array.from(raw, (deg) => Math.sin((deg * Math.PI) / 180));
  let cx = Array.from(raw, (deg) => Math.cos((deg * Math.PI) / 180));
  const w = Math.max(3, Math.round(n * 0.035));
  for (let pass = 0; pass < 3; pass++) {
    sx = movingAverage(sx, w);
    cx = movingAverage(cx, w);
  }
  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) heading[i] = ((Math.atan2(sx[i], cx[i]) * 180) / Math.PI + 360) % 360;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < n; i++) {
    minLon = Math.min(minLon, lon[i]);
    maxLon = Math.max(maxLon, lon[i]);
    minLat = Math.min(minLat, lat[i]);
    maxLat = Math.max(maxLat, lat[i]);
  }

  return {
    activity,
    n,
    lon,
    lat,
    ele: el,
    time,
    dist,
    heading,
    grade,
    speed,
    total,
    hasTime,
    bounds: [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    stats,
    breaks,
    chapterSpans,
    warpU,
    warpP,
  };
}

/** Piecewise-linear lookup on increasing knots xs → ys. */
function interpKnots(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return span > 0 ? G.lerp(ys[lo], ys[hi], (x - xs[lo]) / span) : ys[hi];
}

/** Story fraction (transfers between days compressed) → route progress. Identity without breaks. */
function storyToProgress(track: Track, u: number): number {
  return interpKnots(track.warpU, track.warpP, u);
}

/** Route progress → story fraction. */
function progressToStory(track: Track, p: number): number {
  return interpKnots(track.warpP, track.warpU, p);
}

/** The transfer containing `progress`: its ends, how far through it we are (0..1) and its length in metres. */
function breakAt(track: Track, progress: number): { from: number; to: number; local: number; meters: number } | null {
  for (const [a, b] of track.breaks) {
    if (progress > a && progress < b) return { from: a, to: b, local: (progress - a) / (b - a), meters: (b - a) * track.total };
  }
  return null;
}

/**
 * Route progress → share (0..1) of the distance actually travelled. It stays flat across a
 * transfer between stitched days, so elevation profiles drawn on this axis leave the drive out.
 */
function progressToTravel(track: Track, p: number): number {
  const total = track.dist[track.n - 1];
  return total > 0 ? sampleAt(track, p).dist / total : Math.min(1, Math.max(0, p));
}

/** Share of the distance travelled → route progress (a transfer resolves to the end of the earlier day). */
function travelToProgress(track: Track, x: number): number {
  const total = track.dist[track.n - 1];
  if (!(total > 0)) return Math.min(1, Math.max(0, x));
  const target = Math.min(1, Math.max(0, x)) * total;
  if (target <= track.dist[0]) return 0;
  let lo = 0;
  let hi = track.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.dist[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = track.dist[hi] - track.dist[lo];
  return (lo + (span > 0 ? (target - track.dist[lo]) / span : 1)) / (track.n - 1);
}

/** Interpolated position at fraction f (0..1) of the route distance. */
function sampleAt(track: Track, f: number): Sample {
  const x = Math.min(1, Math.max(0, f)) * (track.n - 1);
  const i = Math.min(track.n - 2, Math.floor(x));
  const t = x - i;
  return {
    lon: G.lerp(track.lon[i], track.lon[i + 1], t),
    lat: G.lerp(track.lat[i], track.lat[i + 1], t),
    ele: G.lerp(track.ele[i], track.ele[i + 1], t),
    time: G.lerp(track.time[i], track.time[i + 1], t),
    heading: G.lerpAngle(track.heading[i], track.heading[i + 1], t),
    dist: G.lerp(track.dist[i], track.dist[i + 1], t),
    grade: G.lerp(track.grade[i], track.grade[i + 1], t),
    speed: G.lerp(track.speed[i], track.speed[i + 1], t),
  };
}

type RouteCollection = {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: [number, number][] } }[];
};

function routeGeoJSON(track: Track): RouteCollection {
  const coordinates: [number, number][] = [];
  for (let i = 0; i < track.n; i++) coordinates.push([track.lon[i], track.lat[i]]);
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
  };
}

export const trailreelTrack = {
  buildTrack,
  sampleAt,
  routeGeoJSON,
  interpolateElevationGaps,
  trimEnds,
  sliceTrackPoints,
  stitchActivities,
  chaptersFor,
  chapterIndexAt,
  storyToProgress,
  progressToStory,
  breakAt,
  progressToTravel,
  travelToProgress,
};
