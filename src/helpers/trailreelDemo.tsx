/**
 * A synthetic ~8 km hiking loop above Grindelwald (CH), generated in the browser:
 * approximate waypoints (First, Bachalpsee, Faulhorn, ridge, back) smoothed with a
 * Catmull-Rom spline, with deterministic GPS wiggle and timestamps. No elevation on
 * purpose: the app fills it from the free terrain tiles, the same path real files take.
 */
import { trailreelGeo as G } from './trailreelGeo';
import type { Activity, TrackPoint } from './trailreelTypes';

const WAYPOINTS: [number, number][] = [
  [46.6597, 8.0542], [46.6622, 8.0478], [46.6655, 8.0398], [46.668, 8.032], [46.6694, 8.0236],
  [46.6712, 8.0196], [46.6738, 8.0162], [46.6763, 8.0139], [46.679, 8.019], [46.6815, 8.0255],
  [46.679, 8.033], [46.6745, 8.04], [46.67, 8.047], [46.665, 8.053], [46.6604, 8.0546],
];

function catmull(p0: number[], p1: number[], p2: number[], p3: number[], t: number): [number, number] {
  const f = (k: number) =>
    0.5 *
    (2 * p1[k] +
      (-p0[k] + p2[k]) * t +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
  return [f(0), f(1)];
}

export function trailreelDemo(): Activity {
  const dense: [number, number][] = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const p0 = WAYPOINTS[Math.max(0, i - 1)];
    const p1 = WAYPOINTS[i];
    const p2 = WAYPOINTS[i + 1];
    const p3 = WAYPOINTS[Math.min(WAYPOINTS.length - 1, i + 2)];
    for (let s = 0; s < 40; s++) dense.push(catmull(p0, p1, p2, p3, s / 40));
  }
  dense.push(WAYPOINTS[WAYPOINTS.length - 1]);

  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;

  let time = Date.parse('2025-07-19T07:10:00Z');
  const points: TrackPoint[] = [];
  let prev = dense[0];
  for (let i = 0; i < dense.length; i++) {
    const p: [number, number] = [dense[i][0] + rnd() * 0.00004, dense[i][1] + rnd() * 0.00004];
    const d = i ? G.haversine(prev[0], prev[1], p[0], p[1]) : 0;
    const speed = 1.05 + 0.25 * Math.sin(i / 37) + rnd() * 0.1;
    time += (d / speed) * 1000;
    if (i === Math.round(dense.length * 0.47)) time += 12 * 60 * 1000; // summit break
    points.push({ lat: p[0], lon: p[1], ele: null, time: Math.round(time) });
    prev = p;
  }
  return { name: 'Alpine loop above Grindelwald', sport: 'hike', source: 'Demo route', points };
}
