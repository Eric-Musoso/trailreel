# How Relive works — evidence, API breakdown, free alternatives

Research date: 2026-11-12. Sources: Relive's public website bundles and media (analysed with REA and
direct HTTP inspection), Relive's help centre and privacy policy, and press coverage. Every claim below is
tagged **Observed** (seen directly in shipped artifacts), **Documented** (Relive/partner text) or
**Inferred** (reasoned from evidence, not proven).

## 1. What the product does

1. A user records an outdoor activity (run, ride, hike, ski…) with the Relive app **or** a connected
   tracker (Garmin, Suunto, Apple Watch, Polar, Wahoo, COROS, Zepp, Rouvy …).
2. Relive turns the GPS track (+ photos taken along the way) into a short **3D flyover video**: a camera
   follows the route over satellite imagery draped on terrain, with an elevation profile, live stats, peak
   labels, photo pop-ups and an end-of-video stats card.
3. The video is published as an MP4 on a share page (`relive.com/view/{slug}`) that embeds as a video on
   social networks. A free tier gets one video per activity; **Relive Plus** (subscription) unlocks more photos,
   music and customisation.

## 2. Evidence

| # | Finding | Type | Evidence |
|---|---------|------|----------|
| E1 | Website is a **Next.js App Router** app (`/_next/static/...`, `parallelRouterKey` in RSC payload) served through **AWS CloudFront** (`Via: …cloudfront.net`, `X-Amz-Cf-Pop: FRA60`) and protected by **AWS WAF** (`edge.sdk.awswaf.com` challenge script). Code reads the `cloudfront-viewer-country` header for geo. | Observed | HTTP headers of `https://www.relive.com/`; bundle strings in homepage HTML and JS chunks |
| E2 | Data API is **GraphQL via Apollo Client**. Recovered operations: `explore`, `routeBySlug`, `areaBySlug`, `regionBySlug`, `countryBySlug`, `collectionBySlug`, `areaActivityTypeByType`, `regionActivityTypeByType`, `sitemapData`. | Observed | REA `analyze_web_bundle` on relive.com — Evidence `ev_1c970d6cfa556775d7fe24ce356f8a424b73cdaa5378ac39eeee167018e14fcf` (59 scripts, 327,872 AST nodes; one script timed out so coverage is partial) |
| E3 | Videos are **pre-rendered MP4 files**, not rendered live in the browser: share page `og:video` = `https://video.relive.cc/<id>_relive_<ms>.mp4`, 1920×1080. | Observed | `og:` meta tags of a public share page (`/view/vE6JYZ1Y1xO`) |
| E4 | Video storage/CDN: **Amazon S3 + CloudFront** (`Server: AmazonS3`, `Via: …cloudfront.net`, `x-amz-server-side-encryption: AES256`). User uploads (profile/photos) on `ua.relive.cc`, also S3 + CloudFront. | Observed | HEAD responses of the MP4 and a profile image |
| E5 | Encoding: **H.264 Main, 1920×1080, 30 fps, ~2.7 Mbit/s, 92.6 s**, muxed by **FFmpeg 4.4's libavformat** (`encoder=Lavf58.76.100`). | Observed | `ffprobe` of the MP4 |
| E6 | Where rendering runs (server farm vs. on-device) is **not settled**: Lavf58.76 is FFmpeg 4.4, used both server-side and by mobile builds such as ffmpeg-kit. Analysing the Android APK for bundled native FFmpeg/renderer libraries would settle it. | Unknown | — |
| E7 | Video content: satellite imagery on 3D terrain, route drawn progressively (only the travelled part), elevation profile with progress at top-left, avatar marker, peak/place labels from map data ("Lone Butte"), photo markers, end card with distance · time · elevation gain · avg speed, branded outro with store badges. | Observed | Frames extracted at 4, 20, 40, 60, 84, 91 s |
| E8 | Image resizing via **imgproxy** behind CloudFront (`img.relive.com` → `Server: imgproxy`). Share images generated dynamically at `/api/og?slug=…`. | Observed | HTTP headers; `og:image` |
| E9 | Tracker integrations in the web bundle: `garmin`, `underarmour`, `apple-health` ("Apple Watch"), `suunto`, `zepp`, `rouvy`. Help centre also lists Wahoo, Polar Flow, COROS, Lezyne, Bryton, RunKeeper, Ride with GPS. | Observed + Documented | JS chunk with tracker map; [support.relive.com](https://support.relive.com/kb/guide/en/tracker-apps-to-connect-to-relive-yaSkCEtFsU/Steps/3687023) |
| E10 | **Strava** cut Relive's API access in 2019 ("violates our API agreement") and later launched its own Flyover feature. | Documented | [road.cc](https://road.cc/content/tech-news/strava-introduces-flyover-3d-video-maps-305103) |
| E11 | Basemap: Relive used **Esri World Imagery** (2017–18). The current provider is not visible in recent frames (no on-screen attribution), so it is unconfirmed. | Documented (historical) | [Esri ArcNews](https://www.esri.com/about/newsroom/arcnews/with-3d-maps-athletes-relive-their-global-adventures) |
| E12 | Analytics/monitoring: **Snowplow** (collector `aspweb.api.relive.cc`; `trackSelfDescribingEvent`; named in the privacy policy), **Datadog RUM**, **Sentry**, **Microsoft Clarity**, Google tag, Meta and TikTok pixels. | Observed + Documented | JS chunks; [relive.com/privacy](https://www.relive.com/privacy) |
| E13 | Sign-in: **Sign in with Apple** (`appleid.cdn-apple.com`), **Google** (`googleButtonId`), email. Landing pages on **Unbounce**; help centre on **Stonly**. | Observed + Documented | JS chunks; privacy policy |
| E14 | Company: Relive B.V., Rotterdam; founded 2016. | Documented | privacy policy; [TechCrunch 2017](https://techcrunch.com/2017/05/02/relive) |

### Inferred pipeline

```
 tracker webhook / app upload ──► activity store (GPS, photos → S3 "ua.relive.cc")
                                          │
                                          ▼
                       render job: 3D terrain + imagery + overlays
                       → frames → FFmpeg (H.264 1080p30)            (server or device: see E6)
                                          │
                                          ▼
                       S3 "video.relive.cc" ─► CloudFront ─► share page relive.com/view/{slug}
                                                            (Next.js, og:video, /api/og image)
```

## 3. Every API/service a Relive-like app needs, with free options

✅ = used in this repo's app (Trailreel).

| Capability | What Relive uses (evidence) | Free / open alternative | Notes |
|---|---|---|---|
| **Activity import: files** | (FIT/GPX upload in app) | ✅ **@tmcw/togeojson** (GPX/TCX, BSD-2), ✅ **Garmin FIT JavaScript SDK** (FIT) | No API keys. Every watch brand exports FIT/GPX. |
| **Activity import: Strava** | Cut off in 2019 (E10) | ✅ **Strava API v3** — free self-serve app, OAuth2 | 200 req/15 min, 2,000/day default. Terms restrict showing a user's data to other people and AI use. Fine for a personal tool. |
| Activity import: Garmin | Garmin (E9) | Garmin Connect Developer Program (Activity/Health API) | No usage fee, but you need an approved business application. |
| Activity import: Polar | Polar Flow | **Polar AccessLink API** | Free self-serve registration. |
| Activity import: Suunto / COROS / Wahoo | Suunto, COROS, Wahoo | Suunto API Zone, COROS partner API, Wahoo Cloud API | Free, but you must apply as a partner. |
| Activity import: phone | Apple Health (E9) | **HealthKit** (iOS), **Health Connect** (Android) | Free, on-device; needs a native or React Native/Flutter app. |
| Live GPS recording | Relive app | Device location APIs (CoreLocation, FusedLocationProvider, Geolocation API) | Free. Background tracking needs a native app. |
| **Satellite imagery** | Esri World Imagery (historical, E11) | ✅ **Esri World Imagery** tiles · ✅ **EOX Sentinel-2 cloudless** (non-commercial) · USGS imagery (US, public domain) | For production Esri needs an ArcGIS Location Platform key (free tier). Paid: Mapbox Satellite, MapTiler, Google 3D Tiles. |
| Topographic basemap | — | ✅ **OpenTopoMap**, ✅ **OpenFreeMap** vector tiles | OpenTopoMap/OSM tile servers have fair-use limits; self-host for scale. |
| **Terrain (DEM)** | 3D terrain (E7) | ✅ **AWS Terrain Tiles** (Mapzen terrarium, Open Data on AWS) · Copernicus GLO-30 | Also used here to fill missing elevations. |
| **Peak / place labels** | Labels in video (E7) | ✅ **OpenFreeMap** (OpenMapTiles `mountain_peak`, `place`) · Overpass API · GeoNames | Public Overpass mirrors were down (502/timeouts) during this build, so the app uses vector tiles instead. |
| **3D map renderer** | Unknown engine (E6) | ✅ **MapLibre GL JS** (BSD-3) · CesiumJS (Apache-2) · deck.gl · three.js | MapLibre v6 has terrain, sky/fog and a camera API. |
| **Video encoding** | FFmpeg 4.4 (E5) | ✅ **WebCodecs** + ✅ **mp4-muxer** (MIT) in the browser · FFmpeg on a server | Encoding in the browser removes the render farm cost completely. |
| Server-side rendering (optional) | S3 + CloudFront pipeline (E4) | Headless Chromium (Playwright/Puppeteer) + the same page · maplibre-native | Needed only if videos must render without the user's browser open. |
| **Video storage + CDN** | S3 + CloudFront (E4) | Cloudflare R2 (10 GB free, no egress fees) · Backblaze B2 (10 GB free) · Supabase Storage (1 GB free) | |
| Image resizing | imgproxy (E8) | imgproxy (open source) · sharp | |
| Share page + OG image | Next.js, `/api/og`, `og:video` (E3, E8) | Next.js + Satori / @vercel/og | Add `og:video` so the MP4 plays inline in social posts. |
| App API | GraphQL / Apollo (E2) | Apollo Server · GraphQL Yoga · Supabase (Postgres + pg_graphql/PostgREST) | |
| Auth | Apple, Google, email (E13) | Supabase Auth · Firebase Auth · Auth.js | All have free tiers. Apple sign-in needs an Apple developer account ($99/yr). |
| Subscriptions | Relive Plus (in-app purchases) | RevenueCat (free tier) · Stripe (fees per transaction) | App Store/Play billing is required for in-app digital goods. |
| Push / email ("your video is ready") | — | Firebase Cloud Messaging (free) · Resend (free tier) · Amazon SES | |
| Product analytics | Snowplow, Clarity, gtag (E12) | PostHog (free tier) · Umami / Plausible CE (self-host) · Microsoft Clarity (free) | |
| Error / performance monitoring | Sentry, Datadog RUM (E12) | Sentry (free dev tier) · GlitchTip (self-host) | |
| Reverse geocoding (title/place) | — | ✅ **Nominatim** (1 req/s, attribution) · Photon | |
| Historical weather (title card) | — | ✅ **Open-Meteo** (free for non-commercial, no key) | Its archive endpoint returned 502 during testing, so the app shows "—" and carries on. |
| Music bed (Plus feature) | Music in Plus videos | Pixabay Music · YouTube Audio Library · Free Music Archive (check each licence) | Not implemented yet. WebCodecs AudioEncoder + mp4-muxer support AAC/Opus. |

## 4. Update: inspection of a signed-in Relive account (read-only, via Chrome)

| # | Finding | Source |
|---|---------|--------|
| E15 | Video and explorer imagery **and terrain** come from **Esri** (World Imagery, WorldElevation3D/Terrain3D), plus OpenStreetMap data. Settles E11. | relive.com/map-attribution; explorer requests to `server.arcgisonline.com`, `elevation3d.arcgis.com` |
| E16 | "View interactive route" = separate React app (`/apps/explorer/bundle.min.js`) on **ArcGIS API for JavaScript 4.6** (SceneView, GraphicsLayer, Zoom/Compass/NavigationToggle/BasemapToggle). | Explorer script list |
| E17 | Explorer: 3D route, **Grade** and **Velocity** colour layers, full-width elevation profile; hover moves the camera and shows distance, elevation, time, grade, pace. | Hands-on |
| E18 | **Public REST API** (OAuth 2.0, scopes `user:read activity:read activity:write`, closed to new partners): `POST /upload` (GPX/TCX/FIT), `GET /user/activities`, `GET /activity/{id}`, `POST /activity/{id}/render`, `GET /activity/{id}/map`, moment maps. Activity `state`: failed, done, editing, pending-render, blocked-premium. Photos = "moments" with `moment_at`, location and route distance. Strongest evidence that rendering is server-side (E6). | relive.com/developers; `public.api.relive.cc/v1/swagger.json` |
| E19 | 2026 template: intro (route thumbnail + stats strip, big title, coloured name/date tag), flight (progress bar + elapsed stats), outro stats bar, end credits "Maps by Esri" + store badges. Free videos 960×540@30. | Frames + ffprobe of the account's latest video |
| E20 | Settings: trackers (Garmin Connect, Suunto, Under Armour, Polar Flow, Wahoo, Ride with GPS), bulk import, privacy (visibility, aggregated data, public photos, privacy zones), My Data with per-activity GPX download. | relive.com/settings/* |
| E21 | Relive Plus €38.99/yr: HD, speed control, edit anytime, old activities, music, priority, >12 h, interactive route, extended photo display, 12 themes, no end credits, up to 100 photos/clips (free 10). | relive.com/plus; help centre |
| E22 | Explore directory: SEO pages per country/region/park/city with top routes aggregated from users' activities. | relive.com/explore |

### Feature map (Relive → Trailreel)

Built: 3D flyover video, Relive-style intro, HUD, outro, end credits toggle, photos with display length, music
(own file → AAC), 12 colour themes, speed via length presets, 720p/1080p and 16:9/9:16, interactive 3D route
(Route/Grade/Speed, profile scrubber, readout), multi-file import, GPX export, poster PNG.
Partial: local library (no cloud sync), privacy zone (ends only), browser GPS recording (page must stay open),
sharing (download + Web Share, no hosted share page).
Not built / blocked: video clips as moments, tracker partner sync (needs approvals + backend), Explore directory and
social features (need accounts and community data), hosted share pages (need storage), background recording
(needs a native wrapper), Plus payments (not needed).

## 5. Open questions

- Rendering is most likely server-side (E18: render endpoint, `pending-render` state). Confirming it for videos
  created inside the mobile app needs the Android APK examined (e.g. REA `inspect_android_package`).
- Imagery provider: settled — Esri (E15).
- The mobile app's backend endpoints and its in-app editor were not examined; only the website, the explorer and
  the public API docs were.
