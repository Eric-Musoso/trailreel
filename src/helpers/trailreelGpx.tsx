import type { Activity } from './trailreelTypes';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Serialise an activity to GPX 1.1 (with Garmin heart-rate extension when present). */
export function trailreelGpx(act: Activity): string {
  const pts = act.points
    .map((p) => {
      const ele = p.ele != null && Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : '';
      const time = p.time != null ? `<time>${new Date(p.time).toISOString()}</time>` : '';
      const hr = p.hr != null ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : '';
      return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${ele}${time}${hr}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailreel" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${esc(act.name)}</name></metadata>
  <trk>
    <name>${esc(act.name)}</name>
    <type>${esc(act.sport)}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
