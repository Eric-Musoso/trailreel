/**
 * Optional enrichment from free, key-less APIs. Every call is best-effort:
 * a failure leaves the field empty and never blocks rendering.
 *
 * Privacy: only a coarse start point leaves the device (2 decimals ≈ 1 km), which is all a
 * town name and the day's weather need. The start of a route is often someone's home.
 */
import type { Enrichment, Weather } from './trailreelTypes';

const coarse = (deg: number) => deg.toFixed(2);

async function getJSON<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** OpenStreetMap Nominatim reverse geocoding (max 1 request/second, attribution required). */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  type R = { address?: Record<string, string> };
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${coarse(lat)}&lon=${coarse(lon)}`;
  const r = await getJSON<R>(url);
  const a = r.address ?? {};
  const local = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state;
  return [local, a.country].filter(Boolean).join(', ') || null;
}

/** Open-Meteo weather at the activity start (archive for older dates, forecast API for recent days). */
async function weatherAt(lat: number, lon: number, time: number): Promise<{ weather: Weather; timeZone: string } | null> {
  const day = new Date(time).toISOString().slice(0, 10);
  const ageDays = (Date.now() - time) / 86_400_000;
  if (ageDays < -1) return null;
  const base = ageDays > 6 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${coarse(lat)}&longitude=${coarse(lon)}&start_date=${day}&end_date=${day}&hourly=temperature_2m,weather_code&timezone=auto&timeformat=unixtime`;
  type R = { timezone: string; hourly: { time: number[]; temperature_2m: (number | null)[]; weather_code: (number | null)[] } };
  const r = await getJSON<R>(url);
  const ts = r.hourly?.time ?? [];
  if (!ts.length) return null;
  let best = 0;
  for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i] * 1000 - time) < Math.abs(ts[best] * 1000 - time)) best = i;
  const tempC = r.hourly.temperature_2m[best];
  const code = r.hourly.weather_code[best];
  if (tempC == null || code == null) return null;
  return { weather: { tempC, code }, timeZone: r.timezone };
}

async function enrich(lat: number, lon: number, startTime: number | null): Promise<Enrichment> {
  const [place, wx] = await Promise.allSettled([reverseGeocode(lat, lon), startTime != null ? weatherAt(lat, lon, startTime) : Promise.resolve(null)]);
  const w = wx.status === 'fulfilled' ? wx.value : null;
  return {
    place: place.status === 'fulfilled' ? place.value : null,
    weather: w?.weather ?? null,
    timeZone: w?.timeZone ?? null,
  };
}

/** WMO weather interpretation codes to a short label. */
function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

export const trailreelEnrich = { enrich, weatherLabel };
