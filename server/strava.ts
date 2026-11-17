/**
 * Minimal Strava connector that runs inside the Vite dev/preview server.
 *
 * Strava's OAuth token exchange needs the client secret, so it cannot run in the browser.
 * Tokens are kept in memory for a single local user; this is a local tool, not a multi-user backend.
 *
 * Routes:
 *   GET /api/strava/status               -> { configured, connected, athlete }
 *   GET /api/strava/login                -> redirect to Strava consent screen
 *   GET /api/strava/callback?code=...    -> exchanges code, redirects to /
 *   GET /api/strava/logout
 *   GET /api/strava/activities           -> recent activities that have GPS
 *   GET /api/strava/activities/:id/track -> normalized Activity JSON (same shape the file parsers produce)
 */
import type { Connect, Plugin } from 'vite';
import type { ServerResponse } from 'node:http';

interface Token {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { firstname?: string };
}

interface StravaSummary {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  distance: number;
  map?: { summary_polyline?: string | null };
}

interface StravaStreams {
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  time?: { data: number[] };
  heartrate?: { data: number[] };
}

const API = 'https://www.strava.com/api/v3';

export function stravaPlugin(env: Record<string, string>): Plugin {
  const clientId = env.STRAVA_CLIENT_ID ?? '';
  const clientSecret = env.STRAVA_CLIENT_SECRET ?? '';
  const configured = Boolean(clientId && clientSecret);
  let token: Token | null = null;

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  const redirect = (res: ServerResponse, location: string) => {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end();
  };

  async function exchange(params: Record<string, string>): Promise<Token> {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    if (!r.ok) throw new Error(`Strava token exchange failed (${r.status}): ${await r.text()}`);
    return (await r.json()) as Token;
  }

  async function accessToken(): Promise<string> {
    if (!token) throw new Error('Not connected to Strava');
    if (token.expires_at * 1000 < Date.now() + 60_000) {
      const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
      token = { ...token, ...refreshed };
    }
    return token.access_token;
  }

  async function api<T>(path: string): Promise<T> {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!r.ok) throw new Error(`Strava API ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/strava/')) return next();
    const route = url.pathname.slice('/api/strava/'.length);

    (async () => {
      if (route === 'status') {
        return json(res, 200, { configured, connected: Boolean(token), athlete: token?.athlete?.firstname ?? null });
      }
      if (!configured) {
        return json(res, 503, { error: 'Strava is not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.local' });
      }
      if (route === 'login') {
        const auth = new URL('https://www.strava.com/oauth/authorize');
        auth.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: `${url.origin}/api/strava/callback`,
          response_type: 'code',
          approval_prompt: 'auto',
          scope: 'read,activity:read_all',
        }).toString();
        return redirect(res, auth.toString());
      }
      if (route === 'callback') {
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?strava=denied');
        token = await exchange({ code, grant_type: 'authorization_code' });
        return redirect(res, '/?strava=connected');
      }
      if (route === 'logout') {
        token = null;
        return json(res, 200, { ok: true });
      }
      if (route === 'activities') {
        const list = await api<StravaSummary[]>('/athlete/activities?per_page=50');
        return json(
          res,
          200,
          list
            .filter((a) => a.map?.summary_polyline)
            .map((a) => ({ id: a.id, name: a.name, sport: a.sport_type ?? a.type ?? 'Workout', start: a.start_date, distance: a.distance })),
        );
      }
      const m = /^activities\/(\d+)\/track$/.exec(route);
      if (m) {
        const id = m[1];
        const [act, streams] = await Promise.all([
          api<StravaSummary>(`/activities/${id}`),
          api<StravaStreams>(`/activities/${id}/streams?keys=latlng,altitude,time,heartrate&key_by_type=true`),
        ]);
        const start = Date.parse(act.start_date);
        const latlng = streams.latlng?.data ?? [];
        const points = latlng.map(([lat, lon], i) => ({
          lat,
          lon,
          ele: streams.altitude?.data[i] ?? null,
          time: streams.time ? start + streams.time.data[i] * 1000 : null,
          hr: streams.heartrate?.data[i] ?? null,
        }));
        return json(res, 200, { name: act.name, sport: act.sport_type ?? act.type ?? 'Workout', source: 'Strava', points });
      }
      return json(res, 404, { error: `Unknown route ${route}` });
    })().catch((e: unknown) => json(res, 502, { error: e instanceof Error ? e.message : String(e) }));
  };

  return {
    name: 'trailreel-strava',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
