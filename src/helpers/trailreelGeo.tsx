// Small geo + easing math used by the Trailreel engine.
const EARTH_R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function angleDiff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export const trailreelGeo = {
  clamp,
  lerp,
  smoothstep(t: number) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  },
  easeInOutCubic(t: number) {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },
  easeInOutSine(t: number) {
    return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
  },
  easeOutBack(t: number) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const x = clamp(t, 0, 1);
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  /** Great-circle distance in metres. */
  haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  },
  /** Initial bearing in degrees (0 = north, clockwise). */
  bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  },
  angleDiff,
  lerpAngle(a: number, b: number, t: number): number {
    return a + angleDiff(a, b) * t;
  },
};
