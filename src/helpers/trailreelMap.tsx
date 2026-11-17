import { Map as MLMap, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { trailreelDem } from './trailreelDem';
import type { BasemapId, LightingState, Theme, Units } from './trailreelTypes';

// MapLibre loads its worker from unpkg (same version as the installed package). Floot can't serve
// web workers from project code, and MapLibre fetches a cross-origin worker into a blob URL.
setWorkerUrl('https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl-worker.mjs');

const TRANSPARENT = 'rgba(0,0,0,0)';

interface Basemap {
  label: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
  credit: string;
}

/** Free raster basemaps. All send CORS headers, which video export needs (an untainted WebGL canvas). */
const BASEMAPS: Record<BasemapId, Basemap> = {
  esri: {
    label: 'Satellite · Esri World Imagery',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 18,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    credit: 'Esri World Imagery',
  },
  eox: {
    label: 'Satellite · Sentinel-2 cloudless (non-commercial)',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
    maxzoom: 15,
    attribution: 'Sentinel-2 cloudless 2020 © EOX (Copernicus data)',
    credit: 'EOX Sentinel-2 cloudless',
  },
  topo: {
    label: 'Topographic · OpenTopoMap',
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    maxzoom: 17,
    attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors',
    credit: 'OpenTopoMap',
  },
};

function attributionText(basemap: BasemapId): string {
  return `${BASEMAPS[basemap].attribution} · Terrain: Mapzen / AWS Terrain Tiles · © OpenMapTiles © OpenStreetMap contributors`;
}

type Expr = ExpressionSpecification;

/**
 * Draw the route only up to `progress` using a step gradient on line-progress. `gaps` are
 * stretches that were not travelled (the jump between stitched days); they stay hidden.
 */
function progressGradient(progress: number, color: string, gaps: [number, number][] = []): Expr {
  if (progress <= 0.0001) return ['interpolate', ['linear'], ['line-progress'], 0, TRANSPARENT, 1, TRANSPARENT];
  const end = progress >= 0.9999 ? Infinity : progress;
  const stops: (number | string)[] = [];
  const push = (at: number, c: string) => {
    if (at <= 0 || at >= 1) return;
    if (stops.length && (stops[stops.length - 2] as number) >= at) stops[stops.length - 1] = c;
    else stops.push(at, c);
  };
  let hiddenToEnd = false;
  for (const [a, b] of gaps) {
    if (a >= end) break;
    push(a, TRANSPARENT);
    if (b >= end) {
      hiddenToEnd = true; // the drawn part ends inside this gap
      break;
    }
    push(b, color);
  }
  if (end < 1 && !hiddenToEnd) push(end, TRANSPARENT);
  if (!stops.length) return ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color];
  return ['step', ['line-progress'], color, ...stops] as unknown as Expr;
}

/** A colour ramp along the route (explore mode) with the untravelled gaps cut out. */
function rampGradient(stops: [number, string][], gaps: [number, number][] = []): Expr {
  const eps = 1e-4;
  const inGap = (f: number) => gaps.some(([a, b]) => f > a - eps && f < b + eps);
  const colorNear = (f: number) => {
    let best = stops[0];
    for (const s of stops) if (Math.abs(s[0] - f) < Math.abs(best[0] - f)) best = s;
    return best[1];
  };
  const all: [number, string][] = stops.filter(([f]) => !inGap(f));
  for (const [a, b] of gaps) {
    if (a - eps > 0) all.push([a - eps, colorNear(a)]);
    all.push([a, TRANSPARENT], [b, TRANSPARENT]);
    if (b + eps < 1) all.push([b + eps, colorNear(b)]);
  }
  all.sort((x, y) => x[0] - y[0]);
  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  let last = -Infinity;
  for (const [f, c] of all) {
    if (f <= last) continue;
    expr.push(f, c);
    last = f;
  }
  return expr as Expr;
}

function peakLabel(units: Units): Expr {
  const ele: Expr =
    units === 'imperial'
      ? ['case', ['has', 'ele_ft'], ['concat', ['to-string', ['get', 'ele_ft']], ' ft'], '']
      : ['case', ['has', 'ele'], ['concat', ['to-string', ['get', 'ele']], ' m'], ''];
  return ['format', ['coalesce', ['get', 'name:en'], ['get', 'name']], { 'font-scale': 1 }, '\n', {}, ele, { 'font-scale': 0.78 }];
}

function buildStyle(basemap: BasemapId, exaggeration: number, units: Units): StyleSpecification {
  const b = BASEMAPS[basemap];
  const dem = trailreelDem.TERRARIUM_URL;
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom },
      dem: { type: 'raster-dem', tiles: [dem], encoding: 'terrarium', tileSize: 256, maxzoom: 14 },
      hillshadeDem: { type: 'raster-dem', tiles: [dem], encoding: 'terrarium', tileSize: 256, maxzoom: 14 },
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#202a2f' } },
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 0, 'raster-contrast': 0.05, 'raster-saturation': 0.05 } },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillshadeDem',
        paint: { 'hillshade-exaggeration': 0.18, 'hillshade-shadow-color': 'rgba(0,0,0,0.6)', 'hillshade-highlight-color': 'rgba(255,255,255,0.12)' },
      },
      {
        id: 'route-shadow',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 14], 'line-blur': 6, 'line-gradient': progressGradient(0, 'rgba(0,0,0,0.45)') },
      },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9], 'line-gradient': progressGradient(0, '#ffffff') },
      },
      {
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6], 'line-gradient': progressGradient(0, '#ff6a1f') },
      },
      {
        id: 'places',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['match', ['get', 'class'], 'city', 17, 'town', 15, 13],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.55)', 'text-halo-width': 1.4 },
      },
      {
        id: 'peaks',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'mountain_peak',
        minzoom: 10.5,
        // rank = per-tile importance in the OpenMapTiles schema (1 = most prominent).
        filter: ['all', ['has', 'name'], ['in', ['get', 'class'], ['literal', ['peak', 'volcano']]], ['<=', ['coalesce', ['get', 'rank'], 99], 4]],
        layout: {
          'text-field': peakLabel(units),
          'text-font': ['Noto Sans Bold'],
          'text-size': 14,
          'text-padding': 18,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.3],
          'text-max-width': 9,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]],
        },
        paint: { 'text-color': '#1c1c1e', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 2.2 },
      },
    ],
    terrain: { source: 'dem', exaggeration },
    sky: {
      'sky-color': '#6fa8dc',
      'horizon-color': '#dceaf5',
      'fog-color': '#e6eef4',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.88,
      'atmosphere-blend': 0,
    },
  };
}

function createMap(container: HTMLElement, basemap: BasemapId, exaggeration: number, units: Units): Promise<MLMap> {
  const map = new MLMap({
    container,
    style: buildStyle(basemap, exaggeration, units),
    center: [8.03, 46.67],
    zoom: 11,
    pitch: 0,
    maxPitch: 80,
    attributionControl: false, // attribution is drawn into the overlay so it is also burned into exported videos
    fadeDuration: 0, // deterministic label placement for frame-by-frame export
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    pixelRatio: window.devicePixelRatio,
  });
  return new Promise((resolve, reject) => {
    map.once('load', () => resolve(map));
    map.once('error', (e) => {
      if (!map.loaded()) reject((e as unknown as { error?: Error }).error ?? new Error('Map failed to load'));
    });
  });
}

function setBasemap(map: MLMap, basemap: BasemapId) {
  const b = BASEMAPS[basemap];
  map.removeLayer('basemap');
  map.removeSource('basemap');
  map.addSource('basemap', { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom });
  map.addLayer(
    { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 0, 'raster-contrast': 0.05, 'raster-saturation': 0.05 } },
    'hillshade',
  );
}

function setUnits(map: MLMap, units: Units) {
  map.setLayoutProperty('peaks', 'text-field', peakLabel(units));
}

function applyLighting(map: MLMap, lighting: LightingState) {
  map.setSky({
    'sky-color': lighting.skyColor,
    'horizon-color': lighting.horizonColor,
    'fog-color': lighting.fogColor,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.88,
    'atmosphere-blend': 0,
  });
  // Light comes from where the sun actually is, fixed to the ground (not the screen) so shadows don't swing with the camera.
  map.setPaintProperty('hillshade', 'hillshade-illumination-anchor', 'map');
  map.setPaintProperty('hillshade', 'hillshade-illumination-direction', Math.round(lighting.sunAzimuthDeg));
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', lighting.hillshadeExag);
  map.setPaintProperty('hillshade', 'hillshade-shadow-color', lighting.hillshadeShadow);
  map.setPaintProperty('hillshade', 'hillshade-highlight-color', lighting.hillshadeHighlight);
  map.setPaintProperty('basemap', 'raster-brightness-max', lighting.brightnessMax);
  map.setPaintProperty('basemap', 'raster-saturation', lighting.saturation);
}

const GHOST_SLOTS = 4;

function ensureGhostSlots(map: MLMap) {
  for (let i = 0; i < GHOST_SLOTS; i++) {
    const srcId = `ghost-src-${i}`;
    const layerId = `ghost-line-${i}`;
    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: 'line',
          source: srcId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 4.5],
            'line-opacity': 0.85,
            'line-gradient': progressGradient(0, '#38bdf8'),
          },
        },
        'route-shadow',
      );
    }
  }
}

function setGhostData(map: MLMap, index: number, geojson: unknown) {
  ensureGhostSlots(map);
  if (index < 0 || index >= GHOST_SLOTS) return;
  const src = map.getSource(`ghost-src-${index}`) as GeoJSONSource | undefined;
  if (src) src.setData(geojson as Parameters<GeoJSONSource['setData']>[0]);
}

function clearGhostSlots(map: MLMap) {
  for (let i = 0; i < GHOST_SLOTS; i++) {
    const src = map.getSource(`ghost-src-${i}`) as GeoJSONSource | undefined;
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }
}

function setGhostProgress(map: MLMap, index: number, progress: number, color: string) {
  if (index < 0 || index >= GHOST_SLOTS) return;
  if (!map.getLayer(`ghost-line-${index}`)) return;
  map.setPaintProperty(`ghost-line-${index}`, 'line-gradient', progressGradient(progress, color));
}

/** Video mode: the route is drawn in the theme colour up to `progress`, untravelled gaps hidden. */
function setRouteProgress(map: MLMap, progress: number, theme: Theme, gaps: [number, number][] = []) {
  map.setPaintProperty('route-shadow', 'line-gradient', progressGradient(progress, 'rgba(0,0,0,0.45)', gaps));
  map.setPaintProperty('route-casing', 'line-gradient', progressGradient(progress, theme.casing, gaps));
  map.setPaintProperty('route-line', 'line-gradient', progressGradient(progress, theme.route, gaps));
}

/** Explore mode: the whole route with a caller-built colour ramp along line-progress. */
function setRouteGradient(map: MLMap, lineGradient: Expr, casing: string, gaps: [number, number][] = []) {
  map.setPaintProperty('route-shadow', 'line-gradient', progressGradient(1, 'rgba(0,0,0,0.45)', gaps));
  map.setPaintProperty('route-casing', 'line-gradient', progressGradient(1, casing, gaps));
  map.setPaintProperty('route-line', 'line-gradient', lineGradient);
}

/** Resolve after the map has rendered a frame with every needed tile loaded (or after a timeout). */
function waitForIdle(map: MLMap, timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('idle', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    map.on('idle', finish);
    map.triggerRepaint();
  });
}

export const trailreelMap = {
  BASEMAPS,
  attributionText,
  createMap,
  setBasemap,
  setUnits,
  applyLighting,
  setGhostData,
  clearGhostSlots,
  setGhostProgress,
  setRouteProgress,
  setRouteGradient,
  progressGradient,
  rampGradient,
  waitForIdle,
};
