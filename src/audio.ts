export class TinyAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private volume = 0.64;

  setVolume(master: number, effects: number): void {
    this.volume = Math.max(0, Math.min(1, master * effects));
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
  }

  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
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
    oscillator.connect(gain).connect(this.getOutput(ctx));
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
    source.connect(filter).connect(gain).connect(this.getOutput(ctx));
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
      oscillator.connect(gain).connect(this.getOutput(ctx));
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.32);
    });
  }

  private getContext(): AudioContext | null {
    this.unlock();
    return this.context;
  }

  private getOutput(context: AudioContext): GainNode {
    if (!this.output) {
      this.output = context.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(context.destination);
    }
    return this.output;
  }
}
