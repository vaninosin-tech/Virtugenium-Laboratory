import { useSettingsStore } from "../../../shared/lib/useSettingsStore";

/**
 * Procedural lab sound: every sound is synthesised from noise and short
 * envelopes with WebAudio — the project ships no audio files (ToR: no new
 * assets), and a fizz or a flame is noise anyway.
 *
 * The AudioContext is created lazily on the first user gesture: browsers
 * (and WebView2) refuse to start audio before one, and a context created
 * too early stays suspended.
 */

export interface LabAmbience {
  /** 0..1 — spirit burner flame hiss. */
  readonly burner: number;
  /** 0..1 — reaction fizz (bubbles through the liquid), from the tube's `rate`. */
  readonly fizz: number;
  /** 0..1 — boiling bubbles, from the contents' temperature. */
  readonly boil: number;
}

export type LabOneShot = "pour" | "crack";

interface Voice {
  readonly gain: GainNode;
}

interface Engine {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly burner: Voice;
  readonly fizz: Voice;
  readonly boil: Voice;
  readonly noise: AudioBuffer;
}

let engine: Engine | null = null;
let unlockInstalled = false;
let lastBlipAt = 0;

const noiseBuffer = (context: AudioContext, seconds: number): AudioBuffer => {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
};

/** A looping noise bed through a filter, silent until its gain is raised. */
const makeBed = (
  context: AudioContext,
  noise: AudioBuffer,
  destination: AudioNode,
  filterType: BiquadFilterType,
  frequency: number,
  q: number,
): Voice => {
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(destination);
  source.start();
  return { gain };
};

const createEngine = (): Engine | null => {
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  const master = context.createGain();
  master.connect(context.destination);
  const noise = noiseBuffer(context, 2);
  return {
    context,
    master,
    noise,
    // A flame is a soft, dark roar — low-passed noise.
    burner: makeBed(context, noise, master, "lowpass", 420, 0.7),
    // Fizz: the bright hiss of many small bubbles bursting.
    fizz: makeBed(context, noise, master, "bandpass", 5200, 0.9),
    // Boiling: a lower, throatier rumble.
    boil: makeBed(context, noise, master, "bandpass", 520, 1.4),
  };
};

/** Installs the one-time gesture listener that creates/resumes the context. */
export const installLabAudioUnlock = (): void => {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    if (!engine) engine = createEngine();
    void engine?.context.resume();
  };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
};

const masterLevel = () => {
  const { volume, muted } = useSettingsStore.getState();
  return muted ? 0 : volume / 100;
};

/** A single bubble pop: a short band-passed noise click at a random pitch. */
const blip = (e: Engine, level: number, low: number, high: number) => {
  const { context } = e;
  const source = context.createBufferSource();
  source.buffer = e.noise;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = low + Math.random() * (high - low);
  filter.Q.value = 6;
  const gain = context.createGain();
  const now = context.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(level, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05 + Math.random() * 0.05);
  source.connect(filter).connect(gain).connect(e.master);
  source.start(now, Math.random() * 1.5, 0.12);
};

/**
 * Called every frame with what the scene is doing. Levels glide rather than
 * jump (`setTargetAtTime`), and the fizz gets individual bubble pops on top
 * of its hiss, more often the harder the reaction runs — a steady hiss alone
 * reads as a radio between stations, not as bubbles.
 */
export const updateLabAmbience = (ambience: LabAmbience): void => {
  const e = engine;
  if (!e || e.context.state !== "running") return;
  const now = e.context.currentTime;
  e.master.gain.setTargetAtTime(masterLevel(), now, 0.05);
  e.burner.gain.gain.setTargetAtTime(ambience.burner * 0.05, now, 0.3);
  e.fizz.gain.gain.setTargetAtTime(ambience.fizz * 0.035, now, 0.15);
  e.boil.gain.gain.setTargetAtTime(ambience.boil * 0.06, now, 0.4);

  const popsPerSecond = ambience.fizz * 28 + ambience.boil * 10;
  if (popsPerSecond > 0.2 && now - lastBlipAt > (1 / popsPerSecond) * (0.4 + Math.random() * 1.2)) {
    lastBlipAt = now;
    const boilingPop = Math.random() < ambience.boil / (ambience.fizz + ambience.boil + 1e-6);
    if (boilingPop) blip(e, 0.16, 250, 900);
    else blip(e, 0.08 + ambience.fizz * 0.06, 1800, 6500);
  }
};

export const playLabSound = (sound: LabOneShot): void => {
  const e = engine;
  if (!e || e.context.state !== "running") return;
  const { context } = e;
  const now = context.currentTime;

  if (sound === "pour") {
    // A short trickle: a glide of band-passed noise with a few drops on top.
    const source = context.createBufferSource();
    source.buffer = e.noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.linearRampToValueAtTime(1800, now + 0.6);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.08);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.7);
    source.connect(filter).connect(gain).connect(e.master);
    source.start(now, 0, 0.75);
    for (let i = 0; i < 4; i++) setTimeout(() => blip(e, 0.05, 700, 2200), 120 + i * 110 + Math.random() * 60);
    return;
  }

  // Glass cracking: a sharp high tick, then a brittle crackle that dies fast.
  const tick = context.createOscillator();
  tick.type = "triangle";
  tick.frequency.setValueAtTime(3400, now);
  tick.frequency.exponentialRampToValueAtTime(900, now + 0.08);
  const tickGain = context.createGain();
  tickGain.gain.setValueAtTime(0.25, now);
  tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  tick.connect(tickGain).connect(e.master);
  tick.start(now);
  tick.stop(now + 0.15);
  for (let i = 0; i < 9; i++) setTimeout(() => blip(e, 0.18 - i * 0.015, 2500, 8000), 20 + i * 25 + Math.random() * 30);
};
