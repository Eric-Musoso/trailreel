/**
 * Local activity library in IndexedDB (stays in this browser; nothing is uploaded).
 * Two stores: small summaries for the list, full point arrays loaded on demand.
 */
import type { Activity, LibraryEntry, Stats } from './trailreelTypes';

const DB_NAME = 'trailreel';
const SUMMARIES = 'summaries';
const TRACKS = 'tracks';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no local storage for activities.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the activity library.'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Library write was aborted.'));
  });
}

/** Same file imported twice gets the same id, so it is stored once. */
function idFor(act: Activity): string {
  const p = act.points[0];
  return `a${act.points.length}-${Math.round(p.lat * 1e5)}-${Math.round(p.lon * 1e5)}-${p.time ?? 0}`;
}

async function save(act: Activity, stats: Stats): Promise<LibraryEntry> {
  const db = await open();
  const entry: LibraryEntry = {
    id: idFor(act),
    name: act.name,
    sport: act.sport,
    source: act.source,
    startTime: stats.startTime,
    distance: stats.distance,
    elevGain: stats.elevGain,
    savedAt: Date.now(),
    lat: act.points[0].lat,
    lon: act.points[0].lon,
  };
  const tx = db.transaction([SUMMARIES, TRACKS], 'readwrite');
  tx.objectStore(SUMMARIES).put(entry);
  tx.objectStore(TRACKS).put({ id: entry.id, activity: act });
  await done(tx);
  db.close();
  return entry;
}

async function list(): Promise<LibraryEntry[]> {
  const db = await open();
  const tx = db.transaction(SUMMARIES, 'readonly');
  const req = tx.objectStore(SUMMARIES).getAll();
  const rows = await new Promise<LibraryEntry[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as LibraryEntry[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a, b) => (b.startTime ?? b.savedAt) - (a.startTime ?? a.savedAt));
}

async function get(id: string): Promise<Activity | null> {
  const db = await open();
  const tx = db.transaction(TRACKS, 'readonly');
  const req = tx.objectStore(TRACKS).get(id);
  const row = await new Promise<{ activity: Activity } | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as { activity: Activity } | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return row?.activity ?? null;
}

async function rename(id: string, name: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([SUMMARIES, TRACKS], 'readwrite');
  const s = tx.objectStore(SUMMARIES);
  const t = tx.objectStore(TRACKS);
  const sr = s.get(id);
  sr.onsuccess = () => sr.result && s.put({ ...sr.result, name });
  const tr = t.get(id);
  tr.onsuccess = () => tr.result && t.put({ ...tr.result, activity: { ...tr.result.activity, name } });
  await done(tx);
  db.close();
}

async function remove(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([SUMMARIES, TRACKS], 'readwrite');
  tx.objectStore(SUMMARIES).delete(id);
  tx.objectStore(TRACKS).delete(id);
  await done(tx);
  db.close();
}

export const trailreelLibrary = { save, list, get, rename, remove, idFor };
