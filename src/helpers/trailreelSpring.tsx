/**
 * Apple-style fluid physics & gesture utilities (WWDC "Designing Fluid Interfaces"):
 * - Interruptible springs parameterized by (dampingRatio, response)
 * - Velocity handoff & velocity-preserving re-targeting
 * - Exponential-decay momentum projection (for flick-to-snap gestures; not used by the scrubber)
 * - Progressive rubber-band boundary resistance
 * - 1:1 Pointer Events tracking with setPointerCapture
 */

export interface SpringOptions {
  /** 1.0 = critically damped (no bounce), ~0.8 = slight momentum overshoot */
  damping?: number;
  /** Time scale in seconds (lower = snappier, typical 0.25–0.45) */
  response?: number;
  /** Optional handoff velocity in units/sec */
  velocity?: number;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Apple's exponential-decay momentum projection: where the gesture is going. */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive boundary resistance: real things slow down smoothly before stopping. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  const safeDim = Math.max(1, dimension);
  return (overshoot * safeDim * constant) / (safeDim + constant * Math.abs(overshoot));
}

export interface SpringController {
  readonly value: number;
  readonly velocity: number;
  setTarget(target: number, opts?: SpringOptions): void;
  snap(value: number): void;
  stop(): void;
}

/**
 * Interruptible 1D spring that runs on requestAnimationFrame.
 * Calling setTarget() mid-flight preserves live presentation value and current velocity,
 * preventing the "brick wall" velocity cut when reversing a gesture.
 */
export function createSpring(initial: number, onUpdate: (value: number, settled: boolean) => void): SpringController {
  let x = initial;
  let v = 0;
  let target = initial;
  let damping = 1.0;
  let response = 0.35;
  let raf = 0;
  let lastTs = 0;
  let running = false;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    running = false;
    lastTs = 0;
  };

  const step = (ts: number) => {
    if (!running) return;
    const dt = lastTs ? Math.min(0.032, Math.max(0.001, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;

    // Sub-step integration for stability even with snappy response values
    const sub = 4;
    const h = dt / sub;
    const omega = (2 * Math.PI) / Math.max(0.05, response);
    const k = omega * omega;
    const c = 2 * damping * omega;

    for (let i = 0; i < sub; i++) {
      const a = -k * (x - target) - c * v;
      v += a * h;
      x += v * h;
    }

    if (Math.abs(target - x) < 0.0005 && Math.abs(v) < 0.005) {
      x = target;
      v = 0;
      running = false;
      raf = 0;
      lastTs = 0;
      onUpdate(x, true);
      return;
    }

    onUpdate(x, false);
    raf = requestAnimationFrame(step);
  };

  return {
    get value() {
      return x;
    },
    get velocity() {
      return v;
    },
    setTarget(nextTarget: number, opts?: SpringOptions) {
      target = nextTarget;
      if (opts?.damping != null) damping = opts.damping;
      if (opts?.response != null) response = opts.response;
      if (opts?.velocity != null) v = opts.velocity;

      if (prefersReducedMotion()) {
        stop();
        x = target;
        v = 0;
        onUpdate(x, true);
        return;
      }

      if (!running) {
        running = true;
        lastTs = 0;
        raf = requestAnimationFrame(step);
      }
    },
    snap(value: number) {
      stop();
      x = value;
      target = value;
      v = 0;
      onUpdate(x, true);
    },
    stop,
  };
}

export interface ScrubberOptions {
  /** Called continuously during the 1:1 drag with the normalized 0..1 fraction; `dragging` is false on release */
  onScrub: (fraction: number, dragging: boolean) => void;
  /** Optional rubberband feedback when dragging past edges (-overshoot..+overshoot px) */
  onOvershoot?: (px: number) => void;
}

/**
 * 1:1 Pointer Events scrubber with pointer capture and rubber-band edge resistance.
 * A media timeline is a precision control: the playhead stops exactly where the finger lets go,
 * so there is deliberately no momentum projection here (that is for throwing things to snap points).
 */
export function attachPointerScrubber(el: HTMLElement, opts: ScrubberOptions): () => void {
  let pointerId: number | null = null;
  let dragging = false;
  let currentF = 0;

  const fractionForX = (clientX: number) => {
    const rect = el.getBoundingClientRect();
    const raw = (clientX - rect.left) / Math.max(1, rect.width);
    return { raw, rect };
  };

  const track = (clientX: number) => {
    const { raw, rect } = fractionForX(clientX);
    // Soft edges, unless the user asked for less motion: then the control simply stops at the end.
    if (prefersReducedMotion() || (raw >= 0 && raw <= 1)) opts.onOvershoot?.(0);
    else if (raw < 0) opts.onOvershoot?.(rubberband(raw * rect.width, rect.width, 0.35));
    else opts.onOvershoot?.(rubberband((raw - 1) * rect.width, rect.width, 0.35));
    currentF = Math.min(1, Math.max(0, raw));
    opts.onScrub(currentF, true);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    dragging = true;
    el.dataset.active = 'true';
    track(e.clientX);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    track(e.clientX);
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    delete el.dataset.active;
    opts.onOvershoot?.(0);
    opts.onScrub(currentF, false);
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', endDrag);
    el.removeEventListener('pointercancel', endDrag);
  };
}
