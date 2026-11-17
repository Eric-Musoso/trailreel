import type { Sport, Units } from './trailreelTypes';

const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const isFoot = (sport: Sport) => sport === 'run' || sport === 'walk' || sport === 'hike';

export const trailreelFormat = {
  distance(m: number, units: Units): string {
    if (units === 'imperial') {
      const mi = m / 1609.344;
      return `${nf(mi < 10 ? 2 : 1).format(mi)} mi`;
    }
    const km = m / 1000;
    return km < 1 ? `${Math.round(m)} m` : `${nf(km < 10 ? 2 : 1).format(km)} km`;
  },
  elevation(m: number, units: Units): string {
    return units === 'imperial' ? `${nf(0).format(m * 3.28084)} ft` : `${nf(0).format(m)} m`;
  },
  duration(sec: number): string {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  },
  /** h:mm:ss or m:ss, for elapsed time readouts. */
  elapsed(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  },
  /** Pace for foot sports, speed for everything else. */
  speed(mps: number, units: Units, sport: Sport): { label: string; value: string } {
    if (isFoot(sport)) {
      const perUnit = units === 'imperial' ? 1609.344 : 1000;
      const secs = perUnit / Math.max(mps, 0.01);
      if (secs > 99 * 60) return { label: 'Avg pace', value: '–' };
      return { label: 'Avg pace', value: `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')} /${units === 'imperial' ? 'mi' : 'km'}` };
    }
    return units === 'imperial'
      ? { label: 'Avg speed', value: `${nf(1).format(mps * 2.236936)} mph` }
      : { label: 'Avg speed', value: `${nf(1).format(mps * 3.6)} km/h` };
  },
  grade(pct: number): string {
    if (!Number.isFinite(pct)) return '–';
    return `${pct > 0.5 ? '+' : ''}${nf(0).format(Math.abs(pct) < 0.5 ? 0 : pct)}%`;
  },
  clock(ms: number, timeZone: string | null): string {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timeZone ?? undefined }).format(ms);
  },
  date(ms: number, timeZone: string | null): string {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: timeZone ?? undefined }).format(ms);
  },
  shortDate(ms: number): string {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
  },
  temp(c: number, units: Units): string {
    return units === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`;
  },
  videoTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  sportLabel: { ride: 'Ride', run: 'Run', hike: 'Hike', walk: 'Walk', ski: 'Ski', water: 'Water', other: 'Adventure' } as Record<Sport, string>,
};
