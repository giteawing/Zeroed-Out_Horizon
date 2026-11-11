// @vitest-environment happy-dom
/**
 * «Правила игры» ↔ движок (REVIEW A5, B1, B3, B4, H7).
 * Окно правил собирается из config.json, но формулировки лежат в texts.json:
 * текст не должен утверждать то, чего игра не делает.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import {
  CHANNELS,
  INVESTMENT_RATE_MAX_PERCENT,
  INVESTMENT_RATE_MIN_PERCENT,
  INVESTMENT_YEAR_DAYS,
  computeDerived,
  costFor,
  wellDeclineFactor,
  wellDeclineFloorSeconds,
} from '../../src/core/economy';
import { formatMoney, formatNumber, formatPercent } from '../../src/core/format';
import { Game } from '../../src/core/game';
import { createInitialState } from '../../src/core/state';
import { Rules } from '../../src/ui/rules';
import { Texts } from '../../src/ui/texts';
import type { Content, DerivedStats, GameEvent, UpgradeDef } from '../../src/core/types';
import textsJson from '../../src/content/texts.json';

function rulesOf(content: Content): { root: HTMLElement; texts: Texts; section: (titleKey: string) => string } {
  const texts = new Texts(content.texts);
  const rules = new Rules(content, texts, content.config.currency, () => undefined);
  const section = (titleKey: string): string => {
    const title = texts.get(titleKey);
    const node = [...rules.root.querySelectorAll('.rules__section')]
      .find((candidate) => candidate.querySelector('.rules__title')?.textContent === title);
    expect(node, `раздел «${title}»`).toBeDefined();
    return node!.textContent ?? '';
  };
  return { root: rules.root, texts, section };
}

describe('правила: падение дебита (REVIEW B4)', () => {
  const content = loadContent();
  const { config } = content;
  const decline = config.oil.wells.decline;

  it('движок: дебит падает до пола и дальше не снижается', () => {
    const floorSeconds = wellDeclineFloorSeconds(config);
    const at = (seconds: number): number => {
      const state = createInitialState(config, 1);
      state.playtimeMs = seconds * 1000;
      return wellDeclineFactor(config, state);
    };
    expect(decline.minFactor).toBeGreaterThan(0.5);
    // Пол достигается раньше «периода полураспада»: половины не будет никогда.
    expect(floorSeconds).toBeGreaterThan(0);
    expect(floorSeconds).toBeLessThan(decline.halfLifeSeconds);
    expect(floorSeconds).toBeCloseTo(decline.halfLifeSeconds * Math.log2(1 / decline.minFactor), 6);
    expect(at(0)).toBe(1);
    expect(at(floorSeconds - 1)).toBeGreaterThan(decline.minFactor);
    expect(at(floorSeconds + 1)).toBe(decline.minFactor);
    expect(at(decline.halfLifeSeconds)).toBe(decline.minFactor);
    expect(at(decline.halfLifeSeconds * 10)).toBe(decline.minFactor);
  });

  it('текст называет пол и время его достижения, а не «половину»', () => {
    const { section } = rulesOf(content);
    const wells = section('rules.wellsTitle');
    const minutes = Math.round(wellDeclineFloorSeconds(config) / 60);
    expect(minutes).toBeGreaterThan(0);
    expect(wells).toContain(formatPercent(decline.minFactor, 0));
    expect(wells).toContain(`${minutes} `);
    // Раньше правила обещали «половина уходит за 1800 секунд».
    expect(wells).not.toContain('половина');
    expect(wells).not.toContain(String(decline.halfLifeSeconds));
  });

  it('без падения дебита правила так и говорят', () => {
    const flat = structuredClone(content);
    flat.config.oil.wells.decline.minFactor = 1;
    expect(wellDeclineFloorSeconds(flat.config)).toBe(0);
    const { section, texts } = rulesOf(flat);
    expect(section('rules.wellsTitle')).toContain(texts.get('rules.wellsNoDecline'));
  });
});

describe('правила: внутренний рынок сырой нефти (REVIEW B3)', () => {
  it('ограниченный контрактный канал не описан как «берёт весь остаток»', () => {
    const content = loadContent();
    expect(content.config.oil.channels.contract.unlimited).toBe(false);
    const { section } = rulesOf(content);
    const channels = section('rules.channelsTitle');

    const state = createInitialState(content.config, 1);
    const derived = computeDerived(content.config, content.upgrades, state, [], content);
    const capacity = derived.capacities.domestic.crude;
    expect(Number.isFinite(capacity)).toBe(true);
    expect(capacity).toBeGreaterThan(0);

    expect(channels).not.toContain('весь остаток');
    // Стартовая мощность — та же, по которой движок ограничивает продажу.
    expect(channels).toContain(formatNumber(capacity));
  });

  it('безлимитный контрактный канал описан как безлимитный', () => {
    const content = structuredClone(loadContent());
    content.config.oil.channels.contract.unlimited = true;
    const { section, texts } = rulesOf(content);
    const channels = section('rules.channelsTitle');
    expect(channels).toContain(texts.get('rules.channelDomesticUnlimited'));
    expect(channels).toContain('весь остаток');
  });
});

describe('правила: переработка и режим «Авто» (REVIEW A3, B2)', () => {
  it('выход НПЗ в описании «Авто» берётся из конфига', () => {
    const content = structuredClone(loadContent());
    const { section } = rulesOf(content);
    const channels = section('rules.channelsTitle');
    expect(channels).toContain(formatPercent(content.config.oil.refineryYield, 0));
    expect(channels).not.toMatch(/\{[a-zA-Z]+\}/);

    const other = structuredClone(loadContent());
    other.config.oil.refineryYield = 0.62;
    const changed = rulesOf(other).section('rules.channelsTitle');
    expect(changed).toContain(formatPercent(0.62, 0));
    expect(changed).not.toContain(formatPercent(content.config.oil.refineryYield, 0));
  });

  it('правила говорят то же, что делает распределитель', () => {
    // Текст обещает: при дорогом экспорте сырья нефть идёт за границу, а на
    // склад НПЗ работает в последнюю очередь. Проверяем это на движке.
    const content = structuredClone(loadContent());
    const { section } = rulesOf(content);
    const channels = section('rules.channelsTitle');
    expect(channels).toContain('сначала идёт за границу');
    expect(channels).toContain('в последнюю очередь');

    content.config.worldPrice.min = 1;
    content.config.worldPrice.max = 1;
    content.config.worldPrice.startPrice = 1;
    const state = createInitialState(content.config, 1);
    state.wells = [{ kind: 'unique', dailyTonnes: 1_500 }];
    // НПЗ и экспорт сырья по железной дороге; терминала для экспорта продуктов нет.
    state.levels = { t_refinery: 16, x_cistern: 25, p_devalue_currency: 20 };
    const dear = computeDerived(content.config, content.upgrades, state, [], content);
    expect(dear.exportPricePerTon)
      .toBeGreaterThan(dear.productPriceDomestic * content.config.oil.refineryYield);
    expect(dear.flows.export).toBeCloseTo(dear.flows.produced, 6);
    expect(dear.flows.refined).toBe(0);

    // Рынок продуктов закрыт, есть только нефтебаза: без девальвации экспорт
    // сырья всё равно идёт раньше работы на склад.
    state.levels = { t_refinery: 16, x_cistern: 25, t_depot: 5 };
    content.config.oil.channels.contract.baseRate = 0;
    const storageOnly = computeDerived(content.config, content.upgrades, state, [], content);
    expect(storageOnly.capacities.domestic.products).toBe(0);
    expect(storageOnly.productCapacity).toBeGreaterThan(0);
    expect(storageOnly.flows.export).toBeCloseTo(storageOnly.flows.produced, 6);
    expect(storageOnly.flows.refined).toBe(0);
  });
});

describe('правила: механики, о которых они молчали (REVIEW A5, B1)', () => {
  const content = loadContent();
  const { config, upgrades } = content;
  const cardWith = (field: keyof UpgradeDef['effect']): UpgradeDef => {
    const def = upgrades.find((candidate) => candidate.effect[field] !== undefined);
    expect(def, `нет покупки с полем ${String(field)}`).toBeDefined();
    return def!;
  };
  const derivedWith = (levels: Record<string, number>, coins = 0): DerivedStats => {
    const state = createInitialState(config, 3);
    state.levels = levels;
    state.coins = coins;
    return computeDerived(config, upgrades, state, [], content);
  };

  it('в тексте не остаётся незаполненных подстановок и сырых ключей', () => {
    const { root } = rulesOf(content);
    const text = root.textContent ?? '';
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(text).not.toMatch(/\b(rules|hud|units|shop|tabs)\.[a-zA-Z]+/);
  });

  it('договоры умножают добычу: правило, строка панели и предел — из данных', () => {
    const { section, texts } = rulesOf(content);
    const production = section('rules.productionTitle');
    const deals = upgrades.filter((def) =>
      def.type === 'sell' && def.effect.percent && def.effect.channel !== 'refine');
    const maxed = derivedWith(Object.fromEntries(deals.map((def) => [def.id, def.maxLevel])));
    expect(maxed.salesVolumeMultiplier).toBeGreaterThan(2);
    expect(production).toContain(`×${formatNumber(maxed.salesVolumeMultiplier)}`);
    expect(production).toContain(`«${texts.get('hud.salesBoost')}»`);
    expect(production).toContain(`«${texts.get('tabs.sales')}»`);
    expect(production).toMatch(/больш/);

    // Число не записано в тексте: другой контент — другой предел.
    const other = structuredClone(content);
    const first = other.upgrades.find((def) => def.id === deals[0]!.id)!;
    first.effect.percent = first.effect.percent! * 3;
    other.byId.set(first.id, first);
    const otherState = createInitialState(other.config, 3);
    otherState.levels = Object.fromEntries(deals.map((def) => [def.id, def.maxLevel]));
    const otherMax = computeDerived(other.config, other.upgrades, otherState, [], other).salesVolumeMultiplier;
    expect(otherMax).toBeGreaterThan(maxed.salesVolumeMultiplier);
    expect(rulesOf(other).section('rules.productionTitle')).toContain(`×${formatNumber(otherMax)}`);
  });

  it('потолок добычи назван числом из конфига, и ядро его держит', () => {
    const { section, texts } = rulesOf(content);
    const production = section('rules.productionTitle');
    const cap = config.oil.maxProductionPerSecond;
    expect(production).toContain(formatMoney(cap, '').trim());
    expect(production).toContain(`«${texts.get('hud.productionCap')}»`);

    const state = createInitialState(config, 3);
    state.wells = [{ kind: 'unique', dailyTonnes: cap * 1_000 }];
    const capped = computeDerived(config, upgrades, state, [], content);
    expect(capped.oilPerSecond).toBe(cap);
    expect(capped.productionCapped).toBe(true);

    const other = structuredClone(content);
    other.config.oil.maxProductionPerSecond = 2_500_000;
    expect(rulesOf(other).section('rules.productionTitle')).toContain(formatMoney(2_500_000, '').trim());
  });

  it('проценты на остаток: ставка, потолок влияния и длина года — как в ядре', () => {
    const money = rulesOf(content).section('rules.moneyTitle');
    expect(money).toContain(formatPercent(INVESTMENT_RATE_MIN_PERCENT / 100, 0));
    expect(money).toContain(formatPercent(INVESTMENT_RATE_MAX_PERCENT / 100, 0));
    expect(money).toContain(`влиянии ${config.influence.cap}`);
    expect(money).toContain(`${INVESTMENT_YEAR_DAYS} игровых суток`);

    // Движок: без влияния — минимум, на потолке влияния — максимум.
    const coins = 1_000_000;
    const poor = derivedWith({}, coins);
    expect(poor.influence).toBe(0);
    expect(poor.investmentRatePercent).toBe(INVESTMENT_RATE_MIN_PERCENT);
    expect(poor.investmentIncomePerSecond).toBeCloseTo(
      coins * (INVESTMENT_RATE_MIN_PERCENT / 100) / (INVESTMENT_YEAR_DAYS * config.oil.wells.secondsPerDay),
      9,
    );
    // Всё влияние, которое продаётся в магазине: ставка — по той же шкале.
    const givers = upgrades.filter((def) => def.effect.influence);
    const allInfluence = Object.fromEntries(givers.map((def) => [def.id, def.maxLevel]));
    const mighty = derivedWith(allInfluence, coins);
    const share = Math.min(1, mighty.influence / config.influence.cap);
    expect(mighty.investmentRatePercent).toBeCloseTo(
      INVESTMENT_RATE_MIN_PERCENT + (INVESTMENT_RATE_MAX_PERCENT - INVESTMENT_RATE_MIN_PERCENT) * share,
      9,
    );
    // Сейчас потолок влияния недостижим: правила обязаны назвать не только
    // обещанный максимум, но и то, до чего игрок реально дойдёт.
    expect(mighty.influence).toBeLessThan(config.influence.cap);
    expect(money).toContain(`${formatNumber(mighty.influence)} влияния`);
    expect(money).toContain(formatPercent(mighty.investmentRatePercent / 100, 1));

    // Если потолок достижим, оговорки нет, а ставка на нём — максимальная.
    const reachable = structuredClone(content);
    reachable.config.influence.cap = mighty.influence;
    const state = createInitialState(reachable.config, 3);
    state.levels = allInfluence;
    const atCap = computeDerived(reachable.config, reachable.upgrades, state, [], reachable);
    expect(atCap.investmentRatePercent).toBe(INVESTMENT_RATE_MAX_PERCENT);
    const reachableMoney = rulesOf(reachable).section('rules.moneyTitle');
    expect(reachableMoney).toContain(`влиянии ${mighty.influence}`);
    expect(reachableMoney).not.toContain(`${formatNumber(mighty.influence)} влияния`);
  });

  it('скидка на штраф: правила называют влияние, которое реально купить', () => {
    const { section } = rulesOf(content);
    const fines = section('rules.finesTitle');
    const givers = upgrades.filter((def) => def.effect.influence);
    const mighty = derivedWith(Object.fromEntries(givers.map((def) => [def.id, def.maxLevel])));
    const cap = Math.ceil(config.fines.maxRelief / config.fines.influenceReliefPerPoint);
    expect(fines).toContain(`влиянии ${cap}`);
    // Потолок скидки — 99,9 %, а не «100 %»: штраф до нуля не падает.
    expect(config.fines.maxRelief).toBeLessThan(1);
    expect(fines).toContain(formatPercent(config.fines.maxRelief, 1));
    expect(fines).not.toContain('100%');
    // Потолок скидки выше всего влияния в магазине — об этом сказано прямо.
    expect(mighty.influence).toBeLessThan(cap);
    expect(mighty.fineFactor).toBeCloseTo(1 - mighty.influence * config.fines.influenceReliefPerPoint, 9);
    expect(fines).toContain(`${formatNumber(mighty.influence)} влияния`);
    expect(fines).toContain(formatPercent(1 - mighty.fineFactor, 0));

    const reachable = structuredClone(content);
    reachable.config.fines.influenceReliefPerPoint = config.fines.maxRelief / mighty.influence;
    expect(rulesOf(reachable).section('rules.finesTitle'))
      .not.toContain(`${formatNumber(mighty.influence)} влияния`);
  });

  it('демпфер и вывоз капитала названы своими карточками и числами', () => {
    const money = rulesOf(content).section('rules.moneyTitle');
    const damper = cardWith('fuelDamper');
    const flight = cardWith('capitalFlightPerSecond');
    expect(money).toContain(`«${damper.name}»`);
    expect(money).toContain(`«${flight.name}»`);
    expect(money).toContain(formatMoney(flight.effect.capitalFlightPerSecond!, config.currency));
    expect(money).toContain(formatPercent(flight.effect.capitalFlightGrowthPerMinute!, 0));

    // Нет таких покупок в контенте — правила о них не рассказывают.
    const bare = structuredClone(content);
    bare.upgrades = bare.upgrades.filter((def) => def.id !== damper.id && def.id !== flight.id);
    bare.byId = new Map(bare.upgrades.map((def) => [def.id, def]));
    const bareMoney = rulesOf(bare).section('rules.moneyTitle');
    expect(bareMoney).not.toContain(damper.name);
    expect(bareMoney).not.toContain(flight.name);
    expect(bareMoney).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it('правила называют выплаты мимо налога', () => {
    const money = rulesOf(content).section('rules.moneyTitle');
    expect(money).toMatch(/мимо налог/i);
    expect(money).toMatch(/периодическ/i);
    expect(money).toMatch(/рисков/i);
    expect(money).toMatch(/банк/i);
  });

  describe('«мимо налога и расходов» — так платит ядро (REVIEW D1, D2)', () => {
    /** Империя без нефти: продаж нет, поэтому на счёт попадает только проверяемая выплата. */
    const idle = (levels: Record<string, number>, source: Content = content) => {
      const state = createInitialState(source.config, 5);
      state.wells = [];
      state.levels = levels;
      const game = new Game(source, state);
      const events: GameEvent[] = [];
      game.on((event) => events.push(event));
      expect(game.derived().grossPerSecond).toBe(0);
      expect(game.derived().taxRate).toBeGreaterThan(0.1);
      return { game, state, events };
    };

    it('периодическая выплата приходит целиком', () => {
      const def = upgrades.find((candidate) => candidate.type === 'periodic')!;
      const { game, state, events } = idle({ [def.id]: 2 });
      state.timers[def.id] = def.effect.seconds! * 1000 - 50;
      game.update(100);
      const paid = events.filter((event) => event.type === 'periodic');
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ id: def.id });
      const amount = (paid[0] as Extract<GameEvent, { type: 'periodic' }>).amount;
      expect(amount).toBeGreaterThan(0);
      expect(state.coins).toBe(amount);
    });

    it('выигрыш рисковой схемы приходит целиком', () => {
      const lucky = structuredClone(content);
      const def = lucky.upgrades.find((candidate) => candidate.type === 'gamble')!;
      def.effect.chance = 1;
      lucky.byId.set(def.id, def);
      const { game, state, events } = idle({}, lucky);
      state.gambles.push({ id: def.id, amount: 1_000, factor: def.effect.factor!, resolveAt: state.clockMs });
      game.update(100);
      expect(events).toContainEqual({
        type: 'gambleResult', id: def.id, won: true, amount: 1_000 * def.effect.factor!,
      });
      expect(state.coins).toBe(1_000 * def.effect.factor!);
    });

    it('операция убыточного банка приходит целиком, обычная разовая выплата — после налога', () => {
      const bankCard = upgrades.find((candidate) => candidate.effect.launder)!;
      const gate = bankCard.unlockAt!;
      const { game, state } = idle({ p_badbank: 1, [gate.upgrade!]: gate.level ?? 1 });
      const bank = game.buy(bankCard.id);
      expect(bank.ok, JSON.stringify(bank)).toBe(true);
      const entry = state.log.find((item) => item.kind === 'launder')!;
      expect(entry.money).toBeGreaterThan(0);
      expect(bank.payouts[0]!.amount).toBe(entry.money);
      expect(state.coins).toBe(entry.money);

      // Для сравнения: разовая выплата без пометки «мимо налогов».
      const plainCard = upgrades.find((candidate) =>
        candidate.type === 'oneShot' && !candidate.effect.launder && !candidate.effect.sellsOil &&
        candidate.baseCost === 0)!;
      const giver = upgrades.find((candidate) => (candidate.effect.influence ?? 0) > 0)!;
      const taxed = idle({ [giver.id]: giver.maxLevel });
      const result = taxed.game.buy(plainCard.id);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const event = taxed.state.log.find((item) => item.kind === 'event')!;
      const rate = taxed.game.derived().taxRate;
      expect(result.payouts[0]!.amount).toBeCloseTo(event.money! * (1 - rate), 6);
      expect(taxed.state.coins).toBeLessThan(event.money!);
    });

    it('проценты на остаток входят в доход и налоговую базу, но расходов не добавляют', () => {
      const poor = derivedWith({}, 0);
      const rich = derivedWith({}, 5_000_000);
      expect(rich.investmentIncomePerSecond).toBeGreaterThan(0);
      expect(rich.grossPerSecond - poor.grossPerSecond).toBeCloseTo(rich.investmentIncomePerSecond, 6);
      expect(rich.expensesPerSecond).toBe(poor.expensesPerSecond);
      expect(rich.taxPaidPerSecond - poor.taxPaidPerSecond)
        .toBeCloseTo(rich.investmentIncomePerSecond * rich.taxRate, 6);
    });
  });

  it('цены: рост уровня и сжатие больших цен', () => {
    const upgradesText = rulesOf(content).section('rules.upgradesTitle');
    const curve = config.currencyCostCurve!;
    const slowGrowth = Math.pow(config.costGrowth, curve.exponent) - 1;
    expect(upgradesText).toContain(formatPercent(config.costGrowth - 1, 0));
    expect(upgradesText).toContain(formatMoney(curve.anchor, config.currency));
    expect(upgradesText).toContain(formatPercent(slowGrowth, 1));

    // Движок: покупка с общим темпом и без индекса стройки дорожает именно так.
    const plain = upgrades.find((def) =>
      def.costGrowth === undefined && !def.assetKind && def.type !== 'well' && def.type !== 'field' &&
      def.baseCost > 0 && def.baseCost < curve.anchor && def.maxLevel >= 40)!;
    expect(plain, 'нужна покупка с общим темпом роста цены').toBeDefined();
    expect(costFor(config, plain, 1) / costFor(config, plain, 0)).toBeCloseTo(config.costGrowth, 2);
    const late = Math.ceil(Math.log(curve.anchor / plain.baseCost) / Math.log(config.costGrowth)) + 5;
    expect(plain.baseCost * Math.pow(config.costGrowth, late)).toBeGreaterThan(curve.anchor);
    expect(costFor(config, plain, late + 1) / costFor(config, plain, late)).toBeCloseTo(1 + slowGrowth, 3);
  });

  it('девальвация: курс, экспортные цены и удорожание стройки', () => {
    const upgradesText = rulesOf(content).section('rules.upgradesTitle');
    const card = cardWith('exchangeRateDevaluation');
    const step = card.effect.exchangeRateDevaluation!;
    const maxRate = Math.pow(1 + step, card.maxLevel);
    const capex = Math.pow(maxRate, config.exchangeRate.constructionCostElasticity) - 1;
    expect(upgradesText).toContain(`«${card.name}»`);
    expect(upgradesText).toContain(formatPercent(step, 0));
    expect(upgradesText).toContain(`×${formatNumber(maxRate)}`);
    expect(upgradesText).toContain(formatPercent(capex, 0));

    // Движок: курс, экспортная цена и цена стройки на полном уровне.
    const before = derivedWith({});
    const after = derivedWith({ [card.id]: card.maxLevel });
    expect(after.exchangeRate / before.exchangeRate).toBeCloseTo(maxRate, 9);
    expect(after.exportPricePerTon / before.exportPricePerTon).toBeCloseTo(maxRate, 9);
    expect(after.domesticPricePerTon).toBeCloseTo(before.domesticPricePerTon, 9);
    const built = upgrades.find((def) => def.assetKind && def.baseCost > 1_000)!;
    expect(costFor(config, built, 0, after.exchangeRate) / costFor(config, built, 0, before.exchangeRate))
      .toBeCloseTo(1 + capex, 2);
    const service = upgrades.find((def) =>
      def.tab === 'political' && !def.assetKind && def.type !== 'well' && def.type !== 'field' &&
      def.baseCost > 1_000)!;
    expect(costFor(config, service, 0, after.exchangeRate)).toBe(costFor(config, service, 0, before.exchangeRate));
  });

  it('размер отжатого месторождения берётся из конфига', () => {
    const other = structuredClone(content);
    other.config.oil.conquestWells = { min: 7, max: 33 };
    const text = rulesOf(other).section('rules.upgradesTitle');
    expect(text).toContain('от 7 до 33 скважин');
    expect(text).not.toContain('от 5 до 50');
    const { min, max } = config.oil.conquestWells;
    expect(rulesOf(content).section('rules.upgradesTitle')).toContain(`от ${min} до ${max} скважин`);
  });

  it('офлайн-доход: потолок и скорость — из конфига', () => {
    const save = rulesOf(content).section('rules.saveTitle');
    expect(config.offline.efficiency).toBe(1);
    expect(save).toContain(`${Math.round(config.offline.capSeconds / 60)} мин`);
    expect(save).toContain('с той же скоростью');

    // Замедленный офлайн правила не выдают за полный.
    const slow = structuredClone(content);
    slow.config.offline.efficiency = 0.4;
    slow.config.offline.capSeconds = 60;
    const slowSave = rulesOf(slow).section('rules.saveTitle');
    expect(slowSave).not.toContain('с той же скоростью');
    expect(slowSave).toContain(formatPercent(0.4, 0));
    // «1 минут» — ошибка согласования: единица измерения сокращена.
    expect(slowSave).toContain('1 мин');
    expect(slowSave).not.toMatch(/1 минут(?!\p{L})/u);
  });

  it('число покупок не спорит с падежом, дробь ставки — с запятой', () => {
    const { section } = rulesOf(content);
    const count = upgrades.filter((def) => !def.win).length;
    const upgradesText = section('rules.upgradesTitle');
    expect(upgradesText).toContain(String(count));
    // «151 покупок» — ошибка согласования; текст построен без склонения.
    expect(upgradesText).not.toMatch(/\d\s+покуп/);
    const money = section('rules.moneyTitle');
    const drop = (config.tax.influenceDrop * 100).toFixed(3);
    expect(money).not.toContain(drop);
    expect(money).toContain(drop.replace('.', ','));
  });
});

describe('правила: числа приходят из данных (REVIEW H7)', () => {
  /**
   * Число, вписанное в текст правила руками, перестаёт быть правдой при
   * первой правке config.json, и ни один тест этого не заметит. Поэтому в
   * шаблонах `texts.json → rules` чисел нет: только подстановки `{имя}`,
   * которые `src/ui/rules.ts` заполняет из конфигурации и ядра. Сами
   * подстановки сверяются с поведением игры в тестах выше.
   */
  const templates = textsJson.rules as Record<string, string | string[]>;
  const textOf = (key: string): string => {
    const value = templates[key];
    expect(value, `rules.${key}`).toBeDefined();
    return Array.isArray(value) ? value.join('\n') : value!;
  };

  /** Числа, которые входят в саму формулировку правила. */
  const PART_OF_THE_RULE: Record<string, string[]> = {
    // «добыча умножается на 1 + больший из двух итогов»: единица из формулы
    // множителя; формулу проверяет тест «договоры умножают добычу».
    salesBoostText: ['1'],
  };

  it('в шаблонах правил нет чисел, вписанных руками', () => {
    expect(Object.keys(templates).length).toBeGreaterThan(40);
    const written = Object.keys(templates).flatMap((key) => {
      const numbers = textOf(key).replace(/\{[a-zA-Z]+\}/g, '').match(/\d+(?:[.,]\d+)?/g) ?? [];
      const allowed = PART_OF_THE_RULE[key] ?? [];
      return numbers.filter((number) => !allowed.includes(number)).map((number) => `rules.${key}: ${number}`);
    });
    expect(written).toEqual([]);
    for (const [key, numbers] of Object.entries(PART_OF_THE_RULE)) {
      for (const number of numbers) expect(textOf(key), key).toContain(number);
    }
  });

  it('числа прописью совпадают с данными', () => {
    const { byId } = loadContent();
    // «Убыточный банк покупается один раз».
    expect(textOf('bankText')).toMatch(/покупается один раз/);
    expect(byId.get('p_badbank')?.maxLevel).toBe(1);
    // «Сумма трёх направлений не может превышать текущую добычу».
    expect(textOf('marketsRedirect')).toMatch(/трёх направлений/);
    expect(CHANNELS).toHaveLength(3);
    // «…на 1 + больший из двух итогов»: итогов два — внутренний рынок и экспорт.
    expect(textOf('salesBoostText')).toMatch(/больший из двух итогов/);
    expect(CHANNELS.filter((channel) => channel !== 'refine')).toHaveLength(2);
    // Других числительных в правилах нет: новое нужно сверить с данными здесь.
    const numerals = /(?<!\p{L})(один|одна|одно|одну|одного|одной|два|две|двух|три|трёх|четыре|четырёх|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти|вдвое|втрое|вчетверо|половин\p{L}*|трет[ьи]\p{L}*|четверт\p{L}*|дважды|трижды|удв\p{L}+|утр[ао]\p{L}+)(?!\p{L})/giu;
    const found = Object.keys(templates).flatMap((key) =>
      [...textOf(key).matchAll(numerals)].map((match) => `${key}: ${match[0]!.toLowerCase()}`),
    );
    expect(found.sort()).toEqual([
      'bankText: один',
      'ebtText: одной',
      'marketsRedirect: трёх',
      'salesBoostText: двух',
      'wellsText: один',
    ]);
    // Два из них — не числа из данных: «Один игровой день длится {day}…»
    // (один — сам день) и «входят одной суммой» (оборот речи).
    expect(textOf('wellsText')).toMatch(/Один игровой день длится \{day\}/);
    expect(textOf('ebtText')).toMatch(/входят одной суммой/);
  });
});
