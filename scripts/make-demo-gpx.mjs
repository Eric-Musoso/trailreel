// Generates public/samples/alpine-loop.gpx: a synthetic ~9 km hiking loop above Grindelwald (CH).
// Waypoints are approximate (First → Bachalpsee → Faulhorn → ridge → back), smoothed with a
// Catmull-Rom spline. No <ele> tags on purpose: the app fills elevation from free terrain tiles.
import { mkdirSync, writeFileSync } from 'node:fs';

const waypoints = [
  [46.6597, 8.0542], [46.6622, 8.0478], [46.6655, 8.0398], [46.668, 8.032], [46.6694, 8.0236],
  [46.6712, 8.0196], [46.6738, 8.0162], [46.6763, 8.0139], [46.679, 8.019], [46.6815, 8.0255],
  [46.679, 8.033], [46.6745, 8.04], [46.67, 8.047], [46.665, 8.053], [46.6604, 8.0546],
];

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const catmull = (p0, p1, p2, p3, t) =>
  [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t));

// Dense spline points
const dense = [];
for (let i = 0; i < waypoints.length - 1; i++) {
  const p0 = waypoints[Math.max(0, i - 1)];
  const p1 = waypoints[i];
  const p2 = waypoints[i + 1];
  const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];
  for (let s = 0; s < 40; s++) dense.push(catmull(p0, p1, p2, p3, s / 40));
}
dense.push(waypoints[waypoints.length - 1]);

// Deterministic wiggle so it looks like a real GPS trace
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);

let time = Date.parse('2025-07-19T07:10:00Z');
const out = [];
let prev = dense[0];
for (let i = 0; i < dense.length; i++) {
  const p = [dense[i][0] + rnd() * 0.00004, dense[i][1] + rnd() * 0.00004];
  const d = i ? dist(prev, p) : 0;
  const speed = 1.05 + 0.25 * Math.sin(i / 37) + rnd() * 0.1; // m/s
  time += (d / speed) * 1000;
  if (i === Math.round(dense.length * 0.47)) time += 12 * 60 * 1000; // summit break
  out.push({ lat: p[0], lon: p[1], time });
  prev = p;
}

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="trailreel demo generator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Alpine loop above Grindelwald</name></metadata>
  <trk>
    <name>Alpine loop above Grindelwald</name>
    <type>hiking</type>
    <trkseg>
${out.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.time).toISOString()}</time></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>
`;

mkdirSync(new URL('../public/samples/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/samples/alpine-loop.gpx', import.meta.url), gpx);
const km = out.reduce((s, p, i) => (i ? s + dist([out[i - 1].lat, out[i - 1].lon], [p.lat, p.lon]) : 0), 0) / 1000;
console.log(`wrote ${out.length} points, ${km.toFixed(2)} km, ${((out.at(-1).time - out[0].time) / 3600000).toFixed(2)} h`);
