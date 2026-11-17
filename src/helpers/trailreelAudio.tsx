/**
 * Audio engine for Trailreel:
 * - Decode user-uploaded audio (MP3, M4A, WAV, OGG)
 * - Generate royalty-free procedural ambient soundtracks (no external fetches)
 * - Record microphone voiceover narration with live RMS level monitoring
 * - Mix music (with offset, loop, fade in/out) + voiceover (with automatic music ducking)
 * - Identical envelope & mix in live preview and WebCodecs MP4 (AAC/Opus) export
 */
const SAMPLE_RATE = 48_000;
const FADE_IN = 0.4;
const FADE_OUT = 2.5;

export type AmbientPresetId = 'alpine' | 'pulse' | 'horizon';

export interface AudioMixInput {
  music: { buffer: AudioBuffer; volume: number; offset: number } | null;
  voiceover: { buffer: AudioBuffer; volume: number } | null;
}

async function decodeFile(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name}: this browser can't decode that audio file. Try MP3, M4A/AAC, WAV or OGG.`);
  } finally {
    void ctx.close();
  }
}

/** Synthesize a clean 16-second seamless loopable ambient soundtrack bed in OfflineAudioContext. */
async function generatePresetTrack(preset: AmbientPresetId): Promise<AudioBuffer> {
  const dur = 16;
  const off = new OfflineAudioContext(2, SAMPLE_RATE * dur, SAMPLE_RATE);
  const master = off.createGain();
  master.gain.value = 0.35;
  master.connect(off.destination);

  const chords: Record<AmbientPresetId, number[][]> = {
    alpine: [
      [220, 277.18, 329.63, 415.3], // A maj7
      [196, 246.94, 293.66, 369.99], // G maj7
      [174.61, 220, 261.63, 329.63], // F maj7
      [164.81, 207.65, 246.94, 329.63], // E add9
    ],
    pulse: [
      [130.81, 196, 261.63, 311.13], // Cm
      [155.56, 233.08, 311.13, 392], // Eb
      [174.61, 261.63, 349.23, 415.3], // Fm
      [196, 293.66, 392, 466.16], // Gm
    ],
    horizon: [
      [146.83, 220, 293.66, 369.99], // D maj
      [164.81, 246.94, 329.63, 415.3], // E
      [185.0, 277.18, 369.99, 440], // F#m
      [146.83, 220, 293.66, 369.99], // D
    ],
  };

  const seq = chords[preset];
  const bar = dur / seq.length;

  seq.forEach((notes, bi) => {
    const t0 = bi * bar;
    // Warm pad voices
    notes.forEach((freq, ni) => {
      const osc = off.createOscillator();
      osc.type = ni === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const filter = off.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = preset === 'pulse' ? 950 : 720;
      const g = off.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(ni === 0 ? 0.24 : 0.14, t0 + 0.6);
      g.gain.setValueAtTime(ni === 0 ? 0.22 : 0.13, t0 + bar - 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t0 + bar + 0.15);
      osc.connect(filter).connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + bar + 0.2);
    });

    // Gentle melodic arpeggio
    const steps = preset === 'pulse' ? 8 : 4;
    const stepDur = bar / steps;
    for (let s = 0; s < steps; s++) {
      const st = t0 + s * stepDur;
      const f = notes[(s + bi) % notes.length] * 2;
      const osc = off.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = off.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.09, st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, st + stepDur * 0.9);
      osc.connect(g).connect(master);
      osc.start(st);
      osc.stop(st + stepDur);
    }
  });

  return await off.startRendering();
}

/** Envelope shared by preview and export, with optional voiceover ducking window. */
function scheduleMusicEnvelope(
  param: AudioParam,
  startAt: number,
  offset: number,
  duration: number,
  volume: number,
  voiceoverDur: number | null,
) {
  const duck = voiceoverDur && voiceoverDur > 0.1 ? 0.32 : 1.0;
  const env = (t: number) => {
    const base = volume * Math.min(1, t / FADE_IN, Math.max(0, (duration - t) / FADE_OUT));
    if (voiceoverDur && t < voiceoverDur) return base * duck;
    return base;
  };
  const t0 = startAt - offset;
  param.cancelScheduledValues(0);
  param.setValueAtTime(env(offset), startAt);
  if (offset < FADE_IN) {
    const targetVol = voiceoverDur && FADE_IN < voiceoverDur ? volume * duck : volume;
    param.linearRampToValueAtTime(targetVol, t0 + FADE_IN);
  }
  if (voiceoverDur && voiceoverDur > offset && voiceoverDur < duration - FADE_OUT) {
    param.setValueAtTime(volume * duck, t0 + voiceoverDur);
    param.linearRampToValueAtTime(volume, t0 + Math.min(duration - FADE_OUT, voiceoverDur + 0.6));
  }
  const fadeStart = Math.max(offset, duration - FADE_OUT);
  param.setValueAtTime(env(fadeStart), t0 + fadeStart);
  param.linearRampToValueAtTime(0, t0 + duration);
}

/** Preview player supporting music + voiceover synced to video playback time. */
function createMixPlayer() {
  const ctx = new AudioContext();
  let nodes: AudioNode[] = [];
  let sources: AudioBufferSourceNode[] = [];

  return {
    start(mix: AudioMixInput, offset: number, duration: number) {
      this.stop();
      if (offset >= duration) return;
      void ctx.resume();
      const now = ctx.currentTime;
      const voDur = mix.voiceover ? Math.min(duration, mix.voiceover.buffer.duration) : null;

      if (mix.music && mix.music.volume > 0) {
        const src = ctx.createBufferSource();
        src.buffer = mix.music.buffer;
        src.loop = true;
        const gain = ctx.createGain();
        scheduleMusicEnvelope(gain.gain, now, offset, duration, mix.music.volume, voDur);
        src.connect(gain).connect(ctx.destination);
        const startInBuf = (Math.max(0, mix.music.offset) + offset) % mix.music.buffer.duration;
        src.start(now, startInBuf);
        src.stop(now + (duration - offset));
        sources.push(src);
        nodes.push(src, gain);
      }

      if (mix.voiceover && mix.voiceover.volume > 0 && offset < mix.voiceover.buffer.duration) {
        const vSrc = ctx.createBufferSource();
        vSrc.buffer = mix.voiceover.buffer;
        const vGain = ctx.createGain();
        vGain.gain.value = mix.voiceover.volume;
        vSrc.connect(vGain).connect(ctx.destination);
        const remain = Math.min(duration - offset, mix.voiceover.buffer.duration - offset);
        if (remain > 0.01) {
          vSrc.start(now, offset, remain);
          sources.push(vSrc);
          nodes.push(vSrc, vGain);
        }
      }
    },
    stop() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      sources = [];
      nodes = [];
    },
    close() {
      this.stop();
      void ctx.close();
    },
  };
}

/** Microphone voiceover recorder with live RMS level callback. */
function createVoiceRecorder(onLevel: (rms: number) => void) {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let raf = 0;
  let chunks: Blob[] = [];
  let startedAt = 0;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (audioCtx) void audioCtx.close().catch(() => undefined);
    audioCtx = null;
    recorder = null;
    onLevel(0);
  };

  return {
    get recording() {
      return recorder?.state === 'recording';
    },
    get elapsed() {
      return startedAt && recorder?.state === 'recording' ? (performance.now() - startedAt) / 1000 : 0;
    },
    async start() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Microphone recording is not supported in this browser.');
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      audioCtx = new AudioContext();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const poll = () => {
        if (!recorder || recorder.state !== 'recording') return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = (buf[i] - 128) / 128;
          sum += d * d;
        }
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2));
        raf = requestAnimationFrame(poll);
      };
      startedAt = performance.now();
      recorder.start(100);
      poll();
    },
    stop(): Promise<AudioBuffer> {
      return new Promise((resolve, reject) => {
        if (!recorder || recorder.state !== 'recording') {
          cleanup();
          return reject(new Error('Not recording.'));
        }
        const rec = recorder;
        rec.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
            const ctx = new AudioContext();
            try {
              const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
              resolve(decoded);
            } finally {
              void ctx.close();
            }
          } catch (e) {
            reject(e instanceof Error ? e : new Error('Failed to decode recorded voiceover.'));
          } finally {
            cleanup();
          }
        };
        rec.stop();
      });
    },
    cancel() {
      if (recorder?.state === 'recording') recorder.stop();
      cleanup();
    },
  };
}

export interface EncodedAudio {
  mux: 'aac' | 'opus';
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  chunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[];
}

function audioEncodingAvailable(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
}

/** Render the combined music + voiceover mix for `duration` seconds and encode (AAC preferred, Opus fallback). */
async function encodeMix(mix: AudioMixInput, duration: number): Promise<EncodedAudio | null> {
  if (!mix.music && !mix.voiceover) return null;
  if (!audioEncodingAvailable()) throw new Error('This browser cannot encode audio (no WebCodecs AudioEncoder).');
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  const voDur = mix.voiceover ? Math.min(duration, mix.voiceover.buffer.duration) : null;

  if (mix.music && mix.music.volume > 0) {
    const src = off.createBufferSource();
    src.buffer = mix.music.buffer;
    src.loop = true;
    const gain = off.createGain();
    scheduleMusicEnvelope(gain.gain, 0, 0, duration, mix.music.volume, voDur);
    src.connect(gain).connect(off.destination);
    src.start(0, Math.max(0, mix.music.offset) % mix.music.buffer.duration);
  }

  if (mix.voiceover && mix.voiceover.volume > 0) {
    const vSrc = off.createBufferSource();
    vSrc.buffer = mix.voiceover.buffer;
    const vGain = off.createGain();
    vGain.gain.value = mix.voiceover.volume;
    vSrc.connect(vGain).connect(off.destination);
    vSrc.start(0, 0, Math.min(duration, mix.voiceover.buffer.duration));
  }

  const rendered = await off.startRendering();

  const candidates: [string, 'aac' | 'opus'][] = [
    ['mp4a.40.2', 'aac'],
    ['opus', 'opus'],
  ];
  let chosen: [string, 'aac' | 'opus'] | null = null;
  for (const c of candidates) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({ codec: c[0], sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });
      if (supported) {
        chosen = c;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!chosen) throw new Error('No supported audio encoder (AAC or Opus) in this browser.');

  const chunks: EncodedAudio['chunks'] = [];
  let error: unknown = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => chunks.push({ chunk, meta }), error: (e) => (error = e) });
  encoder.configure({ codec: chosen[0], sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  const block = 4800;
  for (let i = 0; i < frames; i += block) {
    const n = Math.min(block, frames - i);
    const data = new Float32Array(n * 2);
    data.set(left.subarray(i, i + n), 0);
    data.set(right.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data });
    encoder.encode(ad);
    ad.close();
  }
  await encoder.flush();
  encoder.close();
  if (error) throw error;
  return { mux: chosen[1], codec: chosen[0], sampleRate: SAMPLE_RATE, numberOfChannels: 2, chunks };
}

export const trailreelAudio = {
  decodeFile,
  generatePresetTrack,
  createMixPlayer,
  createVoiceRecorder,
  encodeMix,
  audioEncodingAvailable,
};
