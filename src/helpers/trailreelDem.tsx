/**
 * Fills missing elevations from the free AWS Terrain Tiles (Mapzen "terrarium" encoding):
 *   elevation = (R * 256 + G + B / 256) - 32768
 * Same DEM the 3D map uses, so the profile matches the rendered terrain.
 */
import type { TrackPoint } from './trailreelTypes';

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function project(lon: number, lat: number, z: number) {
  const scale = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * scale;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

async function loadTile(z: number, x: number, y: number): Promise<Float32Array> {
  const url = TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Terrain tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, 256, 256).data;
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Bilinear elevation inside one decoded tile at world pixel (x, y). */
function sampleTile(data: Float32Array, x: number, y: number, tx: number, ty: number): number {
  const fx = Math.min(254.999, Math.max(0, x - tx * 256 - 0.5));
  const fy = Math.min(254.999, Math.max(0, y - ty * 256 - 0.5));
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const ax = fx - ix;
  const ay = fy - iy;
  const v00 = data[iy * 256 + ix];
  const v10 = data[iy * 256 + ix + 1];
  const v01 = data[(iy + 1) * 256 + ix];
  const v11 = data[(iy + 1) * 256 + ix + 1];
  return (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
}

export interface DemSampler {
  /** [[west, south], [east, north]] the loaded tiles were chosen to cover */
  bounds: [[number, number], [number, number]];
  zoom: number;
  /** metres above sea level, or null outside the loaded tiles */
  elevation(lon: number, lat: number): number | null;
}

/**
 * Load the terrain under a bounding box at the highest zoom (≤ maxZoom) that needs at most
 * `maxTiles` tiles. Tiles that fail to load just read as unknown (null).
 */
async function loadSampler(bounds: [[number, number], [number, number]], maxTiles = 36, maxZoom = 12): Promise<DemSampler> {
  const [[west, south], [east, north]] = bounds;
  let z = maxZoom;
  let range = { x0: 0, x1: 0, y0: 0, y1: 0 };
  for (; z >= 4; z--) {
    const a = project(west, Math.min(85, north), z);
    const b = project(east, Math.max(-85, south), z);
    range = { x0: Math.floor(a.x / 256), x1: Math.floor(b.x / 256), y0: Math.floor(a.y / 256), y1: Math.floor(b.y / 256) };
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= maxTiles) break;
  }
  const key = (tx: number, ty: number) => tx * 65536 + ty;
  const queue: [number, number][] = [];
  for (let tx = range.x0; tx <= range.x1; tx++) for (let ty = range.y0; ty <= range.y1; ty++) queue.push([tx, ty]);
  const tiles = new Map<number, Float32Array>();
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const [tx, ty] = queue.pop()!;
        try {
          tiles.set(key(tx, ty), await loadTile(z, tx, ty));
        } catch {
          /* unknown terrain there */
        }
      }
    }),
  );
  if (!tiles.size) throw new Error('Terrain tiles could not be loaded.');
  const zoom = z;
  return {
    bounds,
    zoom,
    elevation(lon, lat) {
      const { x, y } = project(lon, lat, zoom);
      const tx = Math.floor(x / 256);
      const ty = Math.floor(y / 256);
      const data = tiles.get(key(tx, ty));
      return data ? sampleTile(data, x, y, tx, ty) : null;
    },
  };
}

/** Returns true if elevations were filled from the DEM. */
async function fillElevationFromDEM(points: TrackPoint[]): Promise<boolean> {
  const missing = points.filter((p) => p.ele == null || !Number.isFinite(p.ele)).length;
  if (missing < points.length * 0.5) return false;

  // Highest zoom (max 13, ~19 m/px at the equator) that needs at most 48 tiles.
  let z = 13;
  let keys = new Set<string>();
  for (; z >= 6; z--) {
    keys = new Set(
      points.map((p) => {
        const { x, y } = project(p.lon, p.lat, z);
        return `${Math.floor(x / 256)}/${Math.floor(y / 256)}`;
      }),
    );
    if (keys.size <= 48) break;
  }

  const tiles = new Map<string, Float32Array>();
  const queue = [...keys];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const key = queue.pop()!;
        const [tx, ty] = key.split('/').map(Number);
        tiles.set(key, await loadTile(z, tx, ty));
      }
    }),
  );

  for (const p of points) {
    const { x, y } = project(p.lon, p.lat, z);
    const tx = Math.floor(x / 256);
    const ty = Math.floor(y / 256);
    const data = tiles.get(`${tx}/${ty}`);
    if (!data) continue;
    p.ele = sampleTile(data, x, y, tx, ty);
  }
  return true;
}

export const trailreelDem = { TERRARIUM_URL, fillElevationFromDEM, loadSampler };
