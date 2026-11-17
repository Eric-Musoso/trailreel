# Trailreel

Turn a GPS activity into a Relive-style **3D flyover video** and an **interactive 3D route**, built on free
and open map data. Everything runs in the browser: frames are rendered one at a time over 3D terrain and
encoded to MP4 with WebCodecs, so you don't need a render server.

**Live:** <https://trailreel.floot.app> (hosted on Floot; Strava import works only locally).

## Features

| Area | What you get |
|---|---|
| Activities | Import one or many GPX / TCX / FIT files, stitch multi-day trips or triathlon legs (labelled "Day" or "Leg"; the transfer between days is hidden, left out of distance and climb, and flown quickly), add ghost/group riders, trim start/end clips, load the demo hike, or record with the browser's GPS; missing elevation is filled from terrain tiles |
| Library | Activities you open are saved in your browser (IndexedDB) with totals; open or delete them later. Nothing is uploaded |
| 3D video & camera | Relive-style intro, elevation profile HUD, distance/elevation/elapsed chips, peak and place labels, photo pop-ups (pins that would overlap stack with a count), outro stats, opt-in badge & end credits (off by default), camera angle presets, manual pitch/zoom/orbit, free-look 3D view, custom camera keyframes, and a terrain-aware camera that lowers its pitch where a ridge would hide the rider or the trail ahead |
| Style & lighting | 12 colour themes, 3 basemaps, dynamic time-of-day lighting (auto solar position, sunrise, golden hour, night + headlamp beam; hillshade lit from the sun's real direction), 16:9 / 9:16 / 1:1 aspects, 20–90 s length, terrain exaggeration, metric or imperial, privacy zone |
| Photos, music & voice | JPEG, PNG, WebP and iPhone HEIC photos (HEIC converted in the browser; the decoder loads only when needed), placed by EXIF GPS, time, spread, or manual pin; per-photo editor (rotate 90°, aspect crop, drag to reposition, scroll to zoom, captions, custom duration). Custom audio, 3 built-in ambient soundtracks, and mic voiceover recording with auto-ducking (AAC/Opus) |
| Privacy | Place name and weather lookups are optional and send only the start point rounded to ~1 km; reduced-motion users don't get an autoplaying flyover |
| Explore route | Free 3D camera, route coloured by grade or speed, scrubbable elevation profile with distance, elevation, time, grade and pace |
| Export and share | Watermark-free MP4 (H.264/HEVC/VP9/AV1, 720p/1080p/4K, 30/60 fps), self-contained Interactive 3D Web Story (.html), poster PNG, GPX download, system share sheet |
| Strava (local only) | OAuth connect and activity import through the dev/preview server |

See [`docs/RESEARCH.md`](docs/RESEARCH.md) for how Relive works (with evidence), the API breakdown and the
feature-by-feature comparison.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (loads a demo hike automatically)
npm run build        # typecheck + production build into dist/
```

Video export needs WebCodecs (current Chrome, Edge, Safari or Firefox). Keep the tab visible while rendering.

### Optional: Strava

1. Create an app at <https://www.strava.com/settings/api> and set **Authorization Callback Domain** to `localhost`.
2. `cp .env.example .env.local` and fill in `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`.
3. Restart `npm run dev`, then click **Connect with Strava** (it only appears when the local connector runs).

## Code layout

The local project and the Floot-hosted app use **the same files**: `src/helpers/*` and `src/pages/_index.*`
are copied 1:1 to the Floot project's `helpers/` and `pages/`. Only `src/main.tsx`, `index.html`,
`vite.config.ts` and `server/strava.ts` are local-only.

```
src/helpers/trailreelParse     GPX/TCX/FIT → Activity
src/helpers/trailreelDem       fill missing elevation from terrarium DEM tiles; terrain sampler for the camera guard
src/helpers/trailreelTrack     clean, stats, resample, trim/slice, multi-day stitch (chapters, breaks, story warp), smoothed heading
src/helpers/trailreelCameraGuard  terrain line-of-sight → per-route pitch caps so ridges never hide the trail
src/helpers/trailreelSpring    Apple-style interruptible springs, rubber-band, 1:1 pointer scrubber (no momentum: it stops where released)
src/helpers/trailreelLighting  solar elevation time-of-day & weather lighting + night headlamp
src/helpers/trailreelTimeline  director: stateAt(t) → keyframed camera, chapters, lighting, cards
src/helpers/trailreelMap       MapLibre style: imagery + terrain + hillshade + sky + route + ghost layers
src/helpers/trailreelOverlay   canvas HUD, intro, ghosts, headlamp, photo cards, credits, poster
src/helpers/trailreelExplore   interactive explorer: layers, profile scrubber, readout
src/helpers/trailreelExporter  WebCodecs + mp4-muxer (720p/1080p/4K, 30/60fps), per-frame render
src/helpers/trailreelStory     self-contained Interactive 3D Web Story (.html) exporter
src/helpers/trailreelAudio     music decode, procedural ambient presets, voiceover recorder, ducking + AAC/Opus
src/helpers/trailreelLibrary   IndexedDB activity library
src/helpers/trailreelRecorder  browser GPS recorder with wake lock
src/helpers/trailreelApp       controller wiring the page to the engine
src/pages/_index.tsx           the page (React), translucent Apple-style UI in _index.module.css
server/strava.ts               local-only Strava OAuth connector (Vite middleware)
```

## Free services used

| Purpose | Service | Key? |
|---|---|---|
| Map renderer | MapLibre GL JS v6 (worker from unpkg) | no |
| Satellite imagery | Esri World Imagery · EOX Sentinel-2 cloudless (non-commercial) | no* |
| Topo map | OpenTopoMap | no |
| Terrain / elevation | AWS Terrain Tiles (Mapzen terrarium) | no |
| Peak & place labels, glyphs | OpenFreeMap (OpenMapTiles schema) | no |
| Place name | OpenStreetMap Nominatim | no |
| Weather | Open-Meteo | no |
| Video/audio encode | WebCodecs + mp4-muxer | no |
| Activity import | @tmcw/togeojson, Garmin FIT SDK, Strava API | Strava only |

\*Fine for personal/dev use with attribution. For a public product read each provider's terms: Esri wants an
ArcGIS Location Platform key, OpenTopoMap/Nominatim have fair-use limits, EOX imagery is non-commercial.
Attribution is drawn into every video frame and the end credits.
