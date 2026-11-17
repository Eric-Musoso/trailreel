import { gpx, tcx } from '@tmcw/togeojson';
import { Decoder, Stream } from '@garmin/fitsdk';
import type { Activity, Sport, TrackPoint } from './trailreelTypes';

function normalizeSport(raw: string | null | undefined): Sport {
  const s = (raw ?? '').toLowerCase();
  if (/bik|cycl|ride|mtb|gravel/.test(s)) return 'ride';
  if (/run|jog/.test(s)) return 'run';
  if (/hik|trek|mountaineer|climb/.test(s)) return 'hike';
  if (/walk/.test(s)) return 'walk';
  if (/ski|snowboard|snowshoe/.test(s)) return 'ski';
  if (/swim|kayak|canoe|row|paddle|sup|sail|surf/.test(s)) return 'water';
  return 'other';
}

function fileBaseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'My activity';
}

type Coords = number[][];
type CoordProps = { times?: string[] | string[][]; heart?: number[] | number[][]; heartRates?: number[] | number[][] };
type FeatureLike = { geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> | null };

function fromGeoJSON(fc: { features: FeatureLike[] }, fallbackName: string, source: string): Activity {
  const points: TrackPoint[] = [];
  let name: string | null = null;
  let type: string | null = null;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) continue;
    const props = f.properties ?? {};
    name ??= typeof props.name === 'string' ? props.name : null;
    type ??= typeof props.type === 'string' ? props.type : typeof props.sport === 'string' ? props.sport : null;
    const cp = (props.coordinateProperties ?? {}) as CoordProps;
    const multi = g.type === 'MultiLineString';
    const lines: Coords[] = multi ? (g.coordinates as Coords[]) : [g.coordinates as Coords];
    lines.forEach((line, li) => {
      const times = (multi ? (cp.times as string[][] | undefined)?.[li] : (cp.times as string[] | undefined)) ?? [];
      const hrSrc = cp.heart ?? cp.heartRates;
      const hrs = (multi ? (hrSrc as number[][] | undefined)?.[li] : (hrSrc as number[] | undefined)) ?? [];
      line.forEach((c, i) => {
        const t = times[i] ? Date.parse(times[i]) : NaN;
        points.push({
          lon: c[0],
          lat: c[1],
          ele: c.length > 2 && Number.isFinite(c[2]) ? c[2] : null,
          time: Number.isFinite(t) ? t : null,
          hr: hrs[i] ?? null,
        });
      });
    });
  }
  if (points.length < 2) throw new Error('No track found in the file. It needs a GPX track or route, or TCX trackpoints with positions.');
  return { name: name || fallbackName, sport: normalizeSport(type), source, points };
}

function parseFit(buffer: ArrayBuffer, fallbackName: string): Activity {
  const stream = Stream.fromArrayBuffer(buffer);
  if (!Decoder.isFIT(stream)) throw new Error('Not a valid FIT file.');
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandComponents: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  });
  const records = (messages.recordMesgs ?? []) as unknown as Record<string, unknown>[];
  const SEMI = 180 / 2 ** 31;
  const points: TrackPoint[] = [];
  for (const r of records) {
    const la = r.positionLat as number | undefined;
    const lo = r.positionLong as number | undefined;
    if (la == null || lo == null) continue;
    const ts = r.timestamp instanceof Date ? r.timestamp.getTime() : null;
    const ele = (r.enhancedAltitude ?? r.altitude) as number | undefined;
    points.push({ lat: la * SEMI, lon: lo * SEMI, ele: ele ?? null, time: ts, hr: (r.heartRate as number | undefined) ?? null });
  }
  if (points.length < 2) {
    throw new Error(errors.length ? `FIT decode error: ${errors[0].message}` : 'The FIT file has no GPS records (indoor activity?).');
  }
  const session = (messages.sessionMesgs?.[0] ?? {}) as unknown as Record<string, unknown>;
  return { name: fallbackName, sport: normalizeSport(String(session.sport ?? '')), source: 'FIT file', points };
}

async function parseActivityFile(file: File): Promise<Activity> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const fallback = fileBaseName(file.name);
  if (ext === 'fit') return parseFit(await file.arrayBuffer(), fallback);
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The file is not valid XML.');
  if (ext === 'tcx' || doc.documentElement.nodeName.toLowerCase().includes('trainingcenterdatabase')) {
    const act = fromGeoJSON(tcx(doc) as unknown as { features: FeatureLike[] }, fallback, 'TCX file');
    const sport = doc.querySelector('Activity')?.getAttribute('Sport');
    if (sport) act.sport = normalizeSport(sport);
    return act;
  }
  return fromGeoJSON(gpx(doc) as unknown as { features: FeatureLike[] }, fallback, 'GPX file');
}

/** Activity JSON produced by the local Strava connector. */
function activityFromJSON(data: { name: string; sport: string; source: string; points: TrackPoint[] }): Activity {
  return { name: data.name, sport: normalizeSport(data.sport), source: data.source, points: data.points };
}

export const trailreelParse = { normalizeSport, parseActivityFile, activityFromJSON };
