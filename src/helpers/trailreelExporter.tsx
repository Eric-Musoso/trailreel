/**
 * Frame-by-frame video export with WebCodecs + mp4-muxer. Each frame waits until every
 * map tile is loaded, so the result is smooth regardless of network speed.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { EncodedAudio } from './trailreelAudio';

export interface FrameRenderer {
  renderFrame(t: number, ctx: CanvasRenderingContext2D, width: number, height: number): Promise<void>;
}

interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  duration: number;
  audio?: EncodedAudio | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number, etaSeconds: number | null) => void;
}

type MuxCodec = 'avc' | 'hevc' | 'vp9' | 'av1';

async function pickCodec(width: number, height: number, fps: number, bitrate: number): Promise<{ codec: string; mux: MuxCodec } | null> {
  const is4k = Math.max(width, height) > 2000;
  const candidates: [string, MuxCodec][] = is4k
    ? [
        ['avc1.640034', 'avc'],
        ['avc1.640033', 'avc'],
        ['hvc1.1.6.L153.B0', 'hevc'],
        ['vp09.00.51.08', 'vp9'],
        ['av01.0.12M.08', 'av1'],
        ['avc1.640028', 'avc'],
      ]
    : [
        ['avc1.640033', 'avc'],
        ['avc1.64002a', 'avc'],
        ['avc1.640028', 'avc'],
        ['avc1.4d0028', 'avc'],
        ['avc1.42e028', 'avc'],
        ['vp09.00.40.08', 'vp9'],
        ['av01.0.08M.08', 'av1'],
      ];
  for (const [codec, mux] of candidates) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (supported) return { codec, mux };
    } catch {
      /* try next */
    }
  }
  return null;
}

function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

async function exportMp4(renderer: FrameRenderer, opts: ExportOptions): Promise<{ blob: Blob; codec: string }> {
  if (!webCodecsAvailable()) throw new Error('This browser has no WebCodecs video encoder. Use a recent Chrome, Edge, Safari or Firefox.');
  const { width, height, fps, duration, audio } = opts;
  const bitrate = Math.min(48_000_000, Math.round(width * height * fps * 0.14));
  const choice = await pickCodec(width, height, fps, bitrate);
  if (!choice) throw new Error(`No supported video encoder for ${width}x${height}.`);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.mux, width, height, frameRate: fps },
    ...(audio ? { audio: { codec: audio.mux, sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  if (audio) for (const { chunk, meta } of audio.chunks) muxer.addAudioChunk(chunk, meta);

  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure({
    codec: choice.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    ...(choice.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  });

  const frames = Math.round(duration * fps);
  const started = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      await renderer.renderFrame(i / fps, ctx, width, height);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      const done = (i + 1) / frames;
      const elapsed = (performance.now() - started) / 1000;
      opts.onProgress?.(done, i > 5 ? (elapsed / done) * (1 - done) : null);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), codec: audio ? `${choice.codec} + ${audio.codec}` : choice.codec };
}

export const trailreelExporter = { exportMp4, webCodecsAvailable };
