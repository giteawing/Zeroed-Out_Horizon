// @vitest-environment happy-dom
/**
 * REVIEW A8: звук, включённый после старта с выключенным звуком, должен
 * заработать без перезагрузки страницы.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundEngine } from '../../src/audio/sound';

interface FakeParam {
  value: number;
  setValueAtTime: () => void;
  linearRampToValueAtTime: () => void;
  exponentialRampToValueAtTime: () => void;
}

const param = (): FakeParam => ({
  value: 0,
  setValueAtTime: () => {},
  linearRampToValueAtTime: () => {},
  exponentialRampToValueAtTime: () => {},
});

function installAudio(): { created: () => number; oscillators: () => number; last: () => FakeContext | null } {
  let created = 0;
  let oscillators = 0;
  let last: FakeContext | null = null;
  const node = () => {
    const self = { connect: (next: unknown) => next ?? self };
    return self;
  };
  class FakeAudioContext {
    state: 'running' | 'suspended' = 'running';
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    resume = vi.fn(() => { this.state = 'running'; return Promise.resolve(); });
    suspend = vi.fn(() => { this.state = 'suspended'; return Promise.resolve(); });
    constructor() {
      created++;
      last = this as unknown as FakeContext;
    }
    createGain() {
      return { ...node(), gain: param() };
    }
    createOscillator() {
      oscillators++;
      return { ...node(), type: 'sine', frequency: param(), start: () => {}, stop: () => {} };
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  return { created: () => created, oscillators: () => oscillators, last: () => last };
}

interface FakeContext {
  state: 'running' | 'suspended';
  resume: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('звуковой движок', () => {
  it('при выключенном звуке не создаёт аудиоконтекст', () => {
    const audio = installAudio();
    const engine = new SoundEngine(false);
    engine.unlock();
    engine.purchase();
    expect(audio.created()).toBe(0);
    expect(audio.oscillators()).toBe(0);
  });

  it('включение после старта с выключенным звуком создаёт контекст и звучит', () => {
    const audio = installAudio();
    const engine = new SoundEngine(false);
    // Стартовый клик: звук выключен, контекст не создаётся.
    engine.unlock();
    expect(audio.created()).toBe(0);

    // Игрок включил звук в настройках — это тоже пользовательский жест.
    engine.setEnabled(true);
    expect(engine.isEnabled).toBe(true);
    expect(audio.created()).toBe(1);

    engine.purchase();
    expect(audio.oscillators()).toBeGreaterThan(0);
  });

  it('выключение приостанавливает контекст, повторное включение возобновляет тот же', () => {
    const audio = installAudio();
    const engine = new SoundEngine(true);
    engine.unlock();
    expect(audio.created()).toBe(1);
    const ctx = audio.last();
    expect(ctx).not.toBeNull();

    engine.setEnabled(false);
    expect(ctx!.suspend).toHaveBeenCalledTimes(1);
    const before = audio.oscillators();
    engine.purchase();
    expect(audio.oscillators()).toBe(before);

    engine.setEnabled(true);
    expect(ctx!.resume).toHaveBeenCalledTimes(1);
    expect(audio.created()).toBe(1);
  });

  it('без Web Audio включение звука не падает', () => {
    vi.stubGlobal('AudioContext', undefined);
    (window as unknown as { AudioContext: unknown }).AudioContext = undefined;
    const engine = new SoundEngine(false);
    expect(() => engine.setEnabled(true)).not.toThrow();
    expect(() => engine.purchase()).not.toThrow();
  });
});
