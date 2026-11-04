/**
 * Игровой движок. Держит состояние, применяет действия и крутит экономику.
 * Не знает про DOM: UI подписывается на события и читает состояние.
 */
import {
  affordableLevels,
  computeDerived,
  costFor,
  eventPayout,
  exportPayout,
  isUnlocked,
  isWinReady,
  levelOf,
  netForInterval,
  tapReward,
  unlockBlocker,
  winCostOf,
  type TaxBuff,
} from './economy';
import type { Content, DerivedStats, GameEvent, GameState, UpgradeDef } from './types';
import { Rng } from './rng';

export type BuyFailure = 'noMoney' | 'cooldown' | 'locked' | 'maxLevel' | 'won';

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
      this.derivedCache = computeDerived(this.config, this.content.upgrades, this.state, this.buffs);
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

  /** Тап по долоту. Возвращает начисленную сумму (0, если игра уже выиграна). */
  tap(): number {
    if (this.state.won) return 0;
    const amount = tapReward(this.derived(), this.rng.next());
    this.addCoins(amount);
    this.state.totalTaps += 1;
    this.emit({ type: 'tap', amount });
    if (this.state.totalTaps === 1) this.checkAchievements();
    return amount;
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
    this.addCoins(this.derived().tapValue * count);
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
    const unlocked = isUnlocked(def, this.state);
    const cooldownMs = this.state.cooldowns[id] ?? 0;
    const repeatable = isRepeatable(def);
    const wanted = def.cooldownSeconds
      ? 1
      : Math.max(1, Math.min(count, this.config.maxBuyLevels));
    const buyCount = repeatable ? wanted : Math.min(wanted, Math.max(0, def.maxLevel - level));
    const cost = def.win
      ? winCostOf(this.config, this.content.upgrades)
      : this.priceOfLevels(def, level, buyCount);

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
      blocker: unlockBlocker(def, this.state),
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
    const cost = this.priceOfLevels(def, check.level, buyCount);
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
      const amount = def.effect.usesWorldPrice
        ? exportPayout(def, derived, this.state.worldPrice)
        : eventPayout(def, derived, level, cost);
      this.addCoins(amount);
      payouts.push({ id: def.id, amount });
      this.emit({ type: 'oneShot', id: def.id, amount });
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

    const derived = this.derived();
    const net = netForInterval(derived, dtMs / 1000);
    if (net > 0) this.addCoins(net);

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
