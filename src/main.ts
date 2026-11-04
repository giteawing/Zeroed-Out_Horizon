/**
 * Точка входа. Собирает интерфейс, подключает движок, звук и эффекты.
 *
 * Правила, которые здесь соблюдаются:
 *   • тексты только из texts.json (никаких русских строк в коде);
 *   • главный цикл на requestAnimationFrame, экономический тик — раз в 100 мс;
 *   • сохранение при visibilitychange/pagehide и раз в autosaveSeconds;
 *   • звук «разблокируется» на первом pointerdown (требование iOS).
 */
import './styles/base.css';
import { loadContent, creditsIsPlaceholder } from './core/content';
import { Game } from './core/game';
import {
  SAVE_KEY,
  createInitialState,
  normalizeState,
  offlineReport,
  parseSave,
  serializeState,
} from './core/state';
import { clearSave, readSave, writeSave } from './core/storage';
import { formatMoney, formatNumber } from './core/format';
import { Rng } from './core/rng';
import { image } from './core/assets';
import { SoundEngine } from './audio/sound';
import { Effects } from './fx/particles';
import { el } from './ui/dom';
import { Texts } from './ui/texts';
import { Hud } from './ui/hud';
import { Shop } from './ui/shop';
import { Drill } from './ui/drill';
import { NewsFeed } from './ui/news';
import { Finale } from './ui/finale';
import { StartScreen } from './ui/start';
import { Settings } from './ui/settings';
import { Wealth } from './ui/wealth';
import { OperationLog } from './ui/log';
import creditsRaw from './content/credits.txt?raw';
import type { GameState } from './core/types';

function boot(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const content = loadContent({ credits: creditsRaw });
  const texts = new Texts(content.texts);
  const config = content.config;
  const currency = config.currency;

  // ------------------------------------------------------- состояние и движок
  const rawSave = readSave();
  const hasSave = rawSave !== null;
  let state: GameState = hasSave
    ? normalizeState(parseSave(rawSave), config, content)
    : createInitialState(config);
  const game = new Game(content, state);
  const uiRng = new Rng((state.rngSeed ^ 0x9e3779b9) >>> 0);

  const sound = new SoundEngine(state.soundOn);

  document.title = texts.data.meta.title;

  // ------------------------------------------------------------------ разметка
  const hud = new Hud(texts, currency);
  const news = new NewsFeed(texts, uiRng);
  const finale = new Finale(content, texts, currency, {
    onRestart: () => restart(),
    onClose: () => finale.hide(),
  });
  const settings = new Settings(texts, {
    onToggleSound: (enabled) => {
      sound.setEnabled(enabled);
      game.setSound(enabled);
      save();
    },
    onToggleParticles: (enabled) => {
      game.setParticles(enabled);
      effects.setEnabled(enabled);
      save();
    },
    onNewGame: () => restart(),
    onClose: () => settings.close(),
  });
  const wealth = new Wealth(game, texts);

  const shop = new Shop(game, texts, currency, {
    onBuy: (id) => buy(id),
    onError: (check) => reportBuyError(check.reason),
  });

  const oplog = new OperationLog(texts, currency);

  const drill = new Drill(texts, {
    onTap: ({ x, y }) => {
      // Тап добывает нефть. Деньги появятся, когда её продадут каналы сбыта.
      const gain = game.tap();
      if (gain <= 0) return;
      sound.tap();
      effects.splash(x, y, 1);
      effects.floatText(x, y - 10, `+${formatNumber(gain)} т`, 'gain');
      scheduleUi();
    },
    onFirstTouch: () => {
      sound.unlock();
    },
  });

  const effects = new Effects(drill.canvas, config);

  const badge = el('div', { class: 'badge', hidden: true });
  const showBadge = (text: string) => {
    badge.textContent = text;
    badge.hidden = false;
    badge.classList.remove('badge--in');
    void badge.offsetWidth;
    badge.classList.add('badge--in');
    window.setTimeout(() => {
      badge.hidden = true;
    }, 2600);
  };

  const topBar = el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar__brand' }, [
      el('img', { src: image('logo.svg'), alt: texts.data.meta.title, width: 132, height: 66 }),
    ]),
    el('div', { class: 'topbar__actions' }, [
      button('sound', () => {
        const next = !game.state.soundOn;
        sound.setEnabled(next);
        game.setSound(next);
        settings.setSound(next);
        if (next) sound.unlock();
        save();
        updateSoundButton();
      }),
      button('wealth', () => wealth.open()),
      button('stats', () => finale.visible ? undefined : toggleStats()),
      button('settings', () => settings.open()),
    ]),
  ]);

  function button(kind: 'sound' | 'wealth' | 'stats' | 'settings', handler: () => void): HTMLButtonElement {
    const node = el('button', {
      class: `iconbtn iconbtn--${kind}`,
      type: 'button',
      'aria-label': texts.get(`panel.${kind === 'sound' ? 'settings' : kind}`),
      'data-kind': kind,
    });
    node.append(el('span', { class: 'iconbtn__icon', 'aria-hidden': 'true' }, iconText(kind)));
    node.addEventListener('click', handler);
    return node;
  }

  function iconText(kind: 'sound' | 'wealth' | 'stats' | 'settings'): string {
    // Иконки — обычные юникод-символы: файлов не нужно, масштабируется без потерь.
    return { sound: '🔊', wealth: '💎', stats: '📊', settings: '⚙️' }[kind];
  }

  function updateSoundButton(): void {
    const node = topBar.querySelector<HTMLButtonElement>('.iconbtn--sound');
    if (!node) return;
    const icon = node.querySelector('.iconbtn__icon');
    if (icon) icon.textContent = game.state.soundOn ? '🔊' : '🔇';
    node.setAttribute('aria-pressed', String(game.state.soundOn));
  }

  const stage = el('main', { class: 'stage' }, [
    // Слева (сверху на телефоне): скважина и журнал операций под ней.
    el('div', { class: 'stage__middle' }, [drill.root, oplog.root, badge]),
    // Справа (снизу на телефоне): панель империи и магазин.
    el('aside', { class: 'stage__side' }, [hud.root, shop.root]),
  ]);

  const newsBar = el('div', { class: 'newspane' }, [news.root]);

  app.append(
    el('div', { class: 'screen' }, [topBar, stage, newsBar]),
    settings.root,
    wealth.root,
    finale.root,
  );
  updateSoundButton();
  settings.setSound(game.state.soundOn);
  settings.setParticles(game.state.particlesOn);
  effects.setEnabled(game.state.particlesOn);

  // -------------------------------------------------------- стартовый экран
  const start = new StartScreen(texts, { onStart: (fresh) => onStart(fresh) }, hasSave);
  app.append(start.root);

  function onStart(fresh: boolean): void {
    sound.unlock();
    if (fresh) {
      state = createInitialState(config);
      restartWith(state);
    } else if (hasSave) {
      applyOfflineIncome();
    }
    start.hide();
    scheduleUi();
    news.push('start');
  }

  function restart(): void {
    clearSave();
    state = createInitialState(config);
    restartWith(state);
    finale.hide();
    settings.close();
    wealth.close();
    scheduleUi();
  }

  /** Пересоздать движок на новом состоянии (новая игра). */
  function restartWith(next: GameState): void {
    game.state = next;
    game.state.rngSeed = next.rngSeed;
    (game as unknown as { rng: Rng }).rng = new Rng(next.rngSeed);
    (game as unknown as { derivedCache: unknown }).derivedCache = null;
    shop.setTab(shop.activeTab);
    updateSoundButton();
    refreshUi(true);
  }

  function applyOfflineIncome(): void {
    const report = offlineReport(
      config,
      game.derived().netPerSecond,
      state.savedAtWallMs,
      Date.now(),
    );
    if (report.coins > 0) {
      game.applyOffline(report.seconds, report.coins);
      showBadge(`+${formatMoney(report.coins, currency)}`);
    }
  }

  // ------------------------------------------------------------- сохранение
  let lastSaveAt = 0;
  function save(): void {
    const snapshot = game.snapshot();
    writeSave(`${JSON.stringify(snapshot)}`);
    lastSaveAt = performance.now();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  window.addEventListener('pagehide', () => save());
  window.addEventListener('beforeunload', () => save());

  // --------------------------------------------------------------- покупки
  function buy(id: string): void {
    const def = content.byId.get(id);
    const result = game.buy(id);
    if (!result.ok) {
      if (result.reason === 'noMoney' || result.reason === 'noOil') sound.event(false);
      return;
    }
    sound.purchase();
    drill.shake();
    const gain = result.payouts.reduce((sum, payout) => sum + payout.amount, 0);
    if (gain > 0) {
      effects.burst(drill.size.width / 2, drill.size.height * 0.55, 16);
      effects.floatText(drill.size.width / 2, drill.size.height * 0.45, `+${formatMoney(gain, currency)}`, 'gold');
      news.push(randomNewsFor(id));
    } else if (def?.type === 'luxury') {
      effects.burst(drill.size.width / 2, drill.size.height * 0.5, 10);
    } else {
      news.push('milestone');
    }
    if (result.ok && def?.type === 'gamble') sound.event(true);
    save();
    refreshUi(true);
  }

  function randomNewsFor(id: string): string {
    const def = content.byId.get(id);
    if (!def) return 'milestone';
    if (def.type === 'luxury') return 'luxury';
    if (def.type === 'oneShot' && def.effect.usesWorldPrice) return 'export';
    if (def.type === 'gamble') return 'gambleWin';
    if (def.tab === 'political') return 'tax';
    if (def.type === 'periodic') return 'periodic';
    return 'milestone';
  }

  function reportBuyError(reason: string | undefined): void {
    const key =
      reason === 'cooldown' ? 'shop.buyFailCooldown' :
      reason === 'locked' ? 'shop.buyFailLocked' :
      'shop.buyFail';
    showBadge(texts.get(key));
  }

  // ------------------------------------------------------------------ цикл
  const TICK_MS = config.tickMs;
  let lastFrame = performance.now();
  let accumulator = 0;
  let uiDirty = true;
  let newsTimer = 0;
  let hidden = false;

  function scheduleUi(): void {
    uiDirty = true;
  }

  game.on((event) => {
    switch (event.type) {
      case 'oneShot':
        sound.coin();
        effects.floatText(drill.size.width / 2, drill.size.height * 0.42, `+${formatMoney(event.amount, currency)}`, 'gold');
        break;
      case 'periodic':
        sound.coin();
        effects.floatText(drill.size.width * 0.36, drill.size.height * 0.4, `+${formatMoney(event.amount, currency)}`, 'gain');
        news.push('periodic');
        break;
      case 'gambleResult':
        sound.event(event.won);
        drill.shake();
        showBadge(
          event.won
            ? `+${formatMoney(event.amount, currency)}`
            : texts.get('shop.buyFail'),
        );
        news.push(event.won ? 'gambleWin' : 'gambleLose');
        break;
      case 'achievement': {
        const def = content.texts.achievements.list.find((a) => a.id === event.id);
        if (def) showBadge(`${def.name}`);
        sound.coin();
        break;
      }
      case 'win':
        onWin();
        break;
      case 'sold':
        // Продажа идёт непрерывно: не шумим звуком, но обновляем цифры.
        break;
      case 'oilFull':
        if (!oilFullShown) {
          oilFullShown = true;
          showBadge(texts.get('shop.buyFailOil'));
          window.setTimeout(() => { oilFullShown = false; }, 8000);
        }
        break;
      case 'offline':
        break;
      default:
        break;
    }
    scheduleUi();
  });

  let oilFullShown = false;

  function onWin(): void {
    sound.fanfare();
    save();
    drill.shake();
    effettiWin();
    window.setTimeout(() => finale.show(game.state), 700);
  }

  function effettiWin(): void {
    const size = drill.size;
    effects.burst(size.width / 2, size.height / 2, 36);
  }

  function frame(now: number): void {
    const dt = Math.min(250, now - lastFrame);
    lastFrame = now;
    if (!hidden) {
      accumulator += dt;
      // Экономический тик ровно раз в TICK_MS, независимо от fps.
      let ticks = 0;
      while (accumulator >= TICK_MS && ticks < 20) {
        accumulator -= TICK_MS;
        game.update(TICK_MS);
        ticks++;
      }
      newsTimer += dt;
      if (newsTimer > 15000) {
        newsTimer = 0;
        news.pushRandom();
      }
      if (now - lastSaveAt > config.autosaveSeconds * 1000) save();
    }
    if (uiDirty) {
      uiDirty = false;
      refreshUi(false);
    }
    requestAnimationFrame(frame);
  }

  let lastWinShown = false;
  function refreshUi(forceShop: boolean): void {
    const derived = game.derived();
    hud.update(game.state, derived, derived.winCost);
    oplog.update(game.state.log);
    shop.update();
    void forceShop;
    if (game.state.won && !lastWinShown) {
      lastWinShown = true;
    }
  }

  function toggleStats(): void {
    showBadge(statsLine());
  }

  function statsLine(): string {
    const minutes = Math.round(game.state.playtimeMs / 60000);
    return `${texts.get('stats.time')}: ${minutes} · ${texts.get('stats.taps')}: ${game.state.totalTaps}`;
  }

  // Пауза, когда вкладка не видна: экономим батарею и не начисляем «за кадром».
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    lastFrame = performance.now();
    if (!hidden) {
      accumulator = 0;
      applyOfflineIncome();
      scheduleUi();
    }
  });

  // ------------------------------------------------------- диалоги-хелперы
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (settings.visible) settings.close();
      else if (wealth.visible) wealth.close();
    }
  });

  window.addEventListener('resize', () => {
    effects.resize();
  });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => effects.resize()).observe(drill.canvas);
  }

  // -------------------------------------------------------------- диагностика
  // Нужно e2e-тестам и отладке: window.__game позволяет проверить состояние.
  (window as unknown as { __game: Game }).__game = game;
  (window as unknown as { __creditsPlaceholder: boolean }).__creditsPlaceholder =
    creditsIsPlaceholder(creditsRaw);
  void SAVE_KEY;
  void serializeState;

  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
