/**
 * Игровой движок. Держит состояние, применяет действия и крутит экономику.
 * Не знает про DOM: UI подписывается на события и читает состояние.
 */
import {
  CHANNELS,
  affordableLevels,
  computeDerived,
  costFor,
  eventPayout,
  isUnlocked,
  isWinReady,
  levelOf,
  sellOil,
  tapReward,
  unlockBlocker,
  winCostOf,
  type TaxBuff,
} from './economy';
import type {
  Channel,
  Content,
  DerivedStats,
  GameEvent,
  GameState,
  LogEntry,
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

  private invalidate(): void {
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

  /** Долить нефть в резервуары. Лишнее «переливается» и теряется. */
  private addOil(tonnes: number): number {
    if (tonnes <= 0) return 0;
    const capacity = this.derived().oilCapacity;
    const free = Math.max(0, capacity - this.state.oil);
    const added = Math.min(free, tonnes);
    this.state.oil += added;
    if (added < tonnes - 1e-9) this.emit({ type: 'oilFull' });
    return added;
  }

  private addCoins(amount: number): void {
    if (amount <= 0) return;
    this.state.coins += amount;
    this.state.totalEarned += amount;
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
    this.pushLog({
      kind: def.conquest ? 'conquest' : def.tab === 'luxury' ? 'bought' : 'bought',
      upgradeId: def.id,
      money: cost,
    });
    this.emit({ type: 'purchase', id, level: newLevel, cost });
    if (def.achievement) this.grantAchievement(def.achievement);
    this.checkAchievements();
    return { ok: true, cost, level: newLevel, payouts };
  }

  /** Мгновенные эффекты покупки: разовая выплата, старт гэмбла, таймер периодики. */
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
        this.addCoins(amount);
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
      const amount = eventPayout(def, derived, level, cost);
      // Отмывание через убыточный банк проходит мимо налогового ведомства:
      // деньги те же, но налог с них не берут (это и есть «уход от налогов»).
      const gross = def.effect.launder ? amount : amount;
      this.addCoins(gross);
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
  update(dtMs: number): void {
    if (dtMs <= 0) return;
    this.state.playtimeMs += dtMs;
    if (this.state.won) return;

    this.state.clockMs += dtMs;
    this.pruneBuffs();

    const dtSeconds = dtMs / 1000;
    const derived = this.derived();

    // 1. Добыча: персонал качает нефть в резервуары.
    if (derived.oilPerSecond > 0) this.addOil(derived.oilPerSecond * dtSeconds);

    // 2. Сбыт: нефть из резервуаров превращается в деньги.
    const gross = this.tickSales(this.derived(), dtSeconds);

    // 3. Налог и расходы считаются от ФАКТИЧЕСКИ проданного. Иначе пустые
    //    резервуары всё равно приносили бы деньги, а безлимитные контракты
    //    обнуляли бы «теоретический» доход.
    const expenses = this.derived().expensesPerSecond * dtSeconds;
    const net = Math.max(0, gross * (1 - this.derived().taxRate) - expenses);
    if (net > 0) this.addCoins(net);
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
   * Продажа нефти за интервал: сначала НПЗ, потом экспорт, потом контракты.
   * Возвращает, сколько денег принёс интервал (для журнала и событий).
   */
  private tickSales(derived: DerivedStats, dtSeconds: number): number {
    if (this.state.oil <= 0) {
      this.salesAccum = 0;
      return 0;
    }
    const unlimited = CHANNELS.filter((c) => this.config.oil.channels[c].unlimited);
    const result = sellOil(derived, this.state.oil, dtSeconds, unlimited);
    if (result.sold <= 0) return 0;
    this.state.oil = result.oil;
    this.state.totalSold += result.sold;
    this.salesAccum += result.sold;
    // Журнал не спамим: пишем одну сводную строку примерно раз в 3 секунды.
    if (this.state.clockMs - this.lastSaleLogMs >= 3000) {
      this.lastSaleLogMs = this.state.clockMs;
      this.pushLog({
        kind: 'sold',
        tonnes: result.sold,
        price: result.sold > 0 ? result.gross / result.sold : derived.oilPricePerTon,
        money: result.gross,
        channel: this.dominantChannel(result.byChannel),
      });
      this.emit({
        type: 'sold',
        channel: this.dominantChannel(result.byChannel),
        tonnes: result.sold,
        money: result.gross,
      });
    }
    return result.gross;
  }

  /** Какой канал продал больше всего нефти за интервал. */
  private dominantChannel(byChannel: Record<Channel, number>): Channel {
    let best: Channel = 'contract';
    let bestTonnes = -1;
    for (const channel of CHANNELS) {
      if (byChannel[channel] > bestTonnes) {
        bestTonnes = byChannel[channel];
        best = channel;
      }
    }
    return best;
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
        this.addCoins(amount);
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
      if (won) this.addCoins(amount);
      this.emit({ type: 'gambleResult', id: g.id, won, amount });
    }
  }

  private tickWorldPrice(dtMs: number): void {
    const wp = this.config.worldPrice;
    this.worldTimerMs += dtMs;
    if (this.worldTimerMs >= Math.max(2000, wp.periodSeconds * 1000)) {
      this.worldTimerMs = 0;
      this.worldTarget = wp.min + this.rng.next() * (wp.max - wp.min);
    }
    const before = this.state.worldPrice;
    const step = Math.min(1, dtMs / 1000) * wp.smoothing;
    const next = Math.min(wp.max, Math.max(wp.min, before + (this.worldTarget - before) * step));
    this.state.worldPrice = next;
    if (Math.abs(next - before) > 0.05) this.emit({ type: 'worldPrice', price: next });
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
    this.addCoins(coins);
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
