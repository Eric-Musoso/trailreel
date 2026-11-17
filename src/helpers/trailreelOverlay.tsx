/**
 * 2D overlay drawn on top of the map canvas: intro card, HUD, avatar, headlamp beam,
 * ghost/group riders, chapter badges, photo pins, photo pop-ups with captions/crop/rotation,
 * end stats, end credits and attribution. Same code for preview and export.
 */
import { trailreelEnrich } from './trailreelEnrich';
import { trailreelFormat as F } from './trailreelFormat';
import { trailreelGeo as G } from './trailreelGeo';
import { trailreelMap } from './trailreelMap';
import { trailreelPhotos } from './trailreelPhotos';
import { trailreelTrack } from './trailreelTrack';
import type { FrameState, GhostRider, Scene, Sport, Theme, Track } from './trailreelTypes';

const sampleAt = trailreelTrack.sampleAt;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif';
const PANEL = 'rgba(14, 19, 24, 0.66)';
const SPORT_ICON: Record<Sport, string> = { ride: '🚴', run: '🏃', hike: '🥾', walk: '🚶', ski: '⛷️', water: '🛶', other: '🧭' };

function font(ctx: CanvasRenderingContext2D, weight: number, px: number) {
  ctx.font = `${weight} ${Math.round(px)}px ${FONT}`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxW && last.length > 1) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

const profileCache = new WeakMap<Track, Float32Array>();
/** Elevation profile over the distance travelled, so a transfer between days takes no width. */
function profile(track: Track): Float32Array {
  let p = profileCache.get(track);
  if (p) return p;
  const N = 240;
  p = new Float32Array(N);
  const lo = track.stats.elevMin;
  const span = Math.max(30, track.stats.elevMax - lo);
  for (let i = 0; i < N; i++) p[i] = (sampleAt(track, trailreelTrack.travelToProgress(track, i / (N - 1))).ele - lo) / span;
  profileCache.set(track, p);
  return p;
}

/** Compute normalized progress 0..1 for a ghost rider at the primary track's current progress. */
function ghostProgress(ghost: GhostRider, primary: Track, primaryProgress: number, syncMode: 'time' | 'progress'): number {
  if (syncMode === 'time' && primary.hasTime && ghost.track.hasTime) {
    const primaryElapsed = sampleAt(primary, primaryProgress).time - primary.time[0];
    const targetTime = ghost.track.time[0] + Math.max(0, primaryElapsed);
    if (targetTime <= ghost.track.time[0]) return 0;
    if (targetTime >= ghost.track.time[ghost.track.n - 1]) return 1;
    let lo = 0;
    let hi = ghost.track.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ghost.track.time[mid] < targetTime) lo = mid;
      else hi = mid;
    }
    const span = Math.max(1, ghost.track.time[hi] - ghost.track.time[lo]);
    return (lo + (targetTime - ghost.track.time[lo]) / span) / (ghost.track.n - 1);
  }
  return primaryProgress;
}

/** The brand glyph: a rounded square in the accent colour with a mountain line. */
function logoMark(ctx: CanvasRenderingContext2D, x: number, y: number, box: number, theme: Theme) {
  rr(ctx, x, y, box, box, box * 0.26);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + box * 0.18, y + box * 0.72);
  ctx.lineTo(x + box * 0.42, y + box * 0.34);
  ctx.lineTo(x + box * 0.56, y + box * 0.54);
  ctx.lineTo(x + box * 0.66, y + box * 0.42);
  ctx.lineTo(x + box * 0.84, y + box * 0.72);
  ctx.strokeStyle = theme.onAccent;
  ctx.lineWidth = box * 0.09;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawBrand(ctx: CanvasRenderingContext2D, W: number, s: number, m: number, theme: Theme) {
  font(ctx, 800, 30 * s);
  const word = 'Trailreel';
  const tw = ctx.measureText(word).width;
  const box = 50 * s;
  const x = W - m - tw - box - 12 * s;
  const y = m;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10 * s;
  logoMark(ctx, x, y, box, theme);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8 * s;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, x + box + 12 * s, y + box / 2 + 1 * s);
  ctx.restore();
}

function statItems(scene: Scene): [string, string][] {
  const { stats } = scene.track;
  const units = scene.settings.units;
  const time = stats.movingTime ?? stats.duration;
  const speed = stats.avgSpeed != null ? F.speed(stats.avgSpeed, units, scene.sport) : null;
  const items: [string, string][] = [['Distance', F.distance(stats.distance, units)]];
  if (time != null) items.push(['Moving time', F.duration(time)]);
  items.push(['Elevation gain', F.elevation(stats.elevGain, units)]);
  items.push(speed ? [speed.label, speed.value] : ['Highest point', F.elevation(stats.elevMax, units)]);
  return items;
}

/** Relive-style intro: route sketch + stats top-left, big title bottom-left with an accent tag. */
function drawIntro(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, m: number, st: FrameState, scene: Scene) {
  const { track, enrichment, settings, theme } = scene;
  const a = st.titleAlpha;
  const slide = (1 - a) * 24 * s;
  ctx.save();
  ctx.globalAlpha = a;

  const compact = H >= W * 0.95; // portrait or 1:1 square
  const card = (compact ? 132 : 150) * s;
  const cx = m;
  const cy = m - slide;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18 * s;
  rr(ctx, cx, cy, card, card, 22 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.shadowBlur = 0;
  const [[minLon, minLat], [maxLon, maxLat]] = track.bounds;
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max(1e-9, (maxLon - minLon) * k);
  const spanY = Math.max(1e-9, maxLat - minLat);
  const inner = card - 34 * s;
  const sc = inner / Math.max(spanX, spanY);
  const ox = cx + (card - spanX * sc) / 2;
  const oy = cy + (card - spanY * sc) / 2;
  const px = (i: number) => ox + (track.lon[i] - minLon) * k * sc;
  const py = (i: number) => oy + (maxLat - track.lat[i]) * sc;
  // Lift the pen across transfers between stitched days: they were not travelled.
  const inBreak = (i: number) => {
    const f = i / (track.n - 1);
    return track.breaks.some(([a, b]) => f > a && f < b);
  };
  const idx: number[] = [];
  for (let i = 0; i < track.n; i += 3) idx.push(i);
  if (idx[idx.length - 1] !== track.n - 1) idx.push(track.n - 1);
  ctx.beginPath();
  let penDown = false;
  for (const i of idx) {
    if (inBreak(i)) {
      penDown = false;
      continue;
    }
    (penDown ? ctx.lineTo : ctx.moveTo).call(ctx, px(i), py(i));
    penDown = true;
  }
  ctx.strokeStyle = theme.route === '#ffffff' ? '#111418' : theme.route;
  ctx.lineWidth = 4 * s;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px(0), py(0), 6 * s, 0, Math.PI * 2);
  ctx.fillStyle = '#16a34a';
  ctx.fill();

  const items = statItems(scene);
  let sx = compact ? m : cx + card + 26 * s;
  let sy = compact ? cy + card + 32 * s : cy + 44 * s;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8 * s;
  for (const [label, value] of items) {
    font(ctx, 800, 30 * s);
    const vw = ctx.measureText(value).width;
    font(ctx, 600, 13 * s);
    const lw = ctx.measureText(label.toUpperCase()).width;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.toUpperCase(), sx, sy);
    font(ctx, 800, 30 * s);
    ctx.fillStyle = '#fff';
    ctx.fillText(value, sx, sy + 36 * s);
    sx += Math.max(vw, lw) + 34 * s;
    if (compact && sx > W - m - 150 * s) {
      sx = m;
      sy += 74 * s;
    }
  }

  const titlePx = (compact ? 68 : 84) * s;
  font(ctx, 900, titlePx);
  const lines = wrap(ctx, scene.title.toUpperCase(), W - 2 * m - 40 * s, 2);
  const tag: string[] = [F.sportLabel[scene.sport].toUpperCase()];
  const ch0 = scene.chapters[0];
  if (ch0 && ch0.count > 1) tag.push(`${ch0.count} ${ch0.unit === 'Leg' ? 'LEGS' : 'DAYS'}`);
  if (track.stats.startTime != null) tag.push(F.date(track.stats.startTime, enrichment.timeZone).toUpperCase());
  if (enrichment.place) tag.push(enrichment.place.toUpperCase());
  if (enrichment.weather) tag.push(`${F.temp(enrichment.weather.tempC, settings.units)} ${trailreelEnrich.weatherLabel(enrichment.weather.code).toUpperCase()}`);
  font(ctx, 800, 22 * s);
  const tagLine = wrap(ctx, tag.join('  •  '), W - 2 * m - 40 * s, 1)[0];
  const tagW = ctx.measureText(tagLine).width + 28 * s;
  const tagY = H - m - 70 * s + slide;
  rr(ctx, m, tagY, tagW, 44 * s, 6 * s);
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.fillStyle = theme.onAccent;
  ctx.fillText(tagLine, m + 14 * s, tagY + 30 * s);
  font(ctx, 900, titlePx);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 16 * s;
  const lineH = titlePx * 1.06;
  let ty = tagY - 22 * s - (lines.length - 1) * lineH;
  for (const l of lines) {
    ctx.fillText(l, m, ty);
    ty += lineH;
  }
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, W: number, s: number, m: number, st: FrameState, scene: Scene) {
  const theme = scene.theme;
  const brandSpace = scene.settings.watermark ? 230 * s : 0;
  const w = Math.min(620 * s, W - 2 * m - brandSpace);
  const h = 96 * s;
  const x = m;
  const y = m;
  ctx.save();
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = PANEL;
  ctx.fill();
  const cx = x + h / 2;
  const cy = y + h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 34 * s, 0, Math.PI * 2);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  font(ctx, 400, 34 * s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const activeSport = scene.chapters[st.chapterIndex]?.sport ?? scene.sport;
  ctx.fillText(SPORT_ICON[activeSport], cx, cy + 2 * s);

  const px = x + h + 6 * s;
  const pw = w - h - 40 * s;
  const py = y + 20 * s;
  const ph = h - 40 * s;
  const prof = profile(scene.track);
  const done = trailreelTrack.progressToTravel(scene.track, st.progress);
  const pathFor = () => {
    ctx.beginPath();
    ctx.moveTo(px, py + ph);
    for (let i = 0; i < prof.length; i++) ctx.lineTo(px + (i / (prof.length - 1)) * pw, py + ph - prof[i] * ph);
    ctx.lineTo(px + pw, py + ph);
    ctx.closePath();
  };
  pathFor();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py - 4 * s, pw * done, ph + 8 * s);
  ctx.clip();
  pathFor();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.restore();
  const fi = Math.min(prof.length - 1, Math.round(done * (prof.length - 1)));
  ctx.beginPath();
  ctx.arc(px + pw * done, py + ph - prof[fi] * ph, 6 * s, 0, Math.PI * 2);
  ctx.fillStyle = theme.accent;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5 * s;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawChapterBadge(ctx: CanvasRenderingContext2D, s: number, m: number, st: FrameState, scene: Scene) {
  if (scene.chapters.length <= 1) return;
  const ch = scene.chapters[st.chapterIndex];
  if (!ch) return;
  const label = `${ch.unit.toUpperCase()} ${ch.ordinal}/${ch.count}  ·  ${ch.name}`;
  ctx.save();
  font(ctx, 700, 16 * s);
  const tw = ctx.measureText(label).width;
  const w = tw + 32 * s;
  const h = 38 * s;
  const x = m;
  const y = m + 108 * s;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 16 * s, y + h / 2 + 1 * s);
  ctx.restore();
}

function drawChips(ctx: CanvasRenderingContext2D, H: number, s: number, m: number, st: FrameState, scene: Scene) {
  const { track, settings } = scene;
  const here = sampleAt(track, st.progress);
  const items: [string, string][] = [
    ['Distance', F.distance(here.dist, settings.units)],
    ['Elevation', F.elevation(here.ele, settings.units)],
  ];
  if (track.hasTime && Number.isFinite(here.time)) items.push(['Elapsed', F.elapsed((here.time - track.time[0]) / 1000)]);
  let x = m;
  const y = H - m - 70 * s;
  ctx.save();
  for (const [label, value] of items) {
    font(ctx, 800, 26 * s);
    const vw = ctx.measureText(value).width;
    font(ctx, 600, 13 * s);
    const lw = ctx.measureText(label.toUpperCase()).width;
    const w = Math.max(vw, lw) + 36 * s;
    rr(ctx, x, y, w, 64 * s, 16 * s);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.toUpperCase(), x + 18 * s, y + 22 * s);
    font(ctx, 800, 26 * s);
    ctx.fillStyle = '#fff';
    ctx.fillText(value, x + 18 * s, y + 51 * s);
    x += w + 10 * s;
  }
  ctx.restore();
}

/** Glowing headlamp cone projected forward along the route in night/twilight lighting. */
function drawHeadlamp(ctx: CanvasRenderingContext2D, s: number, st: FrameState, scene: Scene) {
  const alpha = st.lighting.headlampAlpha;
  if (alpha <= 0.02) return;
  const here = sampleAt(scene.track, st.progress);
  const ahead = sampleAt(scene.track, Math.min(1, st.progress + 0.015));
  const p0 = scene.project(here.lon, here.lat);
  const p1 = scene.project(ahead.lon, ahead.lat);
  if (!p0) return;
  const angle = p1 && Math.hypot(p1.x - p0.x, p1.y - p0.y) > 2 ? Math.atan2(p1.y - p0.y, p1.x - p0.x) : -Math.PI / 2;
  const len = 190 * s;
  ctx.save();
  ctx.translate(p0.x, p0.y);
  ctx.rotate(angle);
  const grad = ctx.createRadialGradient(0, 0, 6 * s, 0, 0, len);
  grad.addColorStop(0, `rgba(255, 245, 200, ${0.72 * alpha})`);
  grad.addColorStop(0.45, `rgba(255, 232, 165, ${0.28 * alpha})`);
  grad.addColorStop(1, 'rgba(255, 230, 150, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, len, -0.34, 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGhosts(ctx: CanvasRenderingContext2D, s: number, st: FrameState, scene: Scene) {
  if (!scene.ghosts.length) return;
  for (const g of scene.ghosts) {
    const gp = ghostProgress(g, scene.track, st.progress, scene.settings.ghostSync);
    const sample = sampleAt(g.track, gp);
    const pt = scene.project(sample.lon, sample.lat);
    if (!pt) continue;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6 * s;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 10 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = g.color;
    ctx.fill();

    // Name pill above the ghost dot
    font(ctx, 700, 13 * s);
    const label = g.name;
    const tw = ctx.measureText(label).width;
    const pw = tw + 16 * s;
    const ph = 24 * s;
    const px = pt.x - pw / 2;
    const py = pt.y - 16 * s - ph;
    rr(ctx, px, py, pw, ph, ph / 2);
    ctx.fillStyle = 'rgba(14, 19, 24, 0.78)';
    ctx.fill();
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pt.x, py + ph / 2 + 0.5 * s);
    ctx.restore();
  }
}

function drawAvatar(ctx: CanvasRenderingContext2D, s: number, st: FrameState, scene: Scene) {
  drawHeadlamp(ctx, s, st, scene);
  const here = sampleAt(scene.track, st.progress);
  const pt = scene.project(here.lon, here.lat);
  if (!pt) return;
  const pulse = (st.t * 1.4) % 1;
  ctx.save();
  ctx.globalAlpha = 0.45 * (1 - pulse);
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, (14 + 22 * pulse) * s, 0, Math.PI * 2);
  ctx.fillStyle = scene.theme.accent;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8 * s;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 13 * s, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 8.5 * s, 0, Math.PI * 2);
  ctx.fillStyle = scene.theme.accent === '#f4f6f8' ? '#111418' : scene.theme.accent;
  ctx.fill();
  ctx.restore();
}

function drawPhotoPins(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, st: FrameState, scene: Scene) {
  const size = 54 * s;
  const pins: { i: number; x: number; y: number }[] = [];
  scene.photos.forEach((ph, i) => {
    if (st.photo?.index === i) return;
    const at = sampleAt(scene.track, ph.at);
    const pt = scene.project(at.lon, at.lat);
    if (!pt || pt.x < -60 || pt.y < -60 || pt.x > W + 60 || pt.y > H + 60) return;
    pins.push({ i, x: pt.x, y: pt.y });
  });

  // Pins whose cards would overlap (short loops, photos taken close together) become one stack
  // with a count, instead of a pile of cards hiding each other and the trail.
  const groups: (typeof pins)[] = [];
  for (const p of pins) {
    const g = groups.find((grp) => Math.hypot(grp[0].x - p.x, grp[0].y - p.y) < size * 0.9);
    if (g) g.push(p);
    else groups.push([p]);
  }

  for (const g of groups) {
    // Front card: the next photo still ahead of the rider, else the most recent one passed.
    const ahead = g.filter((p) => scene.photos[p.i].at > st.progress);
    const front = ahead.length ? ahead[0] : g[g.length - 1];
    const ph = scene.photos[front.i];
    const x = front.x - size / 2;
    const y = front.y - size - 14 * s;
    ctx.save();
    ctx.globalAlpha *= ph.at <= st.progress ? 0.8 : 1;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 10 * s;
    ctx.fillStyle = '#fff';
    for (let k = Math.min(2, g.length - 1); k >= 1; k--) {
      rr(ctx, x + 5 * s * k, y - 5 * s * k, size, size, 10 * s);
      ctx.fill();
    }
    rr(ctx, x, y, size, size, 10 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(front.x - 8 * s, y + size - 1);
    ctx.lineTo(front.x, front.y - 4 * s);
    ctx.lineTo(front.x + 8 * s, y + size - 1);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save();
    rr(ctx, x + 4 * s, y + 4 * s, size - 8 * s, size - 8 * s, 7 * s);
    ctx.clip();
    trailreelPhotos.drawEditedPhoto(ctx, ph, x + 4 * s, y + 4 * s, size - 8 * s, size - 8 * s);
    ctx.restore();
    if (g.length > 1) {
      const r = 13 * s;
      const bx = x + size + 5 * s * Math.min(2, g.length - 1) - 4 * s;
      const by = y - 5 * s * Math.min(2, g.length - 1) + 4 * s;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = scene.theme.accent;
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      font(ctx, 800, 14 * s);
      ctx.fillStyle = scene.theme.onAccent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(g.length), bx, by + 0.5 * s);
    }
    ctx.restore();
  }
}

function drawPhotoCard(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, st: FrameState, scene: Scene) {
  if (!st.photo) return;
  const ph = scene.photos[st.photo.index];
  if (!ph) return;
  const k = st.photo.k;
  const a = G.smoothstep(k / 0.14) * (1 - G.smoothstep((k - 0.86) / 0.14));
  const grow = 0.9 + 0.1 * G.easeOutBack(G.clamp(k / 0.3, 0, 1));
  const caption = ph.caption.trim();
  const captionH = caption ? 48 * s * grow : 0;
  const dim = trailreelPhotos.editedDimensions(ph, W * 0.72, H * 0.66 - (caption ? 48 * s : 0));
  const w = dim.w * grow;
  const h = dim.h * grow;
  const imgY = -(h + captionH) / 2;
  const border = 12 * s;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate((-1.5 * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 30 * s;
  rr(ctx, -w / 2 - border, imgY - border, w + 2 * border, h + 2 * border + captionH, 18 * s);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  rr(ctx, -w / 2, imgY, w, h, 8 * s);
  ctx.clip();
  trailreelPhotos.drawEditedPhoto(ctx, ph, -w / 2, imgY, w, h);
  ctx.restore();

  if (caption) {
    font(ctx, 600, 22 * s * grow);
    const line = wrap(ctx, caption, w - 12 * s, 1)[0];
    ctx.fillStyle = '#16191d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(line, 0, imgY + h + border + captionH / 2 - 4 * s);
  }
  ctx.restore();
}

function drawStats(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, m: number, st: FrameState, scene: Scene) {
  const items = statItems(scene);
  const a = st.statsAlpha;
  ctx.save();
  ctx.globalAlpha = a;
  const cols = H >= W * 0.95 ? 2 : items.length;
  const rows = Math.ceil(items.length / cols);
  const bw = W - 2 * m;
  const rowH = 112 * s;
  const y = m - (1 - a) * 30 * s;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24 * s;
  rr(ctx, m, y, bw, rows * rowH, 26 * s);
  ctx.fillStyle = 'rgba(14,19,24,0.86)';
  ctx.fill();
  ctx.shadowBlur = 0;
  const cw = bw / cols;
  items.forEach(([label, value], i) => {
    const cx = m + (i % cols) * cw + cw / 2;
    const cy = y + Math.floor(i / cols) * rowH;
    ctx.textAlign = 'center';
    font(ctx, 600, 15 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fillText(label.toUpperCase(), cx, cy + 40 * s);
    font(ctx, 800, 38 * s);
    ctx.fillStyle = '#fff';
    ctx.fillText(value, cx, cy + 84 * s);
    if (i % cols !== 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(m + (i % cols) * cw, cy + 26 * s, 1.5 * s, rowH - 52 * s);
    }
  });
  font(ctx, 800, 40 * s);
  const title = wrap(ctx, scene.title, W - 2 * m - 60 * s, 1)[0];
  const tw = ctx.measureText(title).width + 60 * s;
  const ty = H - m - 110 * s + (1 - a) * 30 * s;
  rr(ctx, (W - tw) / 2, ty, tw, 78 * s, 39 * s);
  ctx.fillStyle = 'rgba(14,19,24,0.8)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, ty + 53 * s);
  ctx.restore();
}

/** End credits: a clean card with the logo and map credits (can be switched off). */
function drawCredits(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, st: FrameState, scene: Scene) {
  const a = st.creditsAlpha;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#f6f6f3';
  ctx.fillRect(0, 0, W, H);
  const grow = 0.85 + 0.15 * G.easeOutBack(G.clamp(a, 0, 1));
  const box = 120 * s * grow;
  font(ctx, 800, 72 * s * grow);
  const word = 'Trailreel';
  const tw = ctx.measureText(word).width;
  const total = box + 26 * s + tw;
  const x = (W - total) / 2;
  const y = H / 2 - box / 2 - 30 * s;
  logoMark(ctx, x, y, box, scene.theme.accent === '#f4f6f8' ? { ...scene.theme, accent: '#111418', onAccent: '#ffffff' } : scene.theme);
  ctx.fillStyle = '#16191d';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, x + box + 26 * s, y + box / 2 + 4 * s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, 600, 22 * s);
  ctx.fillStyle = '#5b6470';
  ctx.fillText('Made with Trailreel', W / 2, y + box + 70 * s);
  font(ctx, 600, 15 * s);
  ctx.fillStyle = '#8a929c';
  const credit = `MAPS: ${trailreelMap.BASEMAPS[scene.settings.basemap].credit.toUpperCase()}  ·  TERRAIN: AWS TERRAIN TILES  ·  LABELS: OPENSTREETMAP`;
  wrap(ctx, credit, W - 80 * s, 2).forEach((l, i) => ctx.fillText(l, W / 2, H - 70 * s + i * 22 * s));
  ctx.restore();
}

function drawAttribution(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, m: number, text: string) {
  ctx.save();
  let px = 12.5 * s;
  font(ctx, 500, px);
  while (ctx.measureText(text).width > W - 2 * m && px > 7) {
    px -= 0.5;
    font(ctx, 500, px);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4 * s;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(text, W - m * 0.6, H - m * 0.35);
  ctx.restore();
}

/** Shareable poster (like Relive's activity poster): drawn over an overview map frame. */
function drawPoster(ctx: CanvasRenderingContext2D, W: number, H: number, scene: Scene) {
  const s = Math.min(W, H) / 1080;
  const m = 44 * s;
  const { track, enrichment, theme } = scene;
  ctx.save();
  const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
  grad.addColorStop(0, 'rgba(10,14,18,0)');
  grad.addColorStop(1, 'rgba(10,14,18,0.88)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
  if (scene.settings.watermark) drawBrand(ctx, W, s, m, theme);

  const items = statItems(scene);
  const cols = W > H * 1.1 ? items.length : 2;
  const colW = (W - 2 * m) / cols;
  const rows = Math.ceil(items.length / cols);
  const statsTop = H - m - rows * 96 * s;
  items.forEach(([label, value], i) => {
    const x = m + (i % cols) * colW;
    const y = statsTop + Math.floor(i / cols) * 96 * s;
    font(ctx, 600, 16 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(label.toUpperCase(), x, y + 22 * s);
    font(ctx, 800, 44 * s);
    ctx.fillStyle = '#fff';
    ctx.fillText(value, x, y + 72 * s);
  });

  const sub: string[] = [F.sportLabel[scene.sport]];
  if (track.stats.startTime != null) sub.push(F.date(track.stats.startTime, enrichment.timeZone));
  if (enrichment.place) sub.push(enrichment.place);
  font(ctx, 600, 24 * s);
  const subLine = wrap(ctx, sub.join('  ·  '), W - 2 * m, 1)[0];
  const subY = statsTop - 34 * s;
  ctx.fillStyle = theme.accent === '#f4f6f8' ? '#ffffff' : theme.accent;
  ctx.fillText(subLine, m, subY);
  font(ctx, 900, 72 * s);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 14 * s;
  const lines = wrap(ctx, scene.title, W - 2 * m, 2);
  lines.forEach((l, i) => ctx.fillText(l, m, subY - 30 * s - (lines.length - 1 - i) * 78 * s));
  ctx.restore();
  drawAttribution(ctx, W, H, s, m * 0.6, scene.attribution);
}

function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, st: FrameState, scene: Scene) {
  const s = Math.min(W, H) / 1080;
  const m = 34 * s;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (st.creditsAlpha < 1) {
    if (st.phase !== 'outro' || st.statsAlpha < 1) {
      ctx.save();
      ctx.globalAlpha = st.phase === 'intro' ? st.hudAlpha : 1;
      drawPhotoPins(ctx, W, H, s, st, scene);
      ctx.restore();
    }
    drawGhosts(ctx, s, st, scene);
    drawAvatar(ctx, s, st, scene);
    if (st.hudAlpha > 0.001) {
      ctx.save();
      ctx.globalAlpha = st.hudAlpha;
      drawHud(ctx, W, s, m, st, scene);
      drawChapterBadge(ctx, s, m, st, scene);
      drawChips(ctx, H, s, m, st, scene);
      ctx.restore();
    }
    if (scene.settings.watermark && st.statsAlpha <= 0.001 && st.titleAlpha < 0.5) drawBrand(ctx, W, s, m, scene.theme);
    if (st.photo) drawPhotoCard(ctx, W, H, s, st, scene);
    if (st.titleAlpha > 0.001) drawIntro(ctx, W, H, s, m, st, scene);
    if (st.statsAlpha > 0.001) drawStats(ctx, W, H, s, m, st, scene);
    drawAttribution(ctx, W, H, s, m, scene.attribution);
  }
  if (st.creditsAlpha > 0.001) drawCredits(ctx, W, H, s, st, scene);
  ctx.restore();
}

export const trailreelOverlay = { draw: drawOverlay, poster: drawPoster, ghostProgress };
