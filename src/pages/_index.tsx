import { useEffect, useRef } from 'react';
import { trailreelApp } from '../helpers/trailreelApp';
import styles from './_index.module.css';

export default function TrailreelPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    return trailreelApp(rootRef.current, {
      portrait: styles.portrait,
      square: styles.square,
      dragging: styles.dragging,
      toast: styles.toast,
      toastError: styles.toastError,
      toastOut: styles.toastOut,
      swatch: styles.swatch,
      libItem: styles.libItem,
      libDelete: styles.libDelete,
      chipBtn: styles.chipBtn,
      keyframeRow: styles.keyframeRow,
      chapterRow: styles.chapterRow,
      ghostRow: styles.ghostRow,
      scrubberMarker: styles.scrubberMarker,
      scrubberPhoto: styles.scrubberPhoto,
      scrubberChapter: styles.scrubberChapter,
      modalOpen: styles.modalOpen,
    });
  }, []);

  return (
    <div ref={rootRef} className={styles.app}>
      <title>Trailreel · 3D activity flyovers</title>
      <meta name="description" content="Turn GPS activities into 3D flyover videos and interactive 3D web stories with custom camera keyframes, photo editing, voiceovers, multi-day stitching, and watermark-free 4K exports." />
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true" />
          Trailreel
        </div>
        <p className={styles.tagline}>Studio-grade 3D flyovers, keyframes &amp; interactive stories — 100% in your browser.</p>
      </header>

      <main className={styles.layout}>
        <aside className={styles.panel} aria-label="Studio Controls">
          <div className={styles.segmented} role="tablist" aria-label="Inspector sections">
            <span id="segPill" className={styles.segPill} aria-hidden="true" />
            <button type="button" role="tab" data-panel="route" aria-selected="true">
              Route
            </button>
            <button type="button" role="tab" data-panel="camera" aria-selected="false">
              Camera
            </button>
            <button type="button" role="tab" data-panel="media" aria-selected="false">
              Media
            </button>
            <button type="button" role="tab" data-panel="style" aria-selected="false">
              Style
            </button>
            <button type="button" role="tab" data-panel="export" aria-selected="false">
              Export
            </button>
          </div>

          <section data-panel-body="route">
            <h2>
              <span>1</span> Activity &amp; Stitching
            </h2>
            <label className={styles.drop}>
              <input type="file" id="fileActivity" accept=".gpx,.tcx,.fit" multiple />
              <strong>Choose or drop tracks</strong>
              <small>GPX, TCX or FIT files exported from Garmin, Wahoo, Suunto, COROS, Apple Health or Strava</small>
            </label>
            <div className={styles.row}>
              <button type="button" id="btnDemo" className={styles.ghost}>
                Load demo hike
              </button>
              <button type="button" id="btnRecord" className={styles.ghost} aria-pressed="false">
                Record GPS
              </button>
              <select id="recordSport" aria-label="Sport to record" defaultValue="walk">
                <option value="walk">Walk</option>
                <option value="run">Run</option>
                <option value="hike">Hike</option>
                <option value="ride">Ride</option>
                <option value="ski">Ski</option>
                <option value="other">Other</option>
              </select>
            </div>
            <p className={styles.hint} id="recordStatus" hidden />
            <div id="stravaBox" hidden>
              <div className={styles.row}>
                <button type="button" id="btnStrava" className={`${styles.ghost} ${styles.strava}`}>
                  Connect with Strava
                </button>
              </div>
              <select id="stravaList" className={styles.fullSelect} aria-label="Strava activities" hidden />
              <p className={styles.hint} id="stravaHint" />
            </div>
            <p className={styles.hint} id="activityInfo" />
            <label className={`${styles.field} ${styles.check}`}>
              <input id="lookupOnline" type="checkbox" defaultChecked />
              Look up place name &amp; weather
            </label>
            <p className={styles.hint}>Sends only the start point, rounded to about 1 km, to OpenStreetMap and Open-Meteo.</p>

            <div className={styles.subcard}>
              <div className={styles.subhead}>
                <strong>Clip trim</strong>
                <span id="trimLabel" className={styles.mono}>0% – 100%</span>
              </div>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  Start
                  <input id="trimStart" type="range" min="0" max="0.9" step="0.01" defaultValue="0" />
                </label>
                <label className={styles.field}>
                  End
                  <input id="trimEnd" type="range" min="0.1" max="1" step="0.01" defaultValue="1" />
                </label>
              </div>
            </div>

            <div className={styles.subcard}>
              <div className={styles.subhead}>
                <strong>Multi-day chapters</strong>
                <label className={styles.miniFileBtn}>
                  <input type="file" id="fileChapter" accept=".gpx,.tcx,.fit" multiple />
                  + Add day
                </label>
              </div>
              <p className={styles.hint} id="chapterHint">
                Stitch multiple GPX/FIT/TCX days or triathlon legs into one chaptered video.
              </p>
              <ul id="chapterList" className={styles.compactList} />
            </div>

            <div className={styles.subcard}>
              <div className={styles.subhead}>
                <strong>Group &amp; ghost riders</strong>
                <label className={styles.miniFileBtn}>
                  <input type="file" id="fileGhost" accept=".gpx,.tcx,.fit" multiple />
                  + Add ghost
                </label>
              </div>
              <label className={styles.field}>
                Ghost sync
                <select id="ghostSync" defaultValue="time">
                  <option value="time">Sync by elapsed time (race mode)</option>
                  <option value="progress">Sync by route progress</option>
                </select>
              </label>
              <ul id="ghostList" className={styles.compactList} />
            </div>

            <details className={styles.library} open>
              <summary>Your library</summary>
              <p className={styles.hint} id="librarySummary" />
              <ul id="libraryList" className={styles.libList} />
            </details>
          </section>

          <section data-panel-body="camera" hidden>
            <h2>
              <span>2</span> Camera &amp; Keyframes
            </h2>
            <div className={styles.chipRow} role="group" aria-label="Camera presets">
              <button type="button" className={styles.chipBtn} data-cam-preset="follow">Follow</button>
              <button type="button" className={styles.chipBtn} data-cam-preset="cinematic">Low sweep</button>
              <button type="button" className={styles.chipBtn} data-cam-preset="overhead">Overhead</button>
              <button type="button" className={styles.chipBtn} data-cam-preset="side">Side ridge</button>
              <button type="button" className={styles.chipBtn} data-cam-preset="reverse">Look back</button>
            </div>
            <label className={styles.field}>
              Tilt / Pitch
              <span className={styles.inline}>
                <input id="camPitch" type="range" min="15" max="78" step="1" defaultValue="62" />
                <output id="camPitchVal">62°</output>
              </span>
            </label>
            <label className={styles.field}>
              Zoom offset
              <span className={styles.inline}>
                <input id="camZoom" type="range" min="-2.2" max="2.2" step="0.1" defaultValue="0" />
                <output id="camZoomVal">0.0</output>
              </span>
            </label>
            <label className={styles.field}>
              Orbit / Bearing offset
              <span className={styles.inline}>
                <input id="camBearing" type="range" min="-180" max="180" step="2" defaultValue="0" />
                <output id="camBearingVal">0°</output>
              </span>
            </label>
            <label className={`${styles.field} ${styles.check}`}>
              <input id="avoidTerrain" type="checkbox" defaultChecked />
              Keep the trail in view
            </label>
            <p className={styles.hint}>Lifts the camera where a ridge would hide you or the trail ahead.</p>

            <div className={styles.subcard}>
              <div className={styles.subhead}>
                <strong>Camera keyframes</strong>
                <span className={styles.mono} id="keyframeCount">0 pins</span>
              </div>
              <p className={styles.hint}>
                Scrub anywhere or grab the 3D view directly, then pin custom angles so mountains never block your trail.
              </p>
              <div className={styles.row}>
                <button type="button" id="btnGrabCamera" className={styles.ghost} aria-pressed="false">
                  Free-look 3D view
                </button>
                <button type="button" id="btnAddKeyframe" className={styles.primary}>
                  + Pin keyframe
                </button>
              </div>
              <ul id="keyframeList" className={styles.compactList} />
            </div>
          </section>

          <section data-panel-body="media" hidden>
            <h2>
              <span>3</span> Photos, Music &amp; Voice
            </h2>
            <label className={`${styles.drop} ${styles.dropSmall}`}>
              <input type="file" id="filePhotos" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple />
              <strong>Add photos</strong>
              <small>JPEG, PNG, WebP or iPhone HEIC · click a thumbnail to rotate, crop, caption &amp; set duration</small>
            </label>
            <p className={styles.hint} id="photoHint">
              Photos pop up along the route in the video.
            </p>
            <ul id="photoList" className={styles.thumbs} />
            <label className={styles.field}>
              Default photo duration
              <select id="photoHold" defaultValue="normal">
                <option value="short">Short (2.2 s)</option>
                <option value="normal">Normal (3.2 s)</option>
                <option value="long">Extended (5.0 s)</option>
              </select>
            </label>

            <div className={styles.subcard}>
              <div className={styles.subhead}>
                <strong>Music soundtrack</strong>
              </div>
              <label className={`${styles.drop} ${styles.dropSmall}`}>
                <input type="file" id="fileMusic" accept="audio/*" />
                <strong>Import your own audio</strong>
                <small>MP3, M4A, WAV or OGG · loops cleanly</small>
              </label>
              <div className={styles.chipRow} role="group" aria-label="Built-in soundtracks">
                <button type="button" className={styles.chipBtn} data-music-preset="alpine">Alpine</button>
                <button type="button" className={styles.chipBtn} data-music-preset="pulse">Summit Pulse</button>
                <button type="button" className={styles.chipBtn} data-music-preset="horizon">Golden Horizon</button>
              </div>
              <div className={styles.musicRow}>
                <p className={styles.hint} id="musicInfo">
                  No music. Videos export silent unless voiceover is added.
                </p>
                <button type="button" id="btnMusicRemove" className={styles.ghost} hidden>
                  Remove
                </button>
              </div>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  Music volume
                  <input id="musicVolume" type="range" min="0" max="1" step="0.05" defaultValue="0.8" />
                </label>
                <label className={styles.field}>
                  Start offset (s)
                  <input id="musicOffset" type="range" min="0" max="120" step="1" defaultValue="0" />
                </label>
              </div>
            </div>

            <div className={styles.subcard}>
              <div className={styles.subhead}>
                <strong>Voiceover narration</strong>
                <span id="voiceInfo" className={styles.mono}>None</span>
              </div>
              <div className={styles.meterWrap}>
                <div id="voiceMeter" className={styles.meterFill} />
              </div>
              <div className={styles.row}>
                <button type="button" id="btnVoiceRecord" className={styles.ghost} aria-pressed="false">
                  Record voiceover
                </button>
                <button type="button" id="btnVoiceClear" className={styles.ghost} hidden>
                  Clear
                </button>
              </div>
              <label className={styles.field}>
                Voiceover level (auto-ducks music)
                <input id="voiceVolume" type="range" min="0" max="1.5" step="0.05" defaultValue="1.0" />
              </label>
            </div>
          </section>

          <section data-panel-body="style" hidden>
            <h2>
              <span>4</span> Style &amp; Lighting
            </h2>
            <label className={styles.field}>
              Title <input id="title" type="text" maxLength={80} placeholder="Activity title" />
            </label>
            <div className={styles.field}>
              <span>
                Colour theme · <span id="themeName">Ember</span>
              </span>
              <div id="themes" className={styles.swatches} role="group" aria-label="Colour theme" />
            </div>
            <div className={styles.grid2}>
              <label className={styles.field}>
                Map <select id="basemap" />
              </label>
              <label className={styles.field}>
                Time-of-day lighting
                <select id="lighting" defaultValue="auto">
                  <option value="auto">Auto (real sun)</option>
                  <option value="day">Daylight</option>
                  <option value="sunrise">Sunrise</option>
                  <option value="golden">Golden hour</option>
                  <option value="night">Night + headlamp</option>
                </select>
              </label>
              <label className={styles.field}>
                Aspect ratio
                <select id="aspect" defaultValue="16:9">
                  <option value="16:9">16:9 YouTube</option>
                  <option value="9:16">9:16 Reels / TikTok</option>
                  <option value="1:1">1:1 Feed Square</option>
                </select>
              </label>
              <label className={styles.field}>
                Length
                <select id="duration" defaultValue="30">
                  <option value="20">~20 s (fast)</option>
                  <option value="30">~30 s</option>
                  <option value="45">~45 s</option>
                  <option value="60">~60 s</option>
                  <option value="90">~90 s (slow)</option>
                </select>
              </label>
              <label className={styles.field}>
                Units
                <select id="units" defaultValue="metric">
                  <option value="metric">Metric</option>
                  <option value="imperial">Imperial</option>
                </select>
              </label>
              <label className={styles.field}>
                Privacy zone
                <select id="privacy" defaultValue="0">
                  <option value="0">Show whole route</option>
                  <option value="200">Hide ends (200 m)</option>
                  <option value="500">Hide ends (500 m)</option>
                  <option value="1000">Hide ends (1 km)</option>
                </select>
              </label>
              <label className={styles.field}>
                Terrain
                <span className={styles.inline}>
                  <input id="exaggeration" type="range" min="1" max="2.5" step="0.1" defaultValue="1.4" />
                  <output id="exaggerationValue">1.4×</output>
                </span>
              </label>
            </div>
            <div className={styles.grid2}>
              <label className={`${styles.field} ${styles.check}`}>
                <input id="watermark" type="checkbox" />
                Trailreel badge
              </label>
              <label className={`${styles.field} ${styles.check}`}>
                <input id="endCredits" type="checkbox" />
                End credits
              </label>
            </div>
          </section>

          <section data-panel-body="export" hidden>
            <h2>
              <span>5</span> Export &amp; Interactive Story
            </h2>
            <div className={styles.grid2}>
              <label className={styles.field}>
                Resolution
                <select id="quality" aria-label="Resolution" defaultValue="1080">
                  <option value="720">720p HD</option>
                  <option value="1080">1080p Full HD</option>
                  <option value="2160">4K Ultra HD (2160p)</option>
                </select>
              </label>
              <label className={styles.field}>
                Frame rate
                <select id="fps" aria-label="Frame rate" defaultValue="30">
                  <option value="30">30 fps</option>
                  <option value="60">60 fps smooth</option>
                </select>
              </label>
            </div>
            <div className={styles.row}>
              <button type="button" id="btnExport" className={styles.primary} disabled>
                Render MP4
              </button>
              <button type="button" id="btnCancel" className={styles.ghost} hidden>
                Cancel
              </button>
            </div>
            <div className={styles.row}>
              <button type="button" id="btnStory" className={styles.ghost} disabled>
                Export Interactive Story (.html)
              </button>
              <button type="button" id="btnPoster" className={styles.ghost} disabled>
                Save poster
              </button>
              <button type="button" id="btnGpx" className={styles.ghost} disabled>
                Download GPX
              </button>
            </div>
            <progress id="exportProgress" max={1} defaultValue={0} hidden />
            <p className={styles.hint} id="exportStatus">
              Watermark-free 1080p &amp; 4K 60fps MP4 encoding runs directly on your device.
            </p>
            <div id="exportResult" className={styles.exportResult} hidden>
              <video id="resultVideo" controls playsInline />
              <div className={styles.row}>
                <a id="downloadLink" className={`${styles.button} ${styles.primary}`} download>
                  Download video
                </a>
                <button type="button" id="btnShare" className={styles.ghost} hidden>
                  Share…
                </button>
              </div>
            </div>
            <div id="posterResult" className={styles.exportResult} hidden>
              <img id="posterImg" alt="Poster preview" />
              <a id="posterLink" className={`${styles.button} ${styles.ghost}`} download>
                Download poster
              </a>
            </div>
          </section>
        </aside>

        <section className={styles.stageWrap} aria-label="Preview">
          <div className={styles.tabsBar}>
            <div className={styles.tabs} role="tablist" aria-label="View">
              <button type="button" id="tabVideo" role="tab" aria-selected="true">
                3D video
              </button>
              <button type="button" id="tabExplore" role="tab" aria-selected="false" disabled>
                Explore route
              </button>
            </div>
            <span id="lightingBadge" className={styles.statusPill}>Daylight</span>
          </div>
          <div id="stage" className={styles.stage} tabIndex={0}>
            <div id="map" className={styles.mapLayer} />
            <canvas id="overlay" className={styles.overlayLayer} />
            <div id="grabBanner" className={styles.grabBanner} hidden>
              Drag or tilt the 3D map, then click <strong>+ Pin keyframe</strong> in Camera
            </div>
            <div id="explorePanel" className={styles.explorePanel} hidden>
              <div className={styles.exploreTop}>
                <div className={styles.layerGroup} role="group" aria-label="Route colour">
                  <button type="button" data-layer="route" aria-pressed="true">
                    Route
                  </button>
                  <button type="button" data-layer="grade" aria-pressed="false">
                    Grade
                  </button>
                  <button type="button" data-layer="speed" aria-pressed="false">
                    Speed
                  </button>
                </div>
                <button type="button" id="btnRecenter" className={styles.recenter}>
                  Recenter
                </button>
              </div>
              <div className={styles.exploreBottom}>
                <div className={styles.readout} aria-live="polite">
                  <div>
                    <span>Distance</span>
                    <strong id="exDist">–</strong>
                  </div>
                  <div>
                    <span>Elevation</span>
                    <strong id="exEle">–</strong>
                  </div>
                  <div>
                    <span>Time</span>
                    <strong id="exTime">–</strong>
                  </div>
                  <div>
                    <span>Grade</span>
                    <strong id="exGrade">–</strong>
                  </div>
                  <div>
                    <span>Pace / speed</span>
                    <strong id="exSpeed">–</strong>
                  </div>
                </div>
                <canvas id="exploreProfile" className={styles.profile} tabIndex={0} aria-label="Elevation profile. Hover or use arrow keys to move along the route." />
                <p id="exploreLegend" className={styles.legend} />
              </div>
            </div>
            <div id="emptyState" className={styles.empty}>
              Load an activity to start.
            </div>
            <div id="loading" className={styles.loading} hidden>
              <span className={styles.spinner} aria-hidden="true" />
              <span id="loadingText">Loading…</span>
            </div>
          </div>

          <div id="transport" className={styles.transport}>
            <button type="button" id="btnPlay" aria-label="Play">
              ▶
            </button>
            <div
              id="scrubber"
              className={styles.scrubber}
              role="slider"
              tabIndex={0}
              aria-label="Timeline scrubber"
              aria-valuemin={0}
              aria-valuemax={1000}
              aria-valuenow={0}
            >
              <div className={styles.scrubberTrack}>
                <div id="scrubberFill" className={styles.scrubberFill} />
                <div id="scrubberMarkers" className={styles.scrubberMarkers} />
              </div>
              <div id="scrubberThumb" className={styles.scrubberThumb} />
            </div>
            <span id="timeLabel" className={styles.timeLabel}>
              0:00 / 0:00
            </span>
          </div>
          <div id="statsStrip" className={styles.statsStrip} />
        </section>
      </main>

      <div id="photoModal" className={styles.modalScrim} hidden aria-modal="true" role="dialog" aria-labelledby="photoModalTitle">
        <div className={styles.modalSheet}>
          <div className={styles.modalHeader}>
            <h3 id="photoModalTitle">Edit Photo</h3>
            <button type="button" id="btnPhotoDone" className={styles.primary}>
              Done
            </button>
          </div>
          <div className={styles.modalBody}>
            <div className={styles.photoPreviewBox}>
              <canvas id="photoEditCanvas" className={styles.photoEditCanvas} aria-label="Photo preview. Drag to move the photo inside the crop, scroll to zoom." />
              <p className={styles.hint}>Drag the photo to reposition it · scroll to zoom</p>
            </div>
            <div className={styles.photoEditControls}>
              <div className={styles.row}>
                <button type="button" id="btnPhotoRotate" className={styles.ghost}>
                  Rotate 90°
                </button>
                <button type="button" id="btnPhotoReset" className={styles.ghost}>
                  Reset crop
                </button>
                <button type="button" id="btnPhotoDelete" className={styles.dangerGhost}>
                  Remove photo
                </button>
              </div>
              <div className={styles.field}>
                <span>Crop aspect</span>
                <div className={styles.chipRow} id="photoAspectGroup">
                  <button type="button" className={styles.chipBtn} data-crop-aspect="free">Original</button>
                  <button type="button" className={styles.chipBtn} data-crop-aspect="1:1">1:1</button>
                  <button type="button" className={styles.chipBtn} data-crop-aspect="4:3">4:3</button>
                  <button type="button" className={styles.chipBtn} data-crop-aspect="16:9">16:9</button>
                  <button type="button" className={styles.chipBtn} data-crop-aspect="3:4">3:4</button>
                </div>
              </div>
              <label className={styles.field}>
                Zoom
                <span className={styles.inline}>
                  <input id="photoZoom" type="range" min="1" max="2.5" step="0.05" defaultValue="1" />
                  <output id="photoZoomVal">1.0×</output>
                </span>
              </label>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  Pan X
                  <input id="photoPanX" type="range" min="-1" max="1" step="0.05" defaultValue="0" />
                </label>
                <label className={styles.field}>
                  Pan Y
                  <input id="photoPanY" type="range" min="-1" max="1" step="0.05" defaultValue="0" />
                </label>
              </div>
              <label className={styles.field}>
                Caption
                <input id="photoCaption" type="text" maxLength={80} placeholder="Summit ridge at sunrise…" />
              </label>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  Duration
                  <span className={styles.inline}>
                    <input id="photoDuration" type="range" min="0" max="8" step="0.2" defaultValue="0" />
                    <output id="photoDurationVal">Default</output>
                  </span>
                </label>
                <label className={styles.field}>
                  Route position
                  <span className={styles.inline}>
                    <input id="photoPosition" type="range" min="0.03" max="0.97" step="0.01" defaultValue="0.5" />
                    <output id="photoPositionVal">50%</output>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="toasts" className={styles.toasts} aria-live="polite" />
    </div>
  );
}
