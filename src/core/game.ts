/**
 * Игровой движок. Держит состояние, применяет действия и крутит экономику.
 * Не знает про DOM: UI подписывается на события и читает состояние.
 */
import {
  allocateBatch,
  affordableLevels,
  bankScaleOf,
  fineFor,
  reprivatizationPrize,
  computeDerived,
  costFor,
  eventPayout,
  isUnlocked,
  isWinReady,
  levelOf,
  stagedNameOf,
  tapReward,
  unlockBlocker,
  winCostOf,
  allocateByPrice,
  worldPriceAt,
} from './economy';
import type {
  Content,
  DerivedStats,
  GameEvent,
  Well,
  GameState,
  LogEntry,
  ReprivatizationPrize,
  UpgradeDef,
} from './types';
import { Rng } from './rng';
import { calculateSaleSettlement } from './accounting';

export type BuyFailure = 'noMoney' | 'cooldown' | 'locked' | 'maxLevel' | 'won' | 'noOil';

const MAX_LOG = 24;

/**
 * Куда утекает излишек. Тексты берутся из `texts.spill.places` по ключу,
 * чтобы падежи и предлоги не собирались в коде.
 */
const SPILL_PLACES = ['sea', 'taiga', 'river', 'tundra', 'field', 'yard'] as const;

export interface BuyResult {
  ok: boolean;
  reason?: BuyFailure;
  cost?: number;
  level?: number;
  payouts: Array<{ id: string; amount: number }>;
}

export interface BuyCheck {
  ok: boolean;
  reason?: BuyFailure;
  cost: number;
  level: number;
  maxLevel: number;
  affordable: number;
  /** Фактическое число уровней в этой проверке и последующей покупке. */
  count: number;
  unlocked: boolean;
  cooldownMs: number;
  blocker: ReturnType<typeof unlockBlocker>;
}

/** Покупки, которые бурят новую скважину со случайным дебитом. */
/** Покупки, которые бурят ОДНУ скважину-лотерею. */
const WELL_UPGRADE_IDS = new Set(['t_well', 'p_reprivatize']);

/** Покупка-действие (событие с перезарядкой) или обычная прокачка. */
export function isRepeatable(def: UpgradeDef): boolean {
  return def.repeatable === true || (!def.win && def.cooldownSeconds !== undefined && def.type === 'oneShot');
}
const MAX_GAMBLE_RESOLVES_PER_TICK = 20;

export class Game {
  readonly content: Content;
  state: GameState;
  private rng: Rng;
  private derivedCache: DerivedStats | null = null;
  private listeners = new Set<(event: GameEvent) => void>();
  private autoTapAccum = 0;
  private achievementTimerMs = 0;
  /** Разлито за текущий шаг, тонн: переводим в т/с уже после шага. */
  private spillCrudeThisStep = 0;
  private spillProductsThisStep = 0;
  /** Длительность именно выполняемого шага; вне update() равна нулю. */
  private activeDtSeconds = 0;
  /** Выручка текущей финансовой сделки, ещё не прошедшая расходы и налог. */
  private pendingSalesGross = 0;
  /** Внешний доход накапливается отдельно и закрывается вместе с продажей. */
  private pendingExternalGross = 0;
  /** Сглаженный фактический доход (то, что реально капает на счёт), ₦/с. */
  private revenueEma = 0;
  private lastSaleLogMs = 0;
  private lastSpillLogMs: Record<'crude' | 'products', number> = {
    crude: Number.NEGATIVE_INFINITY,
    products: Number.NEGATIVE_INFINITY,
  };
  private readonly spillBuckets: Record<'crude' | 'products', {
    tonnes: number;
    fine: number;
    place: string;
  } | null> = { crude: null, products: null };
  /** Последняя целая секунда, для которой обновлена мировая котировка. */
  private lastWorldPriceSecond = 0;
  private devUnlocked = false;

  constructor(content: Content, state: GameState) {
    this.content = content;
    this.state = state;
    this.rng = new Rng(state.rngSeed);
    this.lastWorldPriceSecond = Math.floor(state.clockMs / 1000);
  }

  /** Перезапустить партию, сохранив подписчиков и контент. */
  reset(state: GameState): void {
    this.state = state;
    this.rng = new Rng(state.rngSeed);
    this.lastWorldPriceSecond = Math.floor(state.clockMs / 1000);
    this.autoTapAccum = 0;
    this.achievementTimerMs = 0;
    this.spillCrudeThisStep = 0;
    this.spillProductsThisStep = 0;
    this.activeDtSeconds = 0;
    this.pendingSalesGross = 0;
    this.pendingExternalGross = 0;
    this.revenueEma = 0;
    this.lastSaleLogMs = 0;
    this.lastSpillLogMs = { crude: Number.NEGATIVE_INFINITY, products: Number.NEGATIVE_INFINITY };
    this.spillBuckets.crude = null;
    this.spillBuckets.products = null;
    this.devUnlocked = false;
    this.invalidate();
  }

  get config() {
    return this.content.config;
  }

  on(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Производные показатели с кешем: пересчёт только при изменениях. */
  derived(): DerivedStats {
    if (!this.derivedCache) {
      this.derivedCache = computeDerived(
        this.config, this.content.upgrades, this.state, [], this.content,
      );
    }
    return this.derivedCache;
  }

  /**
   * Сбросить кеш производных показателей. Нужен, когда меняется не состояние,
   * а конфиг (например, в тестах или при подмене правил на лету).
   */
  invalidate(): void {
    this.derivedCache = null;
  }

  /** Снять блокировки только в текущем dev-сеансе, не меняя контент. */
  unlockAllForDevelopment(): void {
    this.devUnlocked = true;
    this.invalidate();
  }

  level(id: string): number {
    return levelOf(this.state, id);
  }

  // ------------------------------------------------------------------ тап

  /**
   * Тап по долоту: добывает НЕФТЬ (тонны), а не деньги.
   * Возвращает, сколько тонн добавилось (0, если резервуары полны).
   */
  tap(): number {
    if (this.state.won) return 0;
    const derived = this.derived();
    const tonnes = tapReward(derived, this.rng.next());
    const added = this.addOil(tonnes);
    this.state.totalTaps += 1;
    this.emit({ type: 'tap', amount: added });
    if (this.state.totalTaps === 1) this.checkAchievements();
    return added;
  }

  /**
   * Продать нефть напрямую через трубопровод, минуя резервуары.
   *
   * Труба — это не «ещё один канал в общем сбыте», а прямое подключение к
   * экспорту: пока в ней есть свободная мощность, нефть уходит сразу, и
   * резервуары для неё не нужны. Возвращает, сколько тонн ушло по трубе,
   * чтобы остаток лёг в резервуары.
   */
  private directExport(derived: DerivedStats, tonnes: number, dtSeconds: number): number {
    if (!derived.hasPipeline || tonnes <= 0) return 0;
    const price = derived.channels.export.price;
    if (!(price > 0)) return 0;
    const room = derived.exportCapacityByMode.pipeline * dtSeconds;
    const viaPipe = Math.min(tonnes, room);
    if (viaPipe <= 0) return 0;
    this.state.totalSold += viaPipe;
    // Как и любая другая продажа, труба добавляет именно ВАЛОВУЮ выручку.
    // Деньги появятся только после общего расчёта расходов и налога.
    this.pendingSalesGross += viaPipe * price;
    return viaPipe;
  }

  /**
   * Долить нефть в резервуары.
   *
   * Нефть копится `shipDays` суток, поэтому резервуары должны вмещать
   * пятисуточную добычу — иначе она упирается в стенку и рост останавливается.
   * Когда место кончается, партия отправляется досрочно за фактически
   * накопленное время. Если рынки не успевают, остаток разливается и штрафуется.
   */
  private addOil(tonnes: number): number {
    if (!Number.isFinite(tonnes) || tonnes <= 0) return 0;
    let left = tonnes;
    let addedTotal = 0;
    const hasUnlimitedCrude = Object.values(this.config.oil.channels)
      .some((channel) => channel.unlimited === true);
    const initialFree = Math.max(0, this.derived().oilCapacity - this.state.oil);

    if (left > initialFree && hasUnlimitedCrude) {
      this.state.oil += left;
      addedTotal += left;
      this.invalidate();
      this.pendingSalesGross += this.tickShipping(this.derived(), 0, true);
      this.finishImmediateAction();
      return addedTotal;
    }

    for (let guard = 0; guard < 10_000 && left > 1e-9; guard++) {
      const capacity = this.derived().oilCapacity;
      const free = Math.max(0, capacity - this.state.oil);
      const added = Math.min(free, left);
      if (added > 0) {
        this.state.oil += added;
        this.invalidate();
      }
      addedTotal += added;
      left -= added;
      if (left <= 1e-9) break;

      const beforeShip = this.state.oil;
      if (beforeShip > 0) {
        this.pendingSalesGross += this.tickShipping(this.derived(), 0, true);
      }
      if (this.state.oil >= beforeShip - 1e-9) {
        this.spill('crude', left);
        this.emit({ type: 'oilFull' });
        left = 0;
      }
    }

    // Не допускаем исчезновения остатка при достижении защитного лимита цикла.
    if (left > 1e-9) {
      this.spill('crude', left);
      this.emit({ type: 'oilFull' });
    }
    this.finishImmediateAction();
    return addedTotal;
  }

  /** Разлив от ручного действия нужно записать до возможного snapshot(). */
  private finishImmediateAction(): void {
    if (this.activeDtSeconds > 0) return;
    const crude = this.spillCrudeThisStep;
    const products = this.spillProductsThisStep;
    if (crude > 1e-9 || products > 1e-9) {
      const influence = this.derived().influence;
      this.state.expensesAccrued +=
        fineFor(this.config, 'crude', crude, influence) +
        fineFor(this.config, 'products', products, influence);
      this.commitSpill(Math.max(0.001, this.config.fines.stormSeconds));
      this.flushSpillBuckets();
    }
    this.settleSales();
  }

  /** Начислить фактически полученные деньги и обновить суммарный заработок. */
  private grantCoins(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.state.coins += amount;
    this.state.totalEarned += amount;
    this.invalidate();
  }

  /**
   * Начислить деньги извне (инженерное меню). Учитывается в totalEarned,
   * поэтому разблокировки по заработку тоже открываются.
   */
  addCoins(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.grantCoins(amount);
  }

  /**
   * Мгновенная победа для инженерного меню: финальный насос покупается
   * напрямую, без требований по деньгам и влиянию.
   */
  forceWin(): boolean {
    const winDef = this.content.upgrades.find((u) => u.win);
    if (!winDef || this.state.won) return false;
    this.state.levels[winDef.id] = 1;
    this.state.won = true;
    this.state.wonAtMs = this.state.playtimeMs;
    this.invalidate();
    this.grantAchievement('a_win');
    this.emit({ type: 'win' });
    return true;
  }

  /** Авто-тап от «Верхнего привода». */
  private applyAutoTaps(dtMs: number): void {
    const auto = this.derived().autoTapsPerSecond;
    if (auto <= 0) return;
    this.autoTapAccum += auto * (dtMs / 1000);
    if (this.autoTapAccum < 1) return;
    const count = Math.floor(this.autoTapAccum);
    this.autoTapAccum -= count;
    this.addOil(this.derived().tapValue * count);
    this.emit({ type: 'income' });
  }

  // -------------------------------------------------------------- покупки

  private priceOfLevels(def: UpgradeDef, level: number, count: number, exchangeRate: number): number {
    if (def.baseCost <= 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += costFor(this.config, def, level + i, exchangeRate);
    return sum;
  }

  /** Проверка покупки без её совершения — для интерфейса. */
  checkBuy(id: string, count = 1): BuyCheck {
    const def = this.content.byId.get(id);
    if (!def) {
      return {
        ok: false, reason: 'locked', cost: 0, level: 0, maxLevel: 0,
        affordable: 0, count: 0, unlocked: false, cooldownMs: 0, blocker: null,
      };
    }
    const level = this.level(id);
    const derived = this.derived();
    const unlocked = this.devUnlocked || isUnlocked(def, this.state, derived.influence, this.config);
    const cooldownMs = this.state.cooldowns[id] ?? 0;
    const repeatable = isRepeatable(def);
    const requested = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    const wanted = repeatable || def.cooldownSeconds || def.win
      ? 1
      : Math.min(requested, this.config.maxBuyLevels);
    const buyCount = repeatable
      ? 1
      : Math.min(wanted, Math.max(0, def.maxLevel - level));
    const rawCost = def.win
      ? winCostOf(this.config, this.content.upgrades)
      : this.priceOfLevels(def, repeatable ? 0 : level, buyCount, derived.exchangeRate);
    // «Отжать» дешевле, чем построить: скидка растёт от влияния и ЧВК.
    const cost = def.conquest
      ? Math.round(rawCost * (1 - derived.conquestCut))
      : rawCost;

    let reason: BuyFailure | undefined;
    if (this.state.won) reason = 'won';
    else if (!unlocked) reason = 'locked';
    else if (!repeatable && level >= def.maxLevel) reason = 'maxLevel';
    else if (cooldownMs > 0) reason = 'cooldown';
    else if (def.win) {
      if (!isWinReady(this.config, this.content.upgrades, this.state, this.state.coins, derived.influence)) {
        reason = 'locked';
      }
    } else if (this.state.coins < cost) {
      reason = 'noMoney';
    } else if (def.effect.sellsOil && this.state.oil < 0.001) {
      // Экспортная акция продаёт нефть со склада — без нефти продавать нечего.
      reason = 'noOil';
    }

    return {
      ok: reason === undefined,
      reason,
      cost,
      level,
      maxLevel: def.maxLevel,
      affordable: def.win || repeatable
        ? (this.state.coins >= cost ? 1 : 0)
        : affordableLevels(
            this.config,
            def,
            level,
            def.conquest
              ? this.state.coins / Math.max(1e-9, 1 - derived.conquestCut)
              : this.state.coins,
            derived.exchangeRate,
          ),
      count: buyCount,
      unlocked,
      cooldownMs,
      blocker: unlockBlocker(def, this.state, derived.influence, this.config),
    };
  }

  /** Купить покупку. count — желаемое число уровней (1..maxBuyLevels). */
  buy(id: string, count = 1): BuyResult {
    const def = this.content.byId.get(id);
    if (!def) return { ok: false, reason: 'locked', payouts: [] };
    const check = this.checkBuy(id, count);
    if (!check.ok) {
      if (check.reason === 'noMoney' || check.reason === 'cooldown') {
        this.emit({ type: 'error', code: check.reason, id });
      }
      return { ok: false, reason: check.reason, payouts: [] };
    }
    if (def.win) return this.buyWin(def, check.cost);

    const repeatable = isRepeatable(def);
    // Количество и цена рассчитаны ровно один раз в checkBuy(): исполнение
    // не имеет права пересчитать их без учёта остатка до maxLevel.
    const buyCount = check.count;
    const cost = check.cost;
    this.state.coins -= cost;
    // Действия с перезарядкой не «прокачиваются»: уровень остаётся 1,
    // иначе после первой покупки кнопка навсегда стала бы «Максимум».
    const newLevel = repeatable ? Math.max(1, check.level) : check.level + buyCount;
    this.state.levels[id] = newLevel;
    this.state.totalPurchases += 1;
    if (def.cooldownSeconds) this.state.cooldowns[id] = def.cooldownSeconds * 1000;
    if (def.type === 'luxury') this.state.luxurySpent += cost;
    if (def.effect.capitalFlightPerSecond && this.state.capitalFlightStartedAtMs === null) {
      this.state.capitalFlightStartedAtMs = this.state.clockMs;
    }
    this.invalidate();

    const payouts = this.applyImmediateEffect(def, newLevel, cost);

    // «Пробурить скважину» — это лотерея: класс скважины и её суточный дебит
    // выпадают случайно, поэтому каждая покупка даёт разную добычу.
    const effectCount = repeatable ? 1 : buyCount;
    if (def.id === 'p_reprivatize' || def.type === 'field') {
      // Каждый оплаченный уровень даёт своё месторождение. Пакетная
      // покупка не должна начислять уровни без соответствующих активов.
      let dailyTonnes = 0;
      for (let i = 0; i < effectCount; i++) {
        const prize = this.applyReprivatization(cost / effectCount, def.id);
        dailyTonnes += prize.dailyTonnes;
      }
      payouts.push({ id: def.id, amount: dailyTonnes });
    } else if (WELL_UPGRADE_IDS.has(def.id) && !repeatable) {
      let dailyTonnes = 0;
      for (let i = 0; i < effectCount; i++) dailyTonnes += this.drillWell().dailyTonnes;
      payouts.push({ id: def.id, amount: dailyTonnes });
    }

    // Реприватизация пишет свою строку с числом скважин и стоимостью активов,
    // поэтому общая запись «Отжато: …» для неё не нужна — иначе в журнале дубль.
    if (def.id !== 'p_reprivatize' && def.type !== 'field') {
      this.pushLog({
        kind: def.conquest ? 'conquest' : 'bought',
        upgradeId: def.id,
        money: cost,
      });
    }
    this.emit({ type: 'purchase', id, level: newLevel, cost });
    if (def.achievement) this.grantAchievement(def.achievement);
    this.checkAchievements();
    return { ok: true, cost, level: newLevel, payouts };
  }

  /**
   * Реприватизация месторождения: игрок получает случайное число скважин,
   * суммарная стоимость которых в 5–10 раз больше уплаченного.
   * Сами скважины добавляются в состояние обычным путём, поэтому добыча,
   * панель и сохранения работают без спецкода.
   */
  applyReprivatization(paid: number, upgradeId = 'p_reprivatize'): ReprivatizationPrize {
    const prize = reprivatizationPrize(
      this.config,
      paid,
      this.config.oil.basePricePerTon,
      () => this.rng.next(),
      this.derived().exchangeRate,
    );
    // Разбиваем суммарный дебит на скважины разных классов — «месторождение».
    for (const share of prize.shares) {
      const kind: Well['kind'] = share >= 500 ? 'unique' : share >= 50 ? 'good' : 'ordinary';
      this.state.wells.push({ kind, dailyTonnes: share });
    }
    this.pushLog({
      kind: 'conquest',
      upgradeId,
      tonnes: prize.dailyTonnes,
      money: prize.marketValue,
      count: prize.wells,
    });
    this.invalidate();
    this.emit({
      type: 'reprivatized',
      wells: prize.wells,
      dailyTonnes: prize.dailyTonnes,
      marketValue: prize.marketValue,
    });
    return prize;
  }

  /**
   * Бурит скважину: класс и дебит выпадают случайно по config.oil.wells.
   * Возвращает пробуренную скважину (её же пишем в журнал).
   */
  drillWell(): Well {
    const cfg = this.config.oil.wells;
    const roll = this.rng.next();
    let acc = 0;
    let chosen = cfg.classes[cfg.classes.length - 1];
    for (const cls of cfg.classes) {
      acc += cls.chance;
      if (roll <= acc) {
        chosen = cls;
        break;
      }
    }
    const step = Math.max(1, chosen.step);
    const steps = Math.floor((chosen.maxDailyTonnes - chosen.minDailyTonnes) / step);
    const dailyTonnes = Math.max(
      chosen.minDailyTonnes,
      chosen.minDailyTonnes + Math.round(this.rng.next() * Math.max(0, steps)) * step,
    );
    const well: Well = { kind: chosen.key, dailyTonnes };
    this.state.wells.push(well);
    this.pushLog({ kind: 'drill', tonnes: dailyTonnes });
    this.invalidate();
    this.emit({ type: 'drilled', kind: well.kind, dailyTonnes });
    return well;
  }

  /** Мгновенные эффекты покупки: разовая выплата, старт гэмбла, таймер периодики. */
  /** Множитель выплат банка: растёт от «Увеличения масштабов деятельности». */
  bankScale(): number {
    return bankScaleOf(this.content.upgrades, this.state);
  }

  /**
   * Как называется модель улучшения с историей (долото, насос…) на уровне level.
   * В магазине показываем следующую модель (level = текущий + 1), чтобы было
   * видно, что именно покупаешь сейчас.
   */
  stagedName(id: string, level?: number): string {
    const def = this.content.byId.get(id);
    if (!def) return id;
    return stagedNameOf(def, level ?? this.level(id));
  }

  private applyImmediateEffect(
    def: UpgradeDef,
    level: number,
    cost: number,
  ): Array<{ id: string; amount: number }> {
    const payouts: Array<{ id: string; amount: number }> = [];

    if (def.type === 'oneShot') {
      const derived = this.derived();
      if (def.effect.sellsOil && def.effect.usesWorldPrice) {
        // Экспортные акции продают реальную нефть со склада: тонны уходят,
        // деньги приходят по цене канала (и по мировой цене).
        // Если экспортный канал ещё не построен, акция всё равно работает:
        // нефть уходит по цене контрактов — «сбагрили через границу».
        const requested = def.effect.burstChannel ?? 'export';
        const requestedCfg = this.config.oil.channels[requested];
        const crudeRate = requested === 'export'
          ? derived.capacities.export.crude
          : requested === 'contract'
            ? derived.capacities.domestic.crude
            : derived.capacities.refine;
        // Цена канала существует и без инфраструктуры, поэтому выбирать
        // fallback нужно по мощности ИМЕННО для сырой нефти.
        const channel = requestedCfg.unlimited || crudeRate > 0 ? requested : 'contract';
        const channelCfg = this.config.oil.channels[channel];
        const actualRate = channel === 'export'
          ? derived.capacities.export.crude
          : channel === 'contract'
            ? derived.capacities.domestic.crude
            : derived.capacities.refine;
        const price = derived.channels[channel].price;
        const desired = Math.min(this.state.oil, Math.max(1, this.state.oil * 0.5));
        const capacity = actualRate * this.config.oil.exportBurstSeconds;
        const tonnes = channelCfg.unlimited ? desired : Math.min(desired, capacity);
        if (tonnes <= 0) return payouts;
        const gross = tonnes * price * (1 + (def.effect.exportBonus ?? 0));
        this.state.oil -= tonnes;
        this.state.totalSold += tonnes;
        this.pendingSalesGross += gross;
        const settled = this.settleSales();
        this.pushLog({
          kind: 'sold',
          upgradeId: def.id,
          channel,
          tonnes,
          price,
          money: gross,
        });
        payouts.push({ id: def.id, amount: settled.net });
        this.emit({ type: 'oneShot', id: def.id, amount: settled.net });
        this.emit({ type: 'sold', channel, tonnes, money: gross });
        return payouts;
      }
      const base = eventPayout(def, derived, level, cost);
      // Операции через банк усиливаются «масштабом деятельности банка».
      const amount = def.effect.bankScale
        ? Math.round(base * this.bankScale())
        : base;
      const gross = amount;
      // Отмывание проходит мимо налоговой, обычные выплаты — через общую
      // финансовую кассу с расходами и налогом на прибыль.
      let credited = gross;
      if (def.effect.launder) {
        this.grantCoins(gross);
      } else {
        this.pendingSalesGross += gross;
        credited = this.settleSales().net;
      }
      this.pushLog({
        kind: def.effect.launder ? 'launder' : 'event',
        upgradeId: def.id,
        money: gross,
      });
      payouts.push({ id: def.id, amount: credited });
      this.emit({ type: 'oneShot', id: def.id, amount: credited });
    }

    if (def.type === 'gamble') {
      const seconds = def.effect.seconds ?? 30;
      this.state.gambles.push({
        id: def.id,
        amount: cost,
        factor: def.effect.factor ?? 2,
        resolveAt: this.state.clockMs + seconds * 1000,
      });
      this.emit({ type: 'gambleStarted', id: def.id, amount: cost });
    }

    if (def.type === 'periodic' && this.state.timers[def.id] === undefined) {
      this.state.timers[def.id] = 0;
    }

    return payouts;
  }

  private buyWin(def: UpgradeDef, cost: number): BuyResult {
    this.state.coins -= cost;
    this.state.levels[def.id] = 1;
    this.state.totalPurchases += 1;
    this.state.won = true;
    this.state.wonAtMs = this.state.playtimeMs;
    this.invalidate();
    this.emit({ type: 'purchase', id: def.id, level: 1, cost });
    this.grantAchievement('a_win');
    this.emit({ type: 'win' });
    return { ok: true, cost, level: 1, payouts: [] };
  }

  // ------------------------------------------------------------------ тик

  /** Продвинуть время. Большой шаг допустим (симулятор, офлайн-доход). */
  /**
   * Один игровой шаг. Большие интервалы (вкладка подвисла, офлайн-доход)
   * режутся на подшаги: иначе за один шаг добыча «переполняет» резервуары
   * и сгорает, а сумма дохода зависит от размера шага.
   */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    // Фиксированный экономический квант не зависит от частоты вызовов
    // update(): большой кадр и серия маленьких проходят одинаковые шаги.
    const maxStep = Math.max(1, Math.min(50, this.config.tickMs));
    let left = dtMs;
    while (left > 0) {
      const step = Math.min(maxStep, left);
      left -= step;
      this.step(step);
      if (this.state.won) break;
    }
  }

  private step(dtMs: number): void {
    if (this.state.won) return;
    this.state.playtimeMs += dtMs;
    this.state.clockMs += dtMs;
    // Дебит скважин зависит от playtimeMs (падение добычи). Без сброса кеша
    // непрерывная игра использовала прошлый квант, а загруженный сейв —
    // текущий, из-за чего после первого шага расходились остатки нефти.
    this.invalidate();

    const dtSeconds = Math.max(1e-9, dtMs / 1000);
    this.activeDtSeconds = dtSeconds;
    // Единственное место, где движется таймер отгрузки. Ни тап, ни
    // принудительная отправка не добавляют уже прожитое время повторно.
    this.state.shipTimerMs += dtMs;
    const derived = this.derived();

    // 1. Добыча. Труба продаёт свою часть сразу, остаток идёт в резервуары.
    if (derived.oilPerSecond > 0) {
      const pumped = derived.oilPerSecond * dtSeconds;
      const viaPipe = this.directExport(derived, pumped, dtSeconds);
      this.state.pipeSoldSinceShip += viaPipe;
      this.addOil(pumped - viaPipe);
    }
    // Автотапы относятся к этому же интервалу и к этой же партии.
    this.applyAutoTaps(dtMs);

    // 2. Отгрузка лишь читает накопленный таймер и добавляет валовую
    // выручку в общий финансовый расчёт.
    this.pendingSalesGross += this.tickShipping(derived, dtSeconds);
    // Внешние выплаты поступают непрерывно и не ждут отгрузки партии.
    // Внешний доход не должен сам по себе закрывать кассу каждые 50 мс:
    // иначе мелкий процент обнуляет накопленные операционные расходы до отгрузки.
    this.pendingExternalGross += (
      derived.damperIncomePerSecond +
      derived.capitalFlightIncomePerSecond +
      derived.investmentIncomePerSecond
    ) * dtSeconds;

    const fineNow =
      this.spillCrudeThisStep * this.config.fines.oilPerTon +
      this.spillProductsThisStep * this.config.fines.productPerTon;
    this.commitSpill(dtSeconds);

    // 3. Расходы копятся ровно столько же времени, сколько нефть. Они
    // списываются вместе с ближайшей выручкой, а не только за последний
    // подшаг перед отгрузкой. Отрицательный результат по-прежнему не
    // уводит кошелёк в минус.
    const current = this.derived();
    const expensesWithoutFine =
      (current.expensesPerSecond - current.finePerSecond) * dtSeconds;
    const fineCharge = fineNow > 0
      ? Math.max(1e-6 * dtSeconds, fineNow * current.fineFactor)
      : 0;
    this.state.expensesAccrued += Math.max(0, expensesWithoutFine) + fineCharge;
    this.settleSales(dtSeconds);

    this.tickCooldowns(dtMs);
    this.tickPeriodic(dtMs, derived);
    this.tickGambles();
    this.tickWorldPrice();

    this.achievementTimerMs += dtMs;
    if (this.achievementTimerMs >= this.config.achievementsTickSeconds * 1000) {
      this.achievementTimerMs = 0;
      this.checkAchievements();
    }

    this.activeDtSeconds = 0;
    this.flushSpillBuckets();
    this.emit({ type: 'income' });
  }

  /** Единая касса для нефти, продуктов, трубы и экспортной акции. */
  private settleSales(dtSeconds = 0): { gross: number; expenses: number; tax: number; net: number } {
    const commercialGross = this.pendingSalesGross;
    if (!(commercialGross > 1e-9)) {
      if (dtSeconds > 0) this.trackRevenue(0, dtSeconds);
      return { gross: 0, expenses: 0, tax: 0, net: 0 };
    }
    // Внешний доход включается в ту же налоговую базу, но не инициирует
    // закрытие периода и не сбрасывает расходы до реальной продажи.
    const gross = commercialGross + this.pendingExternalGross;
    const settlement = calculateSaleSettlement(
      gross,
      this.state.expensesAccrued,
      this.derived().taxRate,
    );
    this.pendingSalesGross = 0;
    this.pendingExternalGross = 0;
    this.state.expensesAccrued = 0;
    if (settlement.net > 0) this.grantCoins(settlement.net);
    if (dtSeconds > 0) this.trackRevenue(settlement.net, dtSeconds);
    return settlement;
  }

  /**
   * Отправка нефти на сбыт.
   *
   * Правило заказчика: нефть копится в резервуарах `shipDays` суток (5 суток
   * = 5 реальных секунд) и только потом уезжает. Партия распределяется по
   * мощностям из `derived.flows` — тем же, что видны в таблице:
   * Каналы выбираются по фактической цене; безлимитный канал принимает
   * остаток. Переработка даёт продукты для внутреннего рынка и экспорта.
   * Срочная партия использует только реально накопленные секунды мощности.
   */
  private tickShipping(derived: DerivedStats, dtSeconds: number, force = false): number {
    const dayMs = Math.max(0.001, this.config.oil.wells.secondsPerDay) * 1000;
    const periodMs = Math.max(dayMs, this.config.oil.shipDays * dayMs);

    const batch = this.state.oil;
    if (batch <= 0) {
      const stock = this.state.products;
      let gross = 0;
      if (stock > 0) {
        const sale = this.shipProducts(stock, derived, dtSeconds);
        this.state.products = sale.leftover;
        gross = sale.money;
      }

      // Закрываем завершённые окна трубы даже при пустом резервуаре.
      // Учитываем только мощность завершившегося окна, остаток относится
      // к следующему и не должен обнуляться.
      if (this.state.shipTimerMs >= periodMs) {
        const completedWindows = Math.floor(this.state.shipTimerMs / periodMs);
        const completedMs = completedWindows * periodMs;
        const pipelineRate = derived.exportCapacityByMode.pipeline;
        const usedCapacity = pipelineRate * completedMs / 1000;
        this.state.pipeSoldSinceShip = Math.max(0, this.state.pipeSoldSinceShip - usedCapacity);
        this.state.shipTimerMs %= periodMs;
      }
      return gross;
    }

    const full = batch >= derived.oilCapacity - 1e-9;
    if (!force && this.state.shipTimerMs < periodMs && !full) return 0;

    /*
     * Сколько времени рынок реально копил под эту партию.
     *
     * Раньше всегда брался полный период (5 суток), и при срочной отгрузке
     * (резервуары переполнены) партии «разрешалось» продать мощность за все
     * пять секунд — хотя прошло одно мгновение. Из-за этого один большой шаг
     * продавал втрое больше мелких, а остальное лилось в землю. Теперь
     * берём фактически накопленное время.
     */
    const elapsedWindowMs = Math.min(periodMs, this.state.shipTimerMs);
    const remainderMs = Math.max(0, this.state.shipTimerMs - elapsedWindowMs);
    const periodSeconds = elapsedWindowMs / 1000;
    this.state.shipTimerMs = remainderMs;

    /*
     * Труба уже продала часть нефти напрямую, пока партия копилась. Её
     * мощность за этот период уже использована, поэтому партии остаётся
     * только то, что труба не успела унести. Иначе один и тот же
     * трубопровод продавал бы нефть дважды: сразу и ещё раз из резервуаров.
     */

    // Мощность экспорта, которую труба уже израсходовала за этот период,
    // пересчитываем в тонны в секунду — в таком виде её ждёт allocateBatch.
    const pipeUsedInWindow = Math.min(
      this.state.pipeSoldSinceShip,
      derived.exportCapacityByMode.pipeline * periodSeconds,
    );
    const pipeUsedPerSecond = pipeUsedInWindow / Math.max(1e-9, periodSeconds);
    const exportCapacity = {
      crude: Math.max(0, derived.capacities.export.crude - pipeUsedPerSecond),
      // Сырая нефть в трубе не занимает продуктовые танкеры и эстакады.
      products: derived.capacities.export.products,
    };
    // Объём трубы сверх закрытого окна принадлежит следующему окну.
    this.state.pipeSoldSinceShip = Math.max(0, this.state.pipeSoldSinceShip - pipeUsedInWindow);

    // Партия больше, чем «одна секунда потоков», — в `shipBatch` разбиваем
    // её по секциям, чтобы ни один канал не получил больше своей мощности.
    return this.shipBatch(
      batch,
      { ...derived, capacities: { ...derived.capacities, export: exportCapacity } },
      periodSeconds,
    );
  }

  /** Распределить партию по каналам и превратить её в деньги. */
  private shipBatch(batch: number, derived: DerivedStats, seconds = 1): number {
    /*
     * Топливо, которое уже лежит на нефтебазах, — тоже товар к продаже:
     * раньше оно копилось молча и обрезалось ёмкостью, то есть исчезало.
     * Теперь склад складывается со свежим выходом НПЗ, и всё вместе идёт
     * на рынки. Что не влезло — остаётся на складе до следующего рейса,
     * поэтому производство всегда равно «продано + осталось на складе».
     */
    const stockProducts = this.state.products;
    // Раскладываем ПАРТИЮ по мощностям, а не по уже посчитанным потокам:
    // тапы дают нефть рывками, и она обязана найти сбыт. Цены передаём те же,
    // по которым таблица выбирает выгодный рынок, — иначе экран и деньги
    // разъедутся.
    const plan = allocateBatch(this.config, derived.capacities, batch, seconds, {
      crudeDomestic: derived.channels.contract.price,
      crudeExport: derived.channels.export.price,
      productDomestic: derived.productPriceDomestic,
      productExport: derived.productPriceExport,
    }, Math.max(0, derived.productCapacity - stockProducts), stockProducts);

    // Сырьё: деньги по ценам своих каналов. За продукты платит shipProducts —
    // он же решает, сколько топлива рынки реально взяли.
    const money =
      plan.domestic * derived.channels.contract.price +
      plan.export * derived.channels.export.price;

    const soldCrude = plan.domestic + plan.export + plan.refined;
    this.state.oil = Math.max(0, batch - soldCrude);
    this.state.totalSold += soldCrude;
    this.invalidate();
    /*
     * Топливо: к свежему выходу НПЗ добавляем то, что уже лежало на
     * нефтебазах, и раскладываем по рынкам. Остаток остаётся на складе —
     * он не сгорает и не обрезается ёмкостью, а ждёт следующего рейса.
     * Поэтому производство всегда равно «продано + осталось на складе».
     */
    const fresh = plan.products;
    const productsNow = stockProducts + fresh;
    const productSale = this.shipProducts(productsNow, derived, seconds);
    this.state.products = productSale.leftover;
    const moneyWithProducts = money + productSale.money;

    if (soldCrude > 0 && this.state.clockMs - this.lastSaleLogMs >= 3000) {
      this.lastSaleLogMs = this.state.clockMs;
      this.pushLog({
        kind: 'sold',
        tonnes: soldCrude,
        price: money / soldCrude,
        money: moneyWithProducts,
        channel: plan.export >= plan.domestic && plan.export >= plan.refined
          ? 'export'
          : plan.refined >= plan.domestic ? 'refine' : 'contract',
      });
    }
    return moneyWithProducts;
  }

  /**
   * Продать нефтепродукты с рынков: сначала более выгодный, остаток — на
   * второй. Что не влезло, остаётся на нефтебазах до следующего рейса.
   *
   * Раньше этот остаток просто обрезался ёмкостью склада, и топливо
   * «исчезало»: производство не сходилось с продажей, а деньги за него
   * не приходили вовсе.
   */
  private shipProducts(
    tonnes: number,
    derived: DerivedStats,
    seconds = 1,
  ): { leftover: number; money: number } {
    const span = Math.max(0, seconds);
    const plan = allocateByPrice(Math.max(0, tonnes), [
      { key: 'export', price: derived.productPriceExport, capacity: derived.capacities.export.products * span },
      { key: 'domestic', price: derived.productPriceDomestic, capacity: derived.capacities.domestic.products * span },
    ]);
    const left = plan.remaining;
    const money =
      plan.byMarket.export * derived.productPriceExport +
      plan.byMarket.domestic * derived.productPriceDomestic;
    /*
     * Склад: то, что не взяли рынки, лежит на нефтебазах — но только до их
     * ёмкости. Остальное выливается: за разлив платим штраф, а не получаем
     * выручку. Именно поэтому расширять нефтебазы выгодно.
     */
    const room = Math.max(0, derived.productCapacity);
    const leftover = Math.min(left, room);
    const spill = left - leftover;
    if (spill > 1e-9) this.spill('products', spill);
    return { leftover, money };
  }

  /**
   * Обновить сглаженный поток разлива после шага.
   *
   * Сглаживание экспоненциальное и нормировано по времени: коэффициент
   * 1 − exp(−dt/τ) зависит от длительности шага, поэтому один большой шаг
   * и сто маленьких дают одинаковый итог. Без нормировки штраф «дрожал»
   * от размера шага, и доходы двух прогонов расходились.
   */
  private commitSpill(dtSeconds: number): void {
    const tau = Math.max(0.001, this.config.fines.stormSeconds);
    const alpha = 1 - Math.exp(-Math.max(0, dtSeconds) / tau);
    const apply = (tonnes: number, key: 'spillCrudePerSecond' | 'spillProductsPerSecond') => {
      const instant = tonnes / Math.max(1e-9, dtSeconds);
      const next = this.state[key] + (instant - this.state[key]) * alpha;
      this.state[key] = next < 1e-12 ? 0 : next;
    };
    apply(this.spillCrudeThisStep, 'spillCrudePerSecond');
    apply(this.spillProductsThisStep, 'spillProductsPerSecond');
    this.spillCrudeThisStep = 0;
    this.spillProductsThisStep = 0;
    // Поток разлива входит в расходы, поэтому кеш производных устарел:
    // без сброса строка «Норматив штрафа» висела бы на нуле.
    this.invalidate();
  }

  /**
   * Разлив: излишек ушёл в землю или в воду. Списываем штраф сразу и пишем
   * строку в журнал. Сглаженный поток хранится в состоянии, чтобы строка
   * расходов «норматив штрафа» не мигала и совпадала с кассой.
   */
  private spill(kind: 'crude' | 'products', tonnes: number): void {
    if (!(tonnes > 1e-9)) return;
    const derived = this.derived();
    const fine = fineFor(this.config, kind, tonnes, derived.influence);
    // Копим за шаг: в т/с переведём после, чтобы сглаживание не зависело
    // от размера шага (иначе большой шаг и сто маленьких давали разный штраф).
    if (kind === 'crude') this.spillCrudeThisStep += tonnes;
    else this.spillProductsThisStep += tonnes;

    /*
     * Из кассы штраф НЕ списываем: он уже входит в расходы (finePerSecond),
     * и касса вычитает их каждый шаг. Раньше здесь стояло ещё одно списание,
     * и один и тот же разлив оплачивался дважды.
     */
    const bucket = this.spillBuckets[kind];
    if (bucket) {
      bucket.tonnes += tonnes;
      bucket.fine += fine;
    } else {
      this.spillBuckets[kind] = {
        tonnes,
        fine,
        place: this.rng.pick(SPILL_PLACES),
      };
    }
    this.flushSpillBuckets();
  }

  /** Не чаще раза в три секунды пишем/отправляем сводку разлива каждого типа. */
  private flushSpillBuckets(): void {
    for (const kind of ['crude', 'products'] as const) {
      const bucket = this.spillBuckets[kind];
      if (!bucket || this.state.clockMs - this.lastSpillLogMs[kind] < 3000) continue;
      this.pushLog({
        kind: 'spill',
        tonnes: bucket.tonnes,
        money: bucket.fine,
        spill: kind,
        place: bucket.place,
      });
      this.emit({ type: 'spill', kind, tonnes: bucket.tonnes, fine: bucket.fine, place: bucket.place });
      this.lastSpillLogMs[kind] = this.state.clockMs;
      this.spillBuckets[kind] = null;
    }
  }

  /** Фактический доход в секунду: сглаженное среднее по начислениям. */
  revenuePerSecond(): number {
    return this.revenueEma;
  }

  private trackRevenue(net: number, dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    const instant = net / dtSeconds;
    // Экспоненциальное сглаживание: 0.15 — компромисс между «дёргается» и «тормозит».
    this.revenueEma += (instant - this.revenueEma) * Math.min(1, 0.15 + dtSeconds);
  }

  /** Добавить запись в журнал операций (храним последние MAX_LOG). */
  pushLog(entry: Omit<LogEntry, 'at'>): void {
    this.state.log.unshift({ at: this.state.clockMs, ...entry });
    if (this.state.log.length > MAX_LOG) this.state.log.length = MAX_LOG;
  }

  private tickCooldowns(dtMs: number): void {
    for (const id of Object.keys(this.state.cooldowns)) {
      const left = (this.state.cooldowns[id] ?? 0) - dtMs;
      if (left <= 0) delete this.state.cooldowns[id];
      else this.state.cooldowns[id] = left;
    }
  }

  private tickPeriodic(dtMs: number, derived: DerivedStats): void {
    for (const def of this.content.upgrades) {
      if (def.type !== 'periodic') continue;
      const level = this.level(def.id);
      if (level <= 0) continue;
      const intervalMs = (def.effect.seconds ?? 60) * 1000;
      if (intervalMs <= 0) continue;
      let acc = (this.state.timers[def.id] ?? 0) + dtMs;
      let fired = 0;
      while (acc >= intervalMs && fired < 50) {
        acc -= intervalMs;
        fired++;
        const amount = eventPayout(def, derived, level, 0);
        this.grantCoins(amount);
        this.emit({ type: 'periodic', id: def.id, amount });
      }
      this.state.timers[def.id] = acc;
    }
  }

  private tickGambles(): void {
    if (this.state.gambles.length === 0) return;
    const due = this.state.gambles.filter((g) => g.resolveAt <= this.state.clockMs);
    if (due.length === 0) return;
    const resolving = due.slice(0, MAX_GAMBLE_RESOLVES_PER_TICK);
    const resolved = new Set(resolving);
    // Необработанные из-за лимита события остаются в очереди. Раньше фильтр
    // выбрасывал их вместе с результатом.
    this.state.gambles = this.state.gambles.filter((g) => !resolved.has(g));
    for (const g of resolving) {
      const def = this.content.byId.get(g.id);
      const chance = def?.effect.chance ?? 0.5;
      const won = this.rng.next() < chance;
      const amount = won ? Math.round(g.amount * g.factor) : 0;
      if (won) this.grantCoins(amount);
      this.emit({ type: 'gambleResult', id: g.id, won, amount });
    }
  }

  /** Мировая цена зависит от логических часов и постоянного seed партии. */
  private tickWorldPrice(): void {
    const second = Math.floor(this.state.clockMs / 1000);
    if (second <= this.lastWorldPriceSecond) return;
    this.lastWorldPriceSecond = second;
    const previous = this.state.worldPrice;
    const next = worldPriceAt(this.config.worldPrice, this.state.worldPriceSeed, second * 1000);
    this.state.worldPrice = next;
    if (next !== previous) this.invalidate();
    if (Math.abs(next - previous) > 0.004) {
      this.emit({ type: 'worldPrice', price: next });
    }
  }

  // ------------------------------------------------------------ достижения

  private grantAchievement(id: string): void {
    if (this.state.achievements.includes(id)) return;
    this.state.achievements.push(id);
    this.emit({ type: 'achievement', id });
  }

  checkAchievements(): void {
    for (const a of this.content.achievements) {
      if (this.state.achievements.includes(a.id)) continue;
      if (a.id === 'a_win' && !this.state.won) continue;
      if (this.testRule(a.rule)) this.grantAchievement(a.id);
    }
  }

  private testRule(rule: Content['achievements'][number]['rule']): boolean {
    switch (rule.kind) {
      case 'taps':
        return this.state.totalTaps >= rule.value;
      case 'earned':
        return this.state.totalEarned >= rule.value;
      case 'taxRate':
        return this.derived().taxRate <= rule.value + 1e-9;
      case 'costCut':
        return this.derived().costCutPercent >= rule.value;
      case 'own':
        return this.level(rule.upgrade) >= (rule.value ?? 1);
      case 'influence':
        return this.derived().influence >= rule.value;
      case 'sold':
        return this.state.totalSold >= rule.value;
      case 'ownGroup':
        return this.content.upgrades.some(
          (u) => u.group === rule.group && this.level(u.id) > 0,
        );
      case 'win':
        return this.state.won;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- сервис

  /** Начислить офлайн-доход (один раз при загрузке). */
  applyOffline(seconds: number, coins: number): void {
    if (this.state.won) return;
    const elapsedSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const offlineCoins = Number.isFinite(coins) ? Math.max(0, coins) : 0;
    const elapsedMs = elapsedSeconds * 1000;
    if (elapsedMs > 0) {
      this.state.clockMs += elapsedMs;
      this.state.playtimeMs += elapsedMs;
      this.lastWorldPriceSecond = Math.floor(this.state.clockMs / 1000);
      this.invalidate();
      this.tickCooldowns(elapsedMs);
      this.tickPeriodic(elapsedMs, this.derived());
      this.tickGambles();
      this.invalidate();
    }
    this.grantCoins(offlineCoins);
    this.emit({ type: 'offline', seconds: elapsedSeconds, coins: offlineCoins });
  }

  setSound(on: boolean): void {
    this.state.soundOn = on;
  }

  setParticles(on: boolean): void {
    this.state.particlesOn = on;
  }

  /** Сериализуемый снимок: сид ГПСЧ и время сохранения синхронизируются. */
  snapshot(): GameState {
    this.state.rngSeed = this.rng.getSeed();
    this.state.savedAtWallMs = Date.now();
    return this.state;
  }
}
