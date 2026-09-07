const MUSIC_MIX = 0.18;
const TRACK_BEATS = 32;
const SECONDS_PER_BEAT = 60 / 112;

interface StereoTrack {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly duration: number;
}

type Note = readonly [beat: number, midi: number, length: number, pan: number];

const MELODY: readonly Note[] = [
  [0, 74, 0.42, -0.35], [0.75, 77, 0.38, 0.25], [1.5, 81, 0.4, -0.1],
  [2.25, 80, 0.24, 0.35], [2.75, 79, 0.48, -0.2], [3.5, 77, 0.34, 0.3],
  [4, 76, 0.34, -0.3], [4.5, 73, 0.3, 0.2], [5, 74, 0.72, -0.1],
  [6.25, 69, 0.38, 0.3], [7, 72, 0.3, -0.25], [7.5, 73, 0.28, 0.25],
  [8, 74, 0.42, -0.35], [8.75, 77, 0.38, 0.25], [9.5, 82, 0.42, -0.1],
  [10.25, 81, 0.25, 0.35], [10.75, 76, 0.42, -0.2], [11.5, 79, 0.34, 0.3],
  [12, 77, 0.38, -0.3], [12.75, 74, 0.32, 0.2], [13.25, 73, 0.28, -0.15],
  [13.75, 74, 0.62, 0.25], [14.75, 69, 0.32, -0.25], [15.5, 73, 0.28, 0.25],
  [16, 74, 0.36, 0.3], [16.5, 77, 0.34, -0.25], [17, 81, 0.38, 0.2],
  [17.75, 84, 0.38, -0.2], [18.5, 83, 0.24, 0.3], [19, 81, 0.46, -0.25],
  [19.75, 77, 0.26, 0.2], [20.25, 76, 0.32, -0.3], [20.75, 73, 0.28, 0.25],
  [21.25, 74, 0.7, -0.1], [22.5, 72, 0.28, 0.3], [23, 73, 0.28, -0.25],
  [23.5, 74, 0.3, 0.2], [24, 77, 0.38, -0.3], [24.75, 81, 0.38, 0.25],
  [25.5, 82, 0.36, -0.1], [26.25, 81, 0.25, 0.35], [26.75, 79, 0.42, -0.2],
  [27.5, 76, 0.32, 0.3], [28, 77, 0.34, -0.3], [28.5, 74, 0.3, 0.25],
  [29, 73, 0.26, -0.15], [29.5, 72, 0.28, 0.25], [30, 73, 0.3, -0.25],
  [30.5, 74, 0.68, 0.1],
];

const BASS: readonly number[] = [
  38, 45, 41, 44, 38, 45, 36, 37,
  38, 41, 43, 45, 41, 38, 45, 37,
  38, 45, 41, 44, 38, 45, 36, 37,
  43, 46, 45, 40, 41, 38, 45, 37,
];

/**
 * Render a seamless, deterministic loop for the Web Audio buffer. Keeping the
 * score in code avoids a network fetch and matches the game's procedural art.
 */
export function renderMischiefTrack(sampleRate: number): StereoTrack {
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000) {
    throw new RangeError("Audio sample rate must be at least 8000 Hz.");
  }

  const duration = TRACK_BEATS * SECONDS_PER_BEAT;
  const sampleCount = Math.ceil(duration * sampleRate);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);

  for (const [beat, midi, length, pan] of MELODY) {
    addPluck(left, right, sampleRate, beat * SECONDS_PER_BEAT, length * SECONDS_PER_BEAT,
      midiFrequency(midi), 0.22, pan, "melody");
  }

  BASS.forEach((midi, beat) => {
    addPluck(left, right, sampleRate, beat * SECONDS_PER_BEAT, 0.7 * SECONDS_PER_BEAT,
      midiFrequency(midi), 0.13, beat % 2 === 0 ? -0.08 : 0.08, "bass");
  });

  // Quiet off-beat dyads give the melody a tiptoeing, cartoon-heist pulse.
  const harmonyRoots = [62, 65, 67, 69, 62, 65, 67, 61] as const;
  harmonyRoots.forEach((root, bar) => {
    const start = (bar * 4 + 1.5) * SECONDS_PER_BEAT;
    addPluck(left, right, sampleRate, start, 0.38 * SECONDS_PER_BEAT,
      midiFrequency(root), 0.055, -0.45, "bass");
    addPluck(left, right, sampleRate, start, 0.38 * SECONDS_PER_BEAT,
      midiFrequency(root + 7), 0.045, 0.45, "bass");
  });

  for (let beat = 0; beat < TRACK_BEATS; beat += 1) {
    addTick(left, right, sampleRate, (beat + 0.5) * SECONDS_PER_BEAT, beat % 2 === 0 ? 0.25 : -0.25);
  }

  normalize(left, right, 0.82);
  return { left, right, duration };
}

export class TinyAudio {
  private context: AudioContext | null = null;
  private effectsOutput: GainNode | null = null;
  private musicOutput: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private effectsVolume = 0.64;
  private musicVolume = 0.063;
  private musicPaused = false;

  setVolume(master: number, effects: number, music: number): void {
    this.effectsVolume = clampUnit(master) * clampUnit(effects);
    this.musicVolume = clampUnit(master) * clampUnit(music) * MUSIC_MIX;
    if (!this.context) return;
    const now = this.context.currentTime;
    this.effectsOutput?.gain.setTargetAtTime(this.effectsVolume, now, 0.02);
    this.musicOutput?.gain.setTargetAtTime(this.musicPaused ? 0 : this.musicVolume, now, 0.08);
  }

  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
  }

  startMusic(): void {
    const context = this.getContext();
    if (!context || this.musicSource) return;

    const track = renderMischiefTrack(context.sampleRate);
    const buffer = context.createBuffer(2, track.left.length, context.sampleRate);
    buffer.getChannelData(0).set(track.left);
    buffer.getChannelData(1).set(track.right);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopEnd = track.duration;
    source.connect(this.getMusicOutput(context));
    source.onended = () => {
      if (this.musicSource === source) this.musicSource = null;
    };
    this.musicSource = source;
    source.start(context.currentTime + 0.03);
  }

  setPaused(paused: boolean): void {
    this.musicPaused = paused;
    if (!this.context || !this.musicOutput) return;
    this.musicOutput.gain.setTargetAtTime(
      paused ? 0 : this.musicVolume,
      this.context.currentTime,
      paused ? 0.08 : 0.16,
    );
  }

  stopMusic(): void {
    const source = this.musicSource;
    if (!this.context || !this.musicOutput || !source) return;
    const now = this.context.currentTime;
    this.musicOutput.gain.cancelScheduledValues(now);
    this.musicOutput.gain.setValueAtTime(this.musicOutput.gain.value, now);
    this.musicOutput.gain.linearRampToValueAtTime(0, now + 0.45);
    source.stop(now + 0.48);
  }

  meow(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(480, now);
    oscillator.frequency.exponentialRampToValueAtTime(650, now + 0.12);
    oscillator.frequency.exponentialRampToValueAtTime(270, now + 0.42);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
    oscillator.connect(gain).connect(this.getEffectsOutput(ctx));
    oscillator.start(now);
    oscillator.stop(now + 0.48);
  }

  crash(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.18);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    source.connect(filter).connect(gain).connect(this.getEffectsOutput(ctx));
    source.start(now);
  }

  success(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.12, 0.26].forEach((offset, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = [440, 554, 659][index] ?? 440;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
      oscillator.connect(gain).connect(this.getEffectsOutput(ctx));
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.32);
    });
  }

  private getContext(): AudioContext | null {
    this.unlock();
    return this.context;
  }

  private getEffectsOutput(context: AudioContext): GainNode {
    if (!this.effectsOutput) {
      this.effectsOutput = context.createGain();
      this.effectsOutput.gain.value = this.effectsVolume;
      this.effectsOutput.connect(context.destination);
    }
    return this.effectsOutput;
  }

  private getMusicOutput(context: AudioContext): GainNode {
    if (!this.musicOutput) {
      this.musicOutput = context.createGain();
      this.musicOutput.gain.value = this.musicPaused ? 0 : this.musicVolume;
      this.musicOutput.connect(context.destination);
    }
    return this.musicOutput;
  }
}

function addPluck(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  start: number,
  duration: number,
  frequency: number,
  amplitude: number,
  pan: number,
  voice: "melody" | "bass",
): void {
  const firstSample = Math.max(0, Math.floor(start * sampleRate));
  const lastSample = Math.min(left.length, Math.ceil((start + duration) * sampleRate));
  const leftPan = Math.sqrt((1 - pan) * 0.5);
  const rightPan = Math.sqrt((1 + pan) * 0.5);

  for (let sample = firstSample; sample < lastSample; sample += 1) {
    const time = sample / sampleRate - start;
    const progress = time / duration;
    const attack = Math.min(1, time / 0.008);
    const envelope = attack * (1 - progress) ** (voice === "melody" ? 2.4 : 1.7);
    const phase = Math.PI * 2 * frequency * time;
    const tone = voice === "melody"
      ? Math.sin(phase) + Math.sin(phase * 2) * 0.32 + Math.sin(phase * 3) * 0.12
      : Math.sin(phase) + Math.sin(phase * 2) * 0.2;
    const value = tone * envelope * amplitude;
    left[sample] = (left[sample] ?? 0) + value * leftPan;
    right[sample] = (right[sample] ?? 0) + value * rightPan;
  }
}

function addTick(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  start: number,
  pan: number,
): void {
  const duration = 0.045;
  const firstSample = Math.floor(start * sampleRate);
  const lastSample = Math.min(left.length, Math.ceil((start + duration) * sampleRate));
  const leftPan = Math.sqrt((1 - pan) * 0.5);
  const rightPan = Math.sqrt((1 + pan) * 0.5);
  for (let sample = firstSample; sample < lastSample; sample += 1) {
    const time = sample / sampleRate - start;
    const envelope = Math.exp(-time * 95) * Math.min(1, time / 0.0015);
    const value = Math.sin(Math.PI * 2 * 1_450 * time) * envelope * 0.025;
    left[sample] = (left[sample] ?? 0) + value * leftPan;
    right[sample] = (right[sample] ?? 0) + value * rightPan;
  }
}

function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function normalize(left: Float32Array, right: Float32Array, ceiling: number): void {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index] ?? 0), Math.abs(right[index] ?? 0));
  }
  if (peak <= ceiling) return;
  const scale = ceiling / peak;
  for (let index = 0; index < left.length; index += 1) {
    left[index] = (left[index] ?? 0) * scale;
    right[index] = (right[index] ?? 0) * scale;
  }
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
