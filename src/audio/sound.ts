/**
 * Звук на Web Audio API: всё синтезируется, файлов нет — вопросов с
 * лицензиями тоже (ТЗ §8.2).
 *
 * Правила:
 *   • AudioContext создаётся/возобновляется ТОЛЬКО внутри пользовательского
 *     жеста (pointerdown) — иначе iOS/Safari молчит;
 *   • на тап — короткий «дзынь» с 4 вариациями высоты;
 *   • на покупку — касса, на событие — сирена, на победу — фанфары;
 *   • при выключенном звуке не создаём ни одного узла (экономия батареи).
 */

type Ctx = AudioContext;

export class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed: Record<string, number> = {};

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.ctx) {
      void this.ctx.suspend();
    } else if (enabled && this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Вызывать из обработчика pointerdown/click — это требование браузеров. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Покупка: кассовый «ча-чинг». */
  purchase(): void {
    const ctx = this.ready('purchase');
    if (!ctx) return;
    const now = ctx.currentTime;
    this.blip(ctx, 1180, now, 0.06, 'square', 0.1);
    this.blip(ctx, 1560, now + 0.07, 0.12, 'square', 0.1);
    this.blip(ctx, 2080, now + 0.14, 0.16, 'sine', 0.08);
  }

  /** Крупное событие: сирена + гудок. */
  event(win = true): void {
    const ctx = this.ready('event');
    if (!ctx) return;
    const now = ctx.currentTime;
    if (win) {
      this.sweep(ctx, 320, 880, now, 0.5, 0.12);
    } else {
      this.sweep(ctx, 700, 220, now, 0.4, 0.14);
    }
    this.noise(ctx, now, 0.3, 0.05, 400);
  }

  /** Достижение / мелкая награда. */
  coin(): void {
    const ctx = this.ready('coin');
    if (!ctx) return;
    const now = ctx.currentTime;
    this.blip(ctx, 1320, now, 0.07, 'triangle', 0.1);
    this.blip(ctx, 1760, now + 0.06, 0.1, 'triangle', 0.08);
  }

  /** Победа: короткие фанфары. */
  fanfare(): void {
    const ctx = this.ready('fanfare');
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, index) => {
      this.blip(ctx, freq, now + index * 0.14, 0.28, 'sawtooth', 0.09);
      this.blip(ctx, freq * 2, now + index * 0.14, 0.2, 'sine', 0.05);
    });
    this.noise(ctx, now + 0.56, 0.5, 0.05, 2400);
  }

  // ------------------------------------------------------------------ служебное

  /** Не даём спамить одним и тем же звуком чаще, чем раз в N мс. */
  private ready(key: string, minIntervalMs = 35): Ctx | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = this.lastPlayed[key] ?? 0;
    if (now - last < minIntervalMs) return null;
    this.lastPlayed[key] = now;
    return this.ctx;
  }

  private blip(
    ctx: Ctx,
    freq: number,
    at: number,
    duration: number,
    type: OscillatorType,
    gain: number,
  ): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.86), at + duration);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private sweep(ctx: Ctx, from: number, to: number, at: number, duration: number, gain: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.linearRampToValueAtTime(to, at + duration);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }

  /** Короткий шумовой слой для звуковых событий без внешних файлов. */
  private noise(ctx: Ctx, at: number, duration: number, gain: number, cutoff: number): void {
    if (!this.master) return;
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.5);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(env).connect(this.master);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
}
