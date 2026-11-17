/**
 * Dynamic time-of-day & weather lighting engine.
 * Computes solar elevation from GPS position and timestamp to shift MapLibre's sky,
 * horizon, fog, hillshade, and imagery brightness across Sunrise, Day, Golden Hour, and Night.
 */
import { trailreelGeo as G } from './trailreelGeo';
import type { LightingMode, LightingState } from './trailreelTypes';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Default cartographic light (from the north-west) when the time of day is unknown. */
const DEFAULT_AZIMUTH = 335;

/** Approximate solar elevation angle in degrees (-90..+90). */
function solarElevation(lat: number, lon: number, epochMs: number): number {
  return sunPosition(lat, lon, epochMs).elevation;
}

/** Sun elevation (-90..+90) and azimuth (0 = north, clockwise) in degrees. */
function sunPosition(lat: number, lon: number, epochMs: number): { elevation: number; azimuth: number } {
  if (!Number.isFinite(epochMs)) return { elevation: 45, azimuth: DEFAULT_AZIMUTH };
  const d = (epochMs - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86_400_000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * DEG;
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const ha = (((gmst + lon - ra + 540) % 360) - 180) * RAD;
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  // Hour angle is positive in the afternoon (sun to the west); +180 turns "from south" into "from north".
  const azimuth = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * DEG + 540) % 360;
  return { elevation: Math.asin(G.clamp(sinAlt, -1, 1)) * DEG, azimuth };
}

function mixHex(a: string, b: string, t: number): string {
  const k = G.clamp(t, 0, 1);
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(G.lerp((pa >> 16) & 255, (pb >> 16) & 255, k));
  const g = Math.round(G.lerp((pa >> 8) & 255, (pb >> 8) & 255, k));
  const bl = Math.round(G.lerp(pa & 255, pb & 255, k));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

type Palette = Omit<LightingState, 'sunElevationDeg' | 'sunAzimuthDeg'>;

const PALETTES: Record<'night' | 'sunrise' | 'golden' | 'day', Palette> = {
  night: {
    mode: 'night',
    skyColor: '#0b1426',
    horizonColor: '#1d2d4a',
    fogColor: '#131d30',
    hillshadeShadow: 'rgba(2, 6, 16, 0.85)',
    hillshadeHighlight: 'rgba(130, 165, 220, 0.14)',
    hillshadeExag: 0.28,
    brightnessMax: 0.42,
    saturation: -0.25,
    headlampAlpha: 0.95,
  },
  sunrise: {
    mode: 'sunrise',
    skyColor: '#4c75a8',
    horizonColor: '#f6a87b',
    fogColor: '#ebd0bd',
    hillshadeShadow: 'rgba(24, 14, 34, 0.68)',
    hillshadeHighlight: 'rgba(255, 196, 145, 0.28)',
    hillshadeExag: 0.24,
    brightnessMax: 0.86,
    saturation: 0.12,
    headlampAlpha: 0.15,
  },
  golden: {
    mode: 'golden',
    skyColor: '#5c88bd',
    horizonColor: '#f7c178',
    fogColor: '#f2dcc0',
    hillshadeShadow: 'rgba(30, 18, 12, 0.65)',
    hillshadeHighlight: 'rgba(255, 214, 140, 0.28)',
    hillshadeExag: 0.24,
    brightnessMax: 0.92,
    saturation: 0.14,
    headlampAlpha: 0,
  },
  day: {
    mode: 'day',
    skyColor: '#6fa8dc',
    horizonColor: '#dceaf5',
    fogColor: '#e6eef4',
    hillshadeShadow: 'rgba(0, 0, 0, 0.6)',
    hillshadeHighlight: 'rgba(255, 255, 255, 0.12)',
    hillshadeExag: 0.18,
    brightnessMax: 1.0,
    saturation: 0.05,
    headlampAlpha: 0,
  },
};

function blendStates(a: Palette, b: Palette, k: number, sunElev: number, sunAz: number): LightingState {
  return {
    mode: k < 0.5 ? a.mode : b.mode,
    skyColor: mixHex(a.skyColor, b.skyColor, k),
    horizonColor: mixHex(a.horizonColor, b.horizonColor, k),
    fogColor: mixHex(a.fogColor, b.fogColor, k),
    hillshadeShadow: k < 0.5 ? a.hillshadeShadow : b.hillshadeShadow,
    hillshadeHighlight: k < 0.5 ? a.hillshadeHighlight : b.hillshadeHighlight,
    hillshadeExag: G.lerp(a.hillshadeExag, b.hillshadeExag, k),
    brightnessMax: G.lerp(a.brightnessMax, b.brightnessMax, k),
    saturation: G.lerp(a.saturation, b.saturation, k),
    headlampAlpha: G.lerp(a.headlampAlpha, b.headlampAlpha, k),
    sunElevationDeg: sunElev,
    sunAzimuthDeg: sunAz,
  };
}

function lightingAt(mode: LightingMode, lat: number, lon: number, timeMs: number, weatherCode?: number | null): LightingState {
  let state: LightingState;
  const sun = sunPosition(lat, lon, timeMs);
  // Shadows follow the real sun when the activity has timestamps; at night there is no sun to follow.
  const sunAz = sun.elevation > -4 ? sun.azimuth : DEFAULT_AZIMUTH;

  if (mode !== 'auto') {
    const p = PALETTES[mode];
    const sunElev = mode === 'night' ? -12 : mode === 'sunrise' ? 4 : mode === 'golden' ? 11 : 45;
    // A chosen look keeps the real sun direction when it is daytime; otherwise light from the side the look implies.
    const fallbackAz = mode === 'sunrise' ? 95 : mode === 'golden' ? 255 : DEFAULT_AZIMUTH;
    state = { ...p, sunElevationDeg: sunElev, sunAzimuthDeg: Number.isFinite(timeMs) && sun.elevation > 0 ? sun.azimuth : fallbackAz };
  } else {
    const sunElev = sun.elevation;
    // Determine morning vs afternoon subtly via UTC + lon solar local hour
    const localHour = Number.isFinite(timeMs) ? ((timeMs / 3_600_000 + lon / 15) % 24 + 24) % 24 : 12;
    const lowSun = localHour < 12 ? PALETTES.sunrise : PALETTES.golden;

    if (sunElev <= -4) {
      state = { ...PALETTES.night, sunElevationDeg: sunElev, sunAzimuthDeg: sunAz };
    } else if (sunElev < 5) {
      state = blendStates(PALETTES.night, lowSun, (sunElev + 4) / 9, sunElev, sunAz);
    } else if (sunElev < 18) {
      state = blendStates(lowSun, PALETTES.day, (sunElev - 5) / 13, sunElev, sunAz);
    } else {
      state = { ...PALETTES.day, sunElevationDeg: sunElev, sunAzimuthDeg: sunAz };
    }
  }

  // Subtle overcast / rain / fog atmospheric shift when weather is known
  if (weatherCode != null && weatherCode >= 3) {
    const foggy = weatherCode >= 45 && weatherCode <= 48;
    const rainy = weatherCode >= 51;
    if (foggy || rainy) {
      state = {
        ...state,
        skyColor: mixHex(state.skyColor, '#8294a6', foggy ? 0.55 : 0.35),
        horizonColor: mixHex(state.horizonColor, '#bcc8d4', foggy ? 0.65 : 0.4),
        fogColor: mixHex(state.fogColor, '#c8d2dc', foggy ? 0.7 : 0.45),
        saturation: state.saturation - 0.12,
      };
    }
  }

  return state;
}

export const trailreelLighting = { solarElevation, sunPosition, lightingAt };
