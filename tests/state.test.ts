import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  normalizeState,
  offlineReport,
  parseSave,
  serializeState,
} from '../src/core/state';
import { clearSave, readSave, writeSave, type StorageLike } from '../src/core/storage';
import { loadContent } from '../src/core/content';

const content = loadContent();
const config = content.config;

describe('начальное состояние', () => {
  it('создаётся с нулём и включённым звуком', () => {
    const state = createInitialState(config, 42);
    expect(state.coins).toBe(config.startCoins);
    expect(state.totalEarned).toBe(config.startCoins);
    expect(state.soundOn).toBe(true);
    expect(state.particlesOn).toBe(true);
    expect(state.won).toBe(false);
    expect(state.rngSeed).toBe(42);
    expect(state.worldPriceSeed).toBe(42);
  });
});

describe('нормализация сохранения', () => {
  it('читает корректный сейв без потерь', () => {
    const original = createInitialState(config, 7);
    original.coins = 12345;
    original.levels = { t_well: 3, d1_blade: 2 };
    original.flowControl.export = { mode: 'fixed', value: 12.5 };
    const restored = normalizeState(JSON.parse(serializeState(original)), config, content);
    expect(restored.coins).toBe(12345);
    expect(restored.levels).toEqual({ t_well: 3, d1_blade: 2 });
    expect(restored.flowControl.export).toEqual({ mode: 'fixed', value: 12.5 });
  });

  it('старый сейв получает постоянный seed цены из RNG seed', () => {
    const legacy = createInitialState(config, 987654);
    const oldState = { ...legacy } as unknown as Record<string, unknown>;
    delete oldState.worldPriceSeed;
    const restored = normalizeState(oldState, config, content);
    expect(restored.worldPriceSeed).toBe(legacy.rngSeed);
  });

  it('выбрасывает мусор и неизвестные покупки', () => {
    const restored = normalizeState(
      {
        coins: -50,
        levels: { t_well: 3, несуществующая: 99, d1_blade: -2 },
        achievements: ['a_first', 123, null],
        gambles: [{ id: 'нет-такой', amount: 5 }],
      },
      config,
      content,
    );
    expect(restored.coins).toBe(0);
    expect(Object.keys(restored.levels)).toEqual(['t_well']);
    expect(restored.achievements).toEqual(['a_first']);
    expect(restored.gambles).toEqual([]);
  });

  it('обрезает уровни по maxLevel', () => {
    const def = content.byId.get('l_boat');
    const restored = normalizeState({ levels: { l_boat: 999 } }, config, content);
    expect(restored.levels.l_boat).toBe(def?.maxLevel ?? 1);
  });

  it('переживает мусор вместо JSON', () => {
    expect(normalizeState(null, config, content).coins).toBe(0);
    expect(normalizeState('строка', config, content).coins).toBe(0);
    expect(normalizeState(42, config, content).coins).toBe(0);
    expect(parseSave('{битый json')).toBeNull();
    expect(parseSave('{"ok":1}')).toEqual({ ok: 1 });
  });

  it('мигрирует старые id достижений за тап в достижения за проданные тонны', () => {
    const restored = normalizeState(
      { achievements: ['a_tap100', 'a_tap1000', 'a_sold_1000'] },
      config,
      content,
    );
    expect(restored.achievements).toEqual(['a_sold_1000', 'a_sold_100000']);
  });

  it('не теряет достижения и флаг победы', () => {
    const restored = normalizeState(
      { achievements: ['a_first', 'a_win'], won: true, wonAtMs: 1000 },
      config,
      content,
    );
    expect(restored.won).toBe(true);
    expect(restored.wonAtMs).toBe(1000);
    expect(restored.achievements).toHaveLength(2);
  });
});

describe('офлайн-доход', () => {
  it('начисляется не больше 5 минут', () => {
    const report = offlineReport(config, 100, 0, 60 * 60 * 1000);
    expect(report.capped).toBe(true);
    expect(report.seconds).toBe(config.offline.capSeconds);
    expect(report.coins).toBe(100 * config.offline.capSeconds);
  });

  it('считает реальное время, если оно меньше потолка', () => {
    const report = offlineReport(config, 10, 0, 60000);
    expect(report.capped).toBe(false);
    expect(report.seconds).toBe(60);
    expect(report.coins).toBe(600);
  });

  it('терпит перевод часов назад и нулевой доход', () => {
    expect(offlineReport(config, 10, 50000, 1000).coins).toBe(0);
    expect(offlineReport(config, 0, 0, 60000).coins).toBe(0);
  });
});

describe('localStorage-обёртка', () => {
  function memoryStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
  }

  it('пишет, читает и стирает', () => {
    const storage = memoryStorage();
    expect(readSave(storage)).toBeNull();
    expect(writeSave('{"a":1}', storage)).toBe(true);
    expect(readSave(storage)).toBe('{"a":1}');
    clearSave(storage);
    expect(readSave(storage)).toBeNull();
  });

  it('не падает без хранилища (приватный режим)', () => {
    expect(readSave(null)).toBeNull();
    expect(writeSave('x', null)).toBe(false);
    expect(() => clearSave(null)).not.toThrow();
  });
});
