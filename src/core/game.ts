/**
 * Игровой движок. Держит состояние, применяет действия и крутит экономику.
 * Не знает про DOM: UI подписывается на события и читает состояние.
 */
import {
  allocateBatch,
  affordableLevels,
  bankScaleOf,
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
  type TaxBuff,
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

export type BuyFailure = 'noMoney' | 'cooldown' | 'locked' | 'maxLevel' | 'won' | 'noOil';

const MAX_LOG = 24;

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
  unlocked: boolean;
  cooldownMs: number;
  blocker: ReturnType<typeof unlockBlocker>;
}

const BUFF_TAX_DURATION_MS = 25_000;

/** Покупки, которые бурят новую скважину со случайным дебитом. */
const WELL_UPGRADE_IDS = new Set(['t_well', 'p_field', 'p_reprivatize']);

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
  private buffs: TaxBuff[] = [];
  private autoTapAccum = 0;
  private achievementTimerMs = 0;
  private worldTarget = 1;
  private worldTimerMs = 0;
  private salesAccum = 0;
  /** Сглаженный фактический доход (то, что реально капает на счёт), ₦/с. */
  private revenueEma = 0;
  private lastSaleLogMs = 0;

  constructor(content: Content, state: GameState) {
    this.content = content;
    this.state = state;
    this.rng = new Rng(state.rngSeed);
    this.worldTarget = state.worldPrice;
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
    this.pruneBuffs();
    if (!this.derivedCache) {
      this.derivedCache = computeDerived(
        this.config, this.content.upgrades, this.state, this.buffs, this.content,
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

  private pruneBuffs(): void {
    if (this.buffs.length === 0) return;
    const alive = this.buffs.filter((b) => b.untilMs > this.state.clockMs);
    if (alive.length !== this.buffs.length) {
      this.buffs = alive;
      this.derivedCache = null;
    }
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
   * Долить нефть в резервуары.
   *
   * Нефть копится `shipDays` суток, поэтому резервуары должны вмещать
   * пятисуточную добычу — иначе она упирается в стенку и рост останавливается.
   * Когда место всё же кончается, партию отправляют досрочно (tickShipping),
   * но ничего не «сгорает»: терять добычу нельзя.
   */
  private addOil(tonnes: number): number {
    if (tonnes <= 0) return 0;
    const capacity = this.derived().oilCapacity;
    const free = Math.max(0, capacity - this.state.oil);
    const added = Math.min(free, tonnes);
    this.state.oil += added;
    const spilled = tonnes - added;
    if (spilled > 1e-9) {
      // Резервуары полны: лишнее уходит на внутренний рынок сразу, по его
      // цене. Сжигать добычу нельзя, но и копить её больше некуда —
      // поэтому расширять резервуары выгодно: экспорт и НПЗ дороже.
      const derived = this.derived();
      // Продавать «в никуда» нечему: если внутреннего рынка нет вовсе,
      // нефть просто ждёт в полных резервуарах.
      if (derived.channels.contract.rate > 0) {
        this.state.totalSold += spilled;
        this.grantCoins(
          spilled * derived.channels.contract.price * (1 - derived.taxRate),
        );
      }
      this.emit({ type: 'oilFull' });
    }
    return added;
  }

  /** Продать нефть, которая не влезла в резервуары, по цене «на разлив». */
  private grantCoins(amount: number): void {
    if (amount <= 0) return;
    this.state.coins += amount;
    this.state.totalEarned += amount;
  }

  /**
   * Начислить деньги извне (инженерное меню). Учитывается в totalEarned,
   * поэтому разблокировки по заработку тоже открываются.
   */
  addCoins(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.grantCoins(amount);
    this.invalidate();
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
    this.state.wonAtMs = this.state.clockMs;
    this.invalidate();
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

  private priceOfLevels(def: UpgradeDef, level: number, count: number): number {
    if (def.baseCost <= 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += costFor(this.config, def, level + i);
    return sum;
  }

  /** Проверка покупки без её совершения — для интерфейса. */
  checkBuy(id: string, count = 1): BuyCheck {
    const def = this.content.byId.get(id);
    if (!def) {
      return {
        ok: false, reason: 'locked', cost: 0, level: 0, maxLevel: 0,
        affordable: 0, unlocked: false, cooldownMs: 0, blocker: null,
      };
    }
    const level = this.level(id);
    const derived = this.derived();
    const unlocked = isUnlocked(def, this.state, derived.influence);
    const cooldownMs = this.state.cooldowns[id] ?? 0;
    const repeatable = isRepeatable(def);
    const wanted = def.cooldownSeconds
      ? 1
      : Math.max(1, Math.min(count, this.config.maxBuyLevels));
    const buyCount = repeatable ? wanted : Math.min(wanted, Math.max(0, def.maxLevel - level));
    const rawCost = def.win
      ? winCostOf(this.config, this.content.upgrades)
      : this.priceOfLevels(def, level, buyCount);
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
      if (!isWinReady(this.config, this.content.upgrades, this.state, this.state.coins)) {
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
      affordable: def.win
        ? (this.state.coins >= cost ? 1 : 0)
        : affordableLevels(this.config, def, level, this.state.coins),
      unlocked,
      cooldownMs,
      blocker: unlockBlocker(def, this.state, derived.influence),
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
    const buyCount = def.cooldownSeconds
      ? 1
      : Math.max(1, Math.min(count, this.config.maxBuyLevels));
    const rawCost = this.priceOfLevels(def, check.level, buyCount);
    const cost = def.conquest ? Math.round(rawCost * (1 - this.derived().conquestCut)) : rawCost;
    this.state.coins -= cost;
    // Действия с перезарядкой не «прокачиваются»: уровень остаётся 1,
    // иначе после первой покупки кнопка навсегда стала бы «Максимум».
    const newLevel = repeatable ? Math.max(1, check.level) : check.level + buyCount;
    this.state.levels[id] = newLevel;
    this.state.totalPurchases += 1;
    if (def.cooldownSeconds) this.state.cooldowns[id] = def.cooldownSeconds * 1000;
    if (def.type === 'luxury') this.state.luxurySpent += cost;
    this.invalidate();

    const payouts = this.applyImmediateEffect(def, newLevel, cost);

    // «Пробурить скважину» — это лотерея: класс скважины и её суточный дебит
    // выпадают случайно, поэтому каждая покупка даёт разную добычу.
    if (def.id === 'p_reprivatize') {
      // Реприватизация приносит случайный набор месторождений, но их
      // стоимость всегда в 5–10 раз больше, чем заплачено за активацию.
      const prize = this.applyReprivatization(cost);
      payouts.push({ id: def.id, amount: prize.dailyTonnes });
    } else if (WELL_UPGRADE_IDS.has(def.id) && !repeatable) {
      const drilled = this.drillWell();
      payouts.push({ id: def.id, amount: drilled.dailyTonnes });
    }

    // Реприватизация пишет свою строку с числом скважин и стоимостью активов,
    // поэтому общая запись «Отжато: …» для неё не нужна — иначе в журнале дубль.
    if (def.id !== 'p_reprivatize') {
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
  applyReprivatization(paid: number): ReprivatizationPrize {
    const derived = this.derived();
    const price = derived.exportPricePerTon || derived.oilPricePerTon;
    const prize = reprivatizationPrize(this.config, paid, price, () => this.rng.next());
    // Разбиваем суммарный дебит на скважины разных классов — «месторождение».
    let left = prize.dailyTonnes;
    for (let i = 0; i < prize.wells; i++) {
      const share = i === prize.wells - 1 ? left : Math.max(1, Math.round(left * (0.3 + this.rng.next() * 0.4)));
      left = Math.max(0, left - share);
      const kind: Well['kind'] = share >= 500 ? 'unique' : share >= 50 ? 'good' : 'ordinary';
      this.state.wells.push({ kind, dailyTonnes: share });
    }
    this.pushLog({
      kind: 'conquest',
      upgradeId: 'p_reprivatize',
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
        const channel = def.effect.burstChannel ?? 'export';
        const price =
          derived.channels[channel].price || derived.channels.contract.price;
        const desired = Math.min(this.state.oil, Math.max(1, this.state.oil * 0.5));
        const tonnes = this.config.oil.channels[channel].unlimited
          ? desired
          : Math.min(desired, derived.channels[channel].rate * this.config.oil.exportBurstSeconds || desired);
        if (tonnes <= 0) return payouts;
        const amount = Math.round(tonnes * price * (1 + (def.effect.exportBonus ?? 0)));
        this.state.oil -= tonnes;
        this.state.totalSold += tonnes;
        this.grantCoins(amount);
        this.pushLog({
          kind: 'sold',
          upgradeId: def.id,
          channel,
          tonnes,
          price,
          money: amount,
        });
        payouts.push({ id: def.id, amount });
        this.emit({ type: 'oneShot', id: def.id, amount });
        this.emit({ type: 'sold', channel, tonnes, money: amount });
        return payouts;
      }
      const base = eventPayout(def, derived, level, cost);
      // Операции через банк усиливаются «масштабом деятельности банка».
      const amount = def.effect.bankScale
        ? Math.round(base * this.bankScale())
        : base;
      // Отмывание через убыточный банк проходит мимо налогового ведомства:
      // деньги те же, но налог с них не берут (это и есть «уход от налогов»).
      const gross = def.effect.launder ? amount : amount;
      this.grantCoins(gross);
      this.pushLog({
        kind: def.effect.launder ? 'launder' : 'event',
        upgradeId: def.id,
        money: gross,
      });
      payouts.push({ id: def.id, amount: gross });
      this.emit({ type: 'oneShot', id: def.id, amount: gross });
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
    if (dtMs <= 0) return;
    const maxStep = 250;
    let left = dtMs;
    while (left > 0) {
      const step = Math.min(maxStep, left);
      left -= step;
      this.step(step);
      if (this.state.won) break;
    }
  }

  private step(dtMs: number): void {
    this.state.playtimeMs += dtMs;
    if (this.state.won) return;

    this.state.clockMs += dtMs;
    this.pruneBuffs();

    const dtSeconds = dtMs / 1000;
    const derived = this.derived();

    // 1. Добыча: персонал качает нефть в резервуары.
    if (derived.oilPerSecond > 0) this.addOil(derived.oilPerSecond * dtSeconds);

    // 2. Отправка партии: раз в `shipDays` суток накопленная нефть уезжает
    //    на внутренний рынок, экспорт и переработку, а продукты — на продажу.
    const gross = this.tickShipping(derived, dtSeconds);

    // 3. Налог и расходы считаются от ФАКТИЧЕСКИ проданного. Иначе пустые
    //    резервуары всё равно приносили бы деньги, а безлимитные контракты
    //    обнуляли бы «теоретический» доход.
    const expenses = this.derived().expensesPerSecond * dtSeconds;
    const net = Math.max(0, gross * (1 - this.derived().taxRate) - expenses);
    if (net > 0) this.grantCoins(net);
    this.trackRevenue(net, dtSeconds);

    this.tickCooldowns(dtMs);
    this.tickPeriodic(dtMs, derived);
    this.tickGambles();
    this.applyAutoTaps(dtMs);
    this.tickWorldPrice(dtMs);

    this.achievementTimerMs += dtMs;
    if (this.achievementTimerMs >= this.config.achievementsTickSeconds * 1000) {
      this.achievementTimerMs = 0;
      this.checkAchievements();
    }

    this.emit({ type: 'income' });
  }

  /**
   * Отправка нефти на сбыт.
   *
   * Правило заказчика: нефть копится в резервуарах `shipDays` суток (5 суток
   * = 5 реальных секунд) и только потом уезжает. Партия распределяется по
   * мощностям из `derived.flows` — тем же, что видны в таблице:
   *   внутренний рынок → экспорт сырья → переработка (остаток).
   * Переработка даёт нефтепродукты, они продаются внутри и на экспорт.
   *
   * Если резервуары переполнены, лишнее продаётся сразу по внутренней цене:
   * терять добычу нельзя. Поэтому расширять резервуары выгодно — экспорт
   * и переработка приносят больше.
   */
  private tickShipping(derived: DerivedStats, dtSeconds: number): number {
    const dayMs = Math.max(0.001, this.config.oil.wells.secondsPerDay) * 1000;
    const periodMs = Math.max(dayMs, this.config.oil.shipDays * dayMs);
    this.state.shipTimerMs += dtSeconds * 1000;

    const batch = this.state.oil;
    if (batch <= 0) return 0;

    const full = batch >= derived.oilCapacity - 1e-9;
    if (this.state.shipTimerMs < periodMs && !full) return 0;
    this.state.shipTimerMs = 0;

    // Партия больше, чем «одна секунда потоков», — в `shipBatch` разбиваем
    // её по секциям, чтобы ни один канал не получил больше своей мощности.
    return this.shipBatch(batch, derived, periodMs / 1000);
  }

  /** Распределить партию по каналам и превратить её в деньги. */
  private shipBatch(batch: number, derived: DerivedStats, seconds = 1): number {
    // Раскладываем ПАРТИЮ по мощностям, а не по уже посчитанным потокам:
    // тапы дают нефть рывками, и она обязана найти сбыт.
    const plan = allocateBatch(this.config, derived.capacities, batch, seconds);

    const money =
      plan.domestic * derived.channels.contract.price +
      plan.export * derived.channels.export.price +
      plan.productsDomestic * derived.productPriceDomestic +
      plan.productsExport * derived.productPriceExport;

    const soldCrude = plan.domestic + plan.export + plan.refined;
    this.state.oil = Math.max(0, batch - soldCrude);
    this.state.totalSold += soldCrude;
    this.salesAccum += soldCrude;
    // Что не ушло с партией (нет мощностей) остаётся на нефтебазах.
    this.state.products = Math.max(
      0,
      this.state.products + plan.products - plan.productsDomestic - plan.productsExport,
    );

    if (soldCrude > 0 && this.state.clockMs - this.lastSaleLogMs >= 3000) {
      this.lastSaleLogMs = this.state.clockMs;
      this.pushLog({
        kind: 'sold',
        tonnes: soldCrude,
        price: money / soldCrude,
        money,
        channel: plan.export >= plan.domestic && plan.export >= plan.refined
          ? 'export'
          : plan.refined >= plan.domestic ? 'refine' : 'contract',
      });
    }
    return money;
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
        if (def.effect.taxCut) {
          this.buffs.push({
            id: def.id,
            amount: def.effect.taxCut,
            untilMs: this.state.clockMs + BUFF_TAX_DURATION_MS,
          });
          this.invalidate();
        }
      }
      this.state.timers[def.id] = acc;
    }
  }

  private tickGambles(): void {
    if (this.state.gambles.length === 0) return;
    const due = this.state.gambles.filter((g) => g.resolveAt <= this.state.clockMs);
    if (due.length === 0) return;
    this.state.gambles = this.state.gambles.filter((g) => g.resolveAt > this.state.clockMs);
    for (const g of due.slice(0, MAX_GAMBLE_RESOLVES_PER_TICK)) {
      const def = this.content.byId.get(g.id);
      const chance = def?.effect.chance ?? 0.5;
      const won = this.rng.next() < chance;
      const amount = won ? Math.round(g.amount * g.factor) : 0;
      if (won) this.grantCoins(amount);
      this.emit({ type: 'gambleResult', id: g.id, won, amount });
    }
  }

  /**
   * Колебания мировой цены.
   *
   * Раньше цена фактически стояла: цель выбиралась только по истечении
   * периода, а к ней шло крайне медленное сглаживание от размера кадра.
   * Теперь цена — непрерывная волна от игровых часов: две синусоиды разных
   * периодов дают живой график без «механического» вида, а разброс всегда
   * укладывается в границы из конфига.
   */
  private tickWorldPrice(dtMs: number): void {
    const wp = this.config.worldPrice;
    this.worldTimerMs += dtMs;
    void this.worldTarget;

    const middle = (wp.min + wp.max) / 2;
    const amplitude = (wp.max - wp.min) / 2;
    const seconds = this.state.clockMs / 1000;
    const period = Math.max(3, wp.periodSeconds);
    // Фаза зависит от сида: у каждой партии свой «характер» рынка.
    const phase = (this.state.rngSeed % 360) * (Math.PI / 180);
    const wave =
      Math.sin((seconds / period) * Math.PI * 2 + phase) * 0.8 +
      Math.sin((seconds / (period * 2.7)) * Math.PI * 2 + phase * 0.6) * 0.2;
    const before = this.state.worldPrice;
    const next = Math.min(wp.max, Math.max(wp.min, middle + amplitude * wave));
    this.state.worldPrice = next;
    // Событие — только на заметное движение, чтобы не дёргать интерфейс.
    if (Math.abs(next - before) > 0.004) this.emit({ type: 'worldPrice', price: next });
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
    if (coins <= 0) return;
    this.grantCoins(coins);
    this.state.playtimeMs += seconds * 1000;
    this.emit({ type: 'offline', seconds, coins });
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
