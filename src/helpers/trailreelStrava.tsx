/** Browser side of the optional Strava connector (server/strava.ts, local dev/preview server only). */
import type { TrackPoint } from './trailreelTypes';

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete: string | null;
}

export interface StravaActivity {
  id: number;
  name: string;
  sport: string;
  start: string;
  distance: number;
}

async function call<T>(path: string): Promise<T> {
  const r = await fetch(`/api/strava/${path}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Strava request failed (${r.status})`);
  return body as T;
}

export const trailreelStrava = {
  /** Null when the app is served without the connector (static hosting such as Floot). */
  async status(): Promise<StravaStatus | null> {
    try {
      const r = await fetch('/api/strava/status');
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
      return (await r.json()) as StravaStatus;
    } catch {
      return null;
    }
  },
  activities: () => call<StravaActivity[]>('activities'),
  track: (id: number) => call<{ name: string; sport: string; source: string; points: TrackPoint[] }>(`activities/${id}/track`),
  logout: () => call<{ ok: boolean }>('logout'),
};
