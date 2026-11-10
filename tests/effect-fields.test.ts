/**
 * REVIEW A4: поле `effect`, которое ядро не читает, — обещание без механики.
 * Три постройки сбыта несли `exportBonus`, который учитывается только у
 * пассивных покупок, а описание терминала обещало усилить контрабанду.
 *
 * Защита замкнута с двух сторон:
 *  1. `EFFECT_FIELDS` в `content.ts` перечисляет поля, разрешённые каждому
 *     типу покупки: контент с лишним полем не загружается;
 *  2. здесь каждое поле каждой карточки меняется, и игра обязана это
 *     заметить. Поле, которое ядро перестало читать, роняет тест, а строку
 *     таблицы без единой карточки нечем подтвердить — её быть не должно.
 */
import { describe, expect, it } from 'vitest';
import { EFFECT_FIELDS, loadContent, validateUpgrades } from '../src/core/content';
import { bankScaleOf, computeDerived } from '../src/core/economy';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';
import type {
  Content,
  GameEvent,
  GameState,
  UpgradeDef,
  UpgradeEffect,
} from '../src/core/types';

const real = loadContent();

/**
 * Возможности ядра, которыми боевые карточки сейчас не пользуются.
 * Без такой карточки строку таблицы пришлось бы удалить.
 */
const EXTRA_CARDS: UpgradeDef[] = [
  {
    id: 'probe_scope',
    tab: 'technical',
    group: 'test',
    name: 'Проба: множитель только оборудования',
    description: 'Проверочная карточка, в игре её нет.',
    icon: 'well',
    type: 'multiplier',
    baseCost: 100,
    maxLevel: 5,
    effect: { factor: 2, scope: 'production' },
  },
];

function contentOf(upgrades: UpgradeDef[]): Content {
  return { ...real, upgrades, byId: new Map(upgrades.map((def) => [def.id, def])) };
}

const base = contentOf([...real.upgrades, ...EXTRA_CARDS]);

/**
 * Империя, в которой заметно любое поле: нефть идёт во все рынки (без
 * внутренней продажи нефтепродуктов не виден демпфер, без экспорта сырья —
 * прибавка к экспорту), а банк уже вырос (иначе не виден его множитель).
 */
const EMPIRE: Record<string, number> = {
  t_refinery: 4,
  t_pipeline: 1,
  t_azs: 1,
  t_depot: 1,
  p_badbank: 1,
  p_bank_scale: 2,
};

function empire(content: Content, owned: Record<string, number> = {}): GameState {
  const state = createInitialState(content.config, 7);
  state.wells = [{ kind: 'unique', dailyTonnes: 60_000 }];
  state.coins = 1e12;
  state.totalEarned = 1e12;
  state.clockMs = 600_000;
  state.playtimeMs = 600_000;
  // Вывоз капитала считается от момента запуска: без него роста не видно.
  state.capitalFlightStartedAtMs = 0;
  // Запас на складе нужен разовой продаже нефти.
  state.oil = 400;
  state.levels = { ...EMPIRE, ...owned };
  return state;
}

/** Копия контента, где у одной карточки изменено (или удалено) одно поле. */
function variant(id: string, key: string, value: unknown): Content {
  return contentOf(base.upgrades.map((def) => {
    if (def.id !== id) return def;
    const effect: Record<string, unknown> = { ...def.effect };
    if (value === undefined) delete effect[key];
    else effect[key] = value;
    return { ...def, effect: effect as UpgradeEffect };
  }));
}

const CHOICES: Partial<Record<keyof UpgradeEffect, string[]>> = {
  channel: ['contract', 'export', 'refine'],
  burstChannel: ['contract', 'export'],
  exportMode: ['pipeline', 'rail', 'tanker'],
  scope: ['all', 'production', 'passive'],
};

/**
 * Другие значения поля. Достаточно, чтобы игра заметила хотя бы одно:
 * число пробуется и увеличенным, и убранным (так ловятся поля-признаки
 * вроде `bankScale: 1` у банковской операции).
 */
function otherValues(key: keyof UpgradeEffect, value: unknown): unknown[] {
  if (typeof value === 'boolean') return [!value];
  if (typeof value === 'number') return key === 'chance' ? [0, 1] : [value * 2 + 1, undefined];
  if (typeof value === 'string') return (CHOICES[key] ?? []).filter((other) => other !== value);
  if (key === 'channelSplit' && value && typeof value === 'object') {
    const split = value as { crude?: number; products?: number };
    return [{ crude: (split.crude ?? 0) > 0 ? 0 : 1, products: (split.products ?? 0) > 0 ? 0 : 1 }];
  }
  return [];
}

/** Карточка куплена и стоит: всё, что из этого выводит экономика. */
function standing(content: Content, id: string): string {
  const def = content.byId.get(id)!;
  const state = empire(content, { [id]: Math.min(def.maxLevel, 2) });
  const derived = computeDerived(content.config, content.upgrades, state, [], content);
  return JSON.stringify([derived, bankScaleOf(content.upgrades, state)]);
}

/** Что слушаем у игры: выплаты покупок, а не обычные продажи нефти. */
function payoutsOf(game: Game): GameEvent[] {
  const events: GameEvent[] = [];
  game.on((event) => {
    if (event.type === 'oneShot' || event.type === 'periodic' || event.type === 'gambleResult') {
      events.push(event);
    }
  });
  return events;
}

/** Карточку покупают и ждут `seconds`: выплаты, остаток нефти и кошелёк. */
function purchase(content: Content, id: string, seconds: number): string {
  const game = new Game(content, empire(content));
  game.unlockAllForDevelopment();
  const events = payoutsOf(game);
  const result = game.buy(id);
  const afterBuy = { coins: game.state.coins, oil: game.state.oil, sold: game.state.totalSold };
  if (seconds > 0) game.update(seconds * 1000);
  return JSON.stringify({ result, afterBuy, events, coins: game.state.coins });
}

/** Периодика куплена, до выплаты осталась секунда: что придёт за две. */
function payday(content: Content, id: string, seconds: number): string {
  const def = content.byId.get(id)!;
  const state = empire(content, { [id]: Math.min(def.maxLevel, 2) });
  state.timers[id] = (seconds - 1) * 1000;
  const game = new Game(content, state);
  const events = payoutsOf(game);
  game.update(2000);
  return JSON.stringify(events);
}

/**
 * Всё, что игрок может заметить от карточки. Сроки берутся у исходной
 * карточки: иначе изменённый срок сдвигал бы и само наблюдение.
 */
function observe(content: Content, original: UpgradeDef): string {
  const parts = [standing(content, original.id)];
  const seconds = original.effect.seconds ?? 0;
  if (original.type === 'oneShot') parts.push(purchase(content, original.id, 0));
  if (original.type === 'gamble') parts.push(purchase(content, original.id, seconds + 1));
  if (original.type === 'periodic') parts.push(payday(content, original.id, seconds));
  return parts.join('\n');
}

describe('поля effect: таблица разрешённого (REVIEW A4)', () => {
  it('у каждой боевой карточки только те поля, что ядро читает для её типа', () => {
    const extra = real.upgrades.flatMap((def) => Object.keys(def.effect)
      .filter((key) => !(EFFECT_FIELDS[def.type] as readonly string[]).includes(key))
      .map((key) => `${def.id} (${def.type}): ${key}`));
    expect(extra).toEqual([]);
  });

  it('постройки сбыта не несут exportBonus: он работает только у пассивных покупок', () => {
    const carriers = real.upgrades
      .filter((def) => def.effect.exportBonus !== undefined)
      .map((def) => `${def.id} (${def.type})`);
    expect(carriers).toEqual(['t_roga (passive)']);
  });

  it('таблица описывает каждый тип покупки', () => {
    const types = [...new Set(real.upgrades.map((def) => def.type))].sort();
    expect(Object.keys(EFFECT_FIELDS).sort()).toEqual(types);
  });

  it('проверочные карточки проходят ту же проверку, что и боевые', () => {
    expect(() => validateUpgrades(base.upgrades)).not.toThrow();
  });

  it('в таблице нет полей, которые не носит ни одна проверенная ниже карточка', () => {
    const carried = new Set(base.upgrades.flatMap((def) =>
      Object.keys(def.effect).map((key) => `${def.type}.${key}`)));
    const listed = Object.entries(EFFECT_FIELDS)
      .flatMap(([type, keys]) => keys.map((key) => `${type}.${key}`));
    expect(listed.filter((entry) => !carried.has(entry))).toEqual([]);
  });
});

describe('поля effect: каждое что-то меняет в игре (REVIEW A4)', () => {
  it('проверочная империя продаёт по всем рынкам и держит банк', () => {
    const state = empire(base);
    const derived = computeDerived(base.config, base.upgrades, state, [], base);
    expect(derived.flows.domestic).toBeGreaterThan(0);
    expect(derived.flows.export).toBeGreaterThan(0);
    expect(derived.flows.productsDomestic).toBeGreaterThan(0);
    expect(derived.productPriceExport).toBeGreaterThan(derived.productPriceDomestic);
    expect(derived.taxRate).toBeGreaterThan(base.config.tax.minRate + 0.1);
    expect(bankScaleOf(base.upgrades, state)).toBeGreaterThan(1);
    expect(state.oil).toBeGreaterThan(0);
  });

  it('изменение любого поля любой карточки меняет показатели или исход покупки', () => {
    const ignored: string[] = [];
    let checked = 0;
    for (const def of base.upgrades) {
      const keys = Object.keys(def.effect) as Array<keyof UpgradeEffect>;
      if (keys.length === 0) continue;
      const before = observe(base, def);
      for (const key of keys) {
        checked++;
        const noticed = otherValues(key, def.effect[key])
          .some((value) => observe(variant(def.id, key, value), def) !== before);
        if (!noticed) ignored.push(`${def.id} (${def.type}): ${key} = ${JSON.stringify(def.effect[key])}`);
      }
    }
    // Защита от пустого прохода: полей в контенте заведомо больше сотни.
    expect(checked).toBeGreaterThan(150);
    expect(ignored).toEqual([]);
  });
});
