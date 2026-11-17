import exifr from 'exifr';
import { trailreelGeo as G } from './trailreelGeo';
import type { Photo, PhotoCropAspect, Track } from './trailreelTypes';

interface Exif {
  latitude?: number;
  longitude?: number;
  DateTimeOriginal?: Date;
  OffsetTimeOriginal?: string;
}

function exifTime(meta: Exif | null): number | null {
  const d = meta?.DateTimeOriginal;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const off = meta?.OffsetTimeOriginal ? /^([+-])(\d{2}):?(\d{2})$/.exec(meta.OffsetTimeOriginal) : null;
  if (!off) return d.getTime(); // naive timestamp: assume the browser's time zone
  const minutes = (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]));
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - minutes * 60_000;
}

/** HEIC/HEIF (the iPhone camera default): by MIME type, extension, or the ISO-BMFF brand in the file header. */
async function isHeic(file: File): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const box = String.fromCharCode(...head.slice(4, 8));
    const brand = String.fromCharCode(...head.slice(8, 12));
    return box === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
  } catch {
    return false;
  }
}

/**
 * Turn a HEIC photo into a JPEG the canvas can draw. The decoder (libheif compiled to
 * WebAssembly, ~3 MB, LGPL) is loaded only the first time a HEIC photo needs it.
 */
async function heicToJpeg(file: File): Promise<Blob> {
  const { heicTo } = await import('heic-to/csp');
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
}

async function decode(file: Blob): Promise<ImageBitmap> {
  const full = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = 1600;
  if (Math.max(full.width, full.height) <= max) return full;
  const scale = max / Math.max(full.width, full.height);
  const small = await createImageBitmap(full, {
    resizeWidth: Math.round(full.width * scale),
    resizeHeight: Math.round(full.height * scale),
    resizeQuality: 'high',
  });
  full.close();
  return small;
}

async function loadPhoto(file: File): Promise<Photo> {
  let bitmap: ImageBitmap;
  // What the thumbnail shows: the file itself, or its JPEG when the browser can't show HEIC.
  let display: Blob = file;
  try {
    // Safari decodes HEIC natively; everything else goes through the converter below.
    bitmap = await decode(file);
  } catch {
    if (!(await isHeic(file))) throw new Error(`${file.name}: this browser can't decode that image. Try JPEG, PNG, WebP or HEIC.`);
    try {
      display = await heicToJpeg(file);
      bitmap = await decode(display);
    } catch {
      throw new Error(`${file.name}: this HEIC photo couldn't be converted. Export it from Photos as JPEG and add it again.`);
    }
  }
  // exifr reads GPS and capture time from JPEG and HEIC alike (from the original file, before conversion).
  // It adds decimal `latitude`/`longitude` to the output when the GPS block is parsed.
  const meta = (await exifr
    .parse(file, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false })
    .catch(() => null)) as Exif | null;
  return {
    id: crypto.randomUUID(),
    name: file.name,
    bitmap,
    thumbUrl: URL.createObjectURL(display),
    lat: Number.isFinite(meta?.latitude) ? meta!.latitude! : null,
    lon: Number.isFinite(meta?.longitude) ? meta!.longitude! : null,
    time: exifTime(meta),
    at: 0.5,
    placedBy: 'spread',
    rotation: 0,
    crop: { aspect: 'free', zoom: 1, panX: 0, panY: 0 },
    caption: '',
    duration: null,
  };
}

/** Place each photo on the route: preserve manual positions; else GPS within 1.5 km, else capture time, else spread evenly. */
function placePhotos(photos: Photo[], track: Track): Photo[] {
  const t0 = track.time[0];
  const t1 = track.time[track.n - 1];
  for (const p of photos) {
    if (p.placedBy === 'manual') continue;
    p.placedBy = 'spread';
    if (p.lat != null && p.lon != null) {
      let best = Infinity;
      let bi = 0;
      for (let i = 0; i < track.n; i += 2) {
        const d = G.haversine(p.lat, p.lon, track.lat[i], track.lon[i]);
        if (d < best) {
          best = d;
          bi = i;
        }
      }
      if (best < 1500) {
        p.at = bi / (track.n - 1);
        p.placedBy = 'gps';
        continue;
      }
    }
    if (p.time != null && track.hasTime && p.time >= t0 - 600_000 && p.time <= t1 + 600_000) {
      let lo = 0;
      let hi = track.n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (track.time[mid] < p.time) lo = mid;
        else hi = mid;
      }
      p.at = lo / (track.n - 1);
      p.placedBy = 'time';
    }
  }
  const spread = photos.filter((p) => p.placedBy === 'spread');
  spread.forEach((p, i) => (p.at = 0.15 + (0.7 * (i + 1)) / (spread.length + 1)));
  for (const p of photos) p.at = Math.min(0.97, Math.max(0.03, p.at));
  return photos.sort((a, b) => a.at - b.at);
}

const ASPECT_RATIO: Record<PhotoCropAspect, number | null> = {
  free: null,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '3:4': 3 / 4,
};

/** Compute effective display dimensions (after rotation + crop aspect) fitting inside maxW x maxH. */
function editedDimensions(photo: Photo, maxW: number, maxH: number): { w: number; h: number } {
  const rotated = photo.rotation === 90 || photo.rotation === 270;
  const rawW = rotated ? photo.bitmap.height : photo.bitmap.width;
  const rawH = rotated ? photo.bitmap.width : photo.bitmap.height;
  const ratio = ASPECT_RATIO[photo.crop.aspect] ?? rawW / Math.max(1, rawH);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

/** How far (in destination pixels) the photo can slide inside a w × h crop: pan ±1 maps to ±these. */
function panRange(photo: Photo, w: number, h: number): { x: number; y: number; scale: number } {
  const rotated = photo.rotation === 90 || photo.rotation === 270;
  const rotW = rotated ? photo.bitmap.height : photo.bitmap.width;
  const rotH = rotated ? photo.bitmap.width : photo.bitmap.height;
  const scale = Math.max(w / rotW, h / rotH) * Math.max(1, photo.crop.zoom);
  return { x: Math.max(0, (rotW * scale - w) / 2), y: Math.max(0, (rotH * scale - h) / 2), scale };
}

/**
 * Draw a photo with its rotation, crop aspect, zoom, and pan into destination rect [x, y, w, h].
 * Caller is responsible for clipping to [x, y, w, h] if desired.
 */
function drawEditedPhoto(ctx: CanvasRenderingContext2D, photo: Photo, x: number, y: number, w: number, h: number) {
  const { x: maxPanX, y: maxPanY, scale: coverScale } = panRange(photo, w, h);
  const drawW = photo.bitmap.width * coverScale;
  const drawH = photo.bitmap.height * coverScale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w / 2 + photo.crop.panX * maxPanX, y + h / 2 + photo.crop.panY * maxPanY);
  ctx.rotate((photo.rotation * Math.PI) / 180);
  ctx.drawImage(photo.bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/** Render an edited photo to a compact JPEG data URL (for Interactive Web Story export). */
function toDataUrl(photo: Photo, maxDim = 960): string {
  const { w, h } = editedDimensions(photo, maxDim, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d')!;
  drawEditedPhoto(ctx, photo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export const trailreelPhotos = { loadPhoto, placePhotos, editedDimensions, drawEditedPhoto, panRange, toDataUrl, isHeic };
