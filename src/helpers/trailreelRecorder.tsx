/**
 * Records an activity with the browser's GPS (Geolocation API) while the page stays open.
 * Keeps the screen awake where supported. Phones need the page in the foreground:
 * a web page can't track in the background the way a native app can.
 */
import { trailreelGeo as G } from './trailreelGeo';
import type { Activity, Sport, TrackPoint } from './trailreelTypes';

export interface RecorderStatus {
  points: number;
  distance: number;
  elapsed: number;
  accuracy: number | null;
}

export function trailreelRecorder(onUpdate: (s: RecorderStatus) => void, onError: (message: string) => void) {
  let watchId: number | null = null;
  let wake: { release(): Promise<void> } | null = null;
  let points: TrackPoint[] = [];
  let distance = 0;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastAccuracy: number | null = null;

  const emit = () => onUpdate({ points: points.length, distance, elapsed: startedAt ? (Date.now() - startedAt) / 1000 : 0, accuracy: lastAccuracy });

  async function start() {
    if (!('geolocation' in navigator)) throw new Error('This browser has no GPS access.');
    points = [];
    distance = 0;
    startedAt = Date.now();
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      wake = wl ? await wl.request('screen') : null;
    } catch {
      wake = null; // optional
    }
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, accuracy } = pos.coords;
        lastAccuracy = accuracy;
        if (accuracy > 50) return emit(); // too imprecise to keep
        const p: TrackPoint = { lat: latitude, lon: longitude, ele: altitude ?? null, time: pos.timestamp };
        const prev = points[points.length - 1];
        if (prev) {
          const d = G.haversine(prev.lat, prev.lon, p.lat, p.lon);
          if (d < 3) return emit();
          distance += d;
        }
        points.push(p);
        emit();
      },
      (err) => onError(err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' : `GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    timer = setInterval(emit, 1000);
    emit();
  }

  function stop(sport: Sport): Activity | null {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (timer) clearInterval(timer);
    timer = null;
    void wake?.release().catch(() => undefined);
    wake = null;
    if (points.length < 2) return null;
    const when = new Date(startedAt);
    const label = `${when.getHours() < 12 ? 'Morning' : when.getHours() < 18 ? 'Afternoon' : 'Evening'} ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    return { name: label, sport, source: 'Recorded in browser', points };
  }

  return { start, stop, get recording() {
    return watchId != null;
  } };
}
