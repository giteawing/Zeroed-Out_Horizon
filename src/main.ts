/**
 * Точка входа. Собирает интерфейс, подключает движок, звук и эффекты.
 *
 * Правила, которые здесь соблюдаются:
 *   • тексты только из texts.json (никаких русских строк в коде);
 *   • главный цикл на requestAnimationFrame; экономика тикает раз в 100 мс,
 *     DOM-панели обновляются не чаще пяти раз в секунду;
 *   • до нажатия кнопки на стартовом экране игра стоит: ни тиков, ни
 *     сохранений, иначе офлайн-доход теряется или считается дважды;
 *   • реальное время между кадрами не обрезается: его учитывает FrameClock
 *     (ограниченная работа за кадр, перенос остатка, долгий простой — офлайн);
 *   • сохранение при visibilitychange/pagehide и раз в autosaveSeconds;
 *   • сохранение пишет только вкладка, открытая первой: вторая стоит под
 *     сообщением, пока первая не закроется (core/instance-lock.ts);
 *   • звук «разблокируется» внутри пользовательского жеста (клик по старту
 *     или по переключателю звука).
 */
import './styles/base.css';
import { loadContent, creditsIsPlaceholder } from './core/content';
import { Game } from './core/game';
import {
  createInitialState,
  normalizeState,
  offlineReport,
  parseSave,
  serializeState,
} from './core/state';
import { archiveCorruptSave, clearSave, readSave, writeSave } from './core/storage';
import { claimSave } from './core/instance-lock';
import { formatMoney, formatNumber } from './core/format';
import { Rng } from './core/rng';
import { FrameClock } from './core/clock';
import { image } from './core/assets';
import { SoundEngine } from './audio/sound';
import { Effects } from './fx/particles';
import { el } from './ui/dom';
import { Texts } from './ui/texts';
import { Hud } from './ui/hud';
import { Shop } from './ui/shop';
import { FlowControlsPanel } from './ui/flow-controls';
import { NewsFeed, purchaseRubric } from './ui/news';
import { Finale } from './ui/finale';
import { StartScreen } from './ui/start';
import { Settings } from './ui/settings';
import { Menu } from './ui/menu';
import { Rules } from './ui/rules';
import { DevMenu } from './ui/dev';
import { Wealth } from './ui/wealth';
import { AssetDetails } from './ui/asset-details';
import { OperationLog } from './ui/log';
import { OtherTabNotice } from './ui/other-tab';
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
  const parsedSave = rawSave === null ? null : parseSave(rawSave);
  const corruptSave = rawSave !== null &&
    (parsedSave === null || typeof parsedSave !== 'object' || Array.isArray(parsedSave));
  const corruptBackupSaved = corruptSave ? archiveCorruptSave(rawSave) : false;
  const hasSave = rawSave !== null && !corruptSave;
  let state: GameState = hasSave
    ? normalizeState(parsedSave, config, content)
    : createInitialState(config);
  const game = new Game(content, state);
  const uiRng = new Rng((state.rngSeed ^ 0x9e3779b9) >>> 0);

  const sound = new SoundEngine(state.soundOn);

  // ------------------------------------------------------------- часы цикла
  // Игра стоит на паузе, пока игрок не нажал кнопку на стартовом экране.
  let started = false;
  /** Сохранение держит другая вкладка: здесь игра не идёт и ничего не пишет. */
  let saveTaken = false;
  const TICK_MS = config.tickMs;
  /** Сколько тиков можно прожить за кадр: кадр не должен быть бесконечным. */
  const MAX_TICKS_PER_FRAME = 10;
  /** Простой дольше этого считается отсутствием и идёт по правилам офлайна. */
  const AWAY_AFTER_MS = 10_000;
  const clock = new FrameClock({
    tickMs: TICK_MS,
    maxTicksPerFrame: MAX_TICKS_PER_FRAME,
    awayAfterMs: AWAY_AFTER_MS,
  });

  document.title = texts.data.meta.title;

  // ------------------------------------------------------------------ разметка
  const hud = new Hud(texts, currency, config);
  const flowControls = new FlowControlsPanel(game, texts, () => {
    save();
    scheduleUi();
  });
  const rules = new Rules(content, texts, currency, () => rules.hide());
  const news = new NewsFeed(texts, uiRng);
  const finale = new Finale(content, texts, currency, {
    onRestart: () => restart(),
    onClose: () => finale.hide(),
  });
  const settings = new Settings(texts, {
    onToggleSound: (enabled) => {
      // Вызов идёт из обработчика клика, поэтому звуковой движок может
      // создать AudioContext прямо сейчас (см. SoundEngine.setEnabled).
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
  // Инженерное меню: читерская панель для быстрой проверки игры.
  const dev = new DevMenu(texts, currency, {
    onAddMoney: (amount) => {
      game.addCoins(amount);
      save();
      refreshUi();
    },
    onWin: () => {
      forceWin();
      save();
    },
    onUnlockAll: () => {
      unlockEverything();
      save();
      refreshUi();
    },
    onClose: () => dev.close(),
  });

  const wealth = new Wealth(game, texts);
  const assetDetails = new AssetDetails(game, texts, currency);
  const assetsRow = hud.root.querySelector<HTMLElement>('[data-row="assets"]');
  assetsRow?.addEventListener('click', () => assetDetails.open());
  assetsRow?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      assetDetails.open();
    }
  });

  const shop = new Shop(game, texts, currency, {
    onBuy: (id, count) => buy(id, count),
  });

  const oplog = new OperationLog(texts, currency);

  const feedbackCanvas = el('canvas', { class: 'stage__fx', 'aria-hidden': 'true' });
  const stageSize = () => {
    const rect = feedbackCanvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };
    const effects = new Effects(feedbackCanvas, config);

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
  const stageOverlay = el('div', { class: 'stage__overlay' }, [feedbackCanvas, badge]);
  if (corruptSave) showBadge(texts.get(corruptBackupSaved ? 'save.corrupt' : 'save.corruptBackupFailed'));

  /**
   * Меню шапки: одна иконка вместо пяти кнопок.
   *
   * Внутри — то же, что раньше висело в шапке (звук, роскошь, статистика,
   * настройки, инженерное меню), плюс новые «Правила игры» с описанием
   * экономики. Место в шапке дорогое: там теперь живут деньги и влияние.
   */
  const menuButton = el('button', {
    class: 'iconbtn iconbtn--menu',
    type: 'button',
    'aria-label': texts.get('menu.title'),
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
  }, [el('span', { class: 'iconbtn__icon', 'aria-hidden': 'true' }, '☰')]);

  const menu = new Menu(texts, [
    { id: 'rules', icon: '📖', label: texts.get('menu.rules'), onSelect: () => rules.open() },
    { id: 'finale', icon: '📜', label: texts.get('menu.finale'), onSelect: () => finale.show(game.state), isVisible: () => game.state.won },
    {
      id: 'sound',
      icon: '🔊',
      label: texts.get('menu.sound'),
      onSelect: () => {
        const next = !game.state.soundOn;
        sound.setEnabled(next);
        game.setSound(next);
        settings.setSound(next);
        save();
      },
      isOn: () => game.state.soundOn,
    },
    { id: 'wealth', icon: '💎', label: texts.get('panel.wealth'), onSelect: () => wealth.open() },
    { id: 'assets', icon: '🏭', label: texts.get('panel.assets'), onSelect: () => assetDetails.open() },
    {
      id: 'stats',
      icon: '📊',
      label: texts.get('panel.stats'),
      onSelect: () => toggleStats(),
    },
    ...(import.meta.env.DEV
      ? [{ id: 'dev', icon: '🛠', label: texts.get('panel.dev'), onSelect: () => dev.open(game.state.coins) }]
      : []),
    { id: 'settings', icon: '⚙️', label: texts.get('panel.settings'), onSelect: () => settings.open() },
  ]);
  menuButton.addEventListener('click', () => menu.toggle(menuButton));

  const topBar = el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar__brand' }, [
      el('img', { src: image('logo.svg'), alt: texts.data.meta.title, width: 132, height: 66 }),
    ]),
    // Кошелёк, влияние и все рыночные цены собраны в верхней панели.
    el('div', { class: 'topbar__wallet' }, [
      el('div', { class: 'topbar__stat' }, [
        el('span', { class: 'topbar__wallet-label' }, texts.get('hud.balance')),
        hud.balance,
      ]),
      el('div', { class: 'topbar__stat topbar__stat--influence' }, [
        el('span', { class: 'topbar__wallet-label' }, texts.get('hud.influence')),
        el('div', { class: 'topbar__influence' }, [
          hud.influence.value,
          el('div', { class: 'topbar__influence-track' }, [hud.influence.fill]),
        ]),
      ]),
      el('div', { class: 'topbar__market' }, [hud.marketPrices]),
    ]),
    el('div', { class: 'topbar__actions' }, [menuButton]),
  ]);

  const stage = el('main', { class: 'stage' }, [
    // Левый, широкий столбец — магазин со вкладками.
    el('div', { class: 'stage__main' }, [shop.root]),
    // Правый, узкий столбец — показатели, маршруты и журнал операций.
    el('aside', { class: 'stage__side' }, [
      hud.root,
      flowControls.root,
      oplog.root,
    ]),
    stageOverlay,
  ]);

  const newsBar = el('div', { class: 'newspane' }, [news.root]);

  app.append(
    el('div', { class: 'screen' }, [topBar, stage, newsBar]),
    settings.root,
    rules.root,
    dev.root,
    wealth.root,
    assetDetails.root,
    finale.root,
    menu.root,
  );
  settings.setSound(game.state.soundOn);
  settings.setParticles(game.state.particlesOn);
  effects.setEnabled(game.state.particlesOn);

  // -------------------------------------------------------- стартовый экран
  const start = new StartScreen(texts, { onStart: (fresh) => onStart(fresh) }, hasSave);
  app.append(start.root);

  function onStart(fresh: boolean): void {
    // Сохранение держит другая вкладка: здесь нельзя ни начать, ни стереть.
    if (saveTaken) return;
    sound.unlock();
    // С этого момента игра идёт: разрешены тики и сохранения.
    started = true;
    if (fresh) {
      state = createInitialState(config);
      restartWith(state);
      // Новая партия сразу заменяет старый сейв, а не через autosaveSeconds.
      if (hasSave) save();
    } else if (hasSave) {
      applyOfflineIncome();
      if (game.state.won) finale.show(game.state);
    }
    // Время на стартовом экране игрой не считается: отсчёт начинается сейчас.
    clock.reset(performance.now());
    start.hide();
    scheduleUi();
    news.push('start');
  }

  /** Инженерное меню: мгновенная победа (финальный насос без требований). */
  function forceWin(): void {
    if (game.state.won) return;
    game.forceWin();
    dev.close();
    refreshUi();
  }

  /**
   * Инженерное меню: снять требования по деньгам, покупкам и влиянию —
   * все карточки становятся доступными для покупки.
   */
  function unlockEverything(): void {
    game.unlockAllForDevelopment();
    shop.setTab(shop.activeTab);
  }

  function restart(): void {
    if (saveTaken) return;
    clearSave();
    state = createInitialState(config);
    restartWith(state);
    finale.hide();
    settings.close();
    wealth.close();
    assetDetails.close();
    scheduleUi();
  }

  /** Пересоздать движок на новом состоянии (новая игра). */
  function restartWith(next: GameState): void {
    game.reset(next);
    shop.setTab(shop.activeTab);
    refreshUi();
  }

  /**
   * Начислить доход за время отсутствия.
   *
   * Без аргумента интервал считается от последнего сохранения (запуск игры,
   * возврат в скрытую вкладку). С `awayMs` — за известный простой видимой
   * вкладки: последнее автосохранение было раньше начала простоя, и расчёт
   * «от сейва» посчитал бы уже прожитые секунды повторно.
   */
  function applyOfflineIncome(awayMs?: number): void {
    const nowWallMs = Date.now();
    const report = offlineReport(
      config,
      game.derived().netPerSecond,
      awayMs === undefined ? game.state.savedAtWallMs : nowWallMs - awayMs,
      nowWallMs,
    );
    if (report.seconds > 0) {
      game.applyOffline(report.seconds, report.coins);
      if (report.coins > 0) showBadge(`+${formatMoney(report.coins, currency)}`);
    }
    // Закрываем офлайн-интервал сразу, иначе быстрый reload до autosave
    // может повторно начислить одну и ту же выплату.
    save();
  }

  // ------------------------------------------------------------- сохранение
  let lastSaveAt = 0;
  let saveWarningShown = false;
  function save(): void {
    // До старта нельзя перезаписывать savedAtWallMs: от него считается офлайн.
    if (!started) return;
    const snapshot = game.snapshot();
    const stored = writeSave(serializeState(snapshot));
    if (!stored && !saveWarningShown) {
      saveWarningShown = true;
      showBadge(texts.get('save.writeFailed'));
    }
    lastSaveAt = performance.now();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  window.addEventListener('pagehide', () => save());
  window.addEventListener('beforeunload', () => save());

  // --------------------------------------------------------------- покупки
  function buy(id: string, count = 1): void {
    const def = content.byId.get(id);
    const result = game.buy(id, count);
    // Отказ озвучивает обработчик события `error` ниже.
    if (!result.ok || !def) return;
    sound.purchase();
    if (result.payouts.length > 0) {
      effects.burst(stageSize().width / 2, stageSize().height * 0.55, 16);
      // Деньги всплывают по событию `oneShot` (ниже), здесь — только прирост
      // добычи: дебит новых скважин в тоннах, а не в деньгах.
      const tonnesPerDay = result.payouts
        .filter((payout) => payout.unit === 'tonnesPerDay')
        .reduce((sum, payout) => sum + payout.amount, 0);
      if (tonnesPerDay > 0) {
        effects.floatText(
          stageSize().width / 2,
          stageSize().height * 0.45,
          texts.get('shop.wellsGain', { value: formatNumber(tonnesPerDay) }),
          'gold',
        );
      }
    } else if (def.type === 'luxury') {
      effects.burst(stageSize().width / 2, stageSize().height * 0.5, 10);
    }
    // О финале лента сообщает сама (onWin).
    if (!def.win) news.push(purchaseRubric(def));
    if (def.type === 'gamble') sound.event(true);
    save();
    refreshUi();
  }

  // ------------------------------------------------------------------ цикл
  let uiDirty = true;
  let uiRefreshElapsed = 0;
  const UI_REFRESH_INTERVAL_MS = 200;
  let newsTimer = 0;
  let hidden = false;

  function scheduleUi(): void {
    uiDirty = true;
  }

  game.on((event) => {
    switch (event.type) {
      case 'oneShot':
        sound.coin();
        effects.floatText(stageSize().width / 2, stageSize().height * 0.42, `+${formatMoney(event.amount, currency)}`, 'gold');
        break;
      case 'periodic':
        sound.coin();
        effects.floatText(stageSize().width * 0.36, stageSize().height * 0.4, `+${formatMoney(event.amount, currency)}`, 'gain');
        news.push('periodic');
        break;
      case 'gambleResult':
        sound.event(event.won);
        showBadge(
          event.won
            ? `+${formatMoney(event.amount, currency)}`
            : texts.get('shop.gambleLost'),
        );
        news.push(event.won ? 'gambleWin' : 'gambleLose');
        break;
      case 'drilled': {
        // Новая скважина: показываем, сколько ей досталось — это лотерея.
        const kind = texts.get(`wells.${event.kind}`);
        showBadge(
          texts.get('shop.wellDrilled', {
            kind,
            value: formatNumber(event.dailyTonnes),
          }),
        );
        sound.event(true);
        break;
      }
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
          showBadge(texts.get('shop.oilFull'));
          window.setTimeout(() => { oilFullShown = false; }, 8000);
        }
        break;
      case 'offline':
        break;
      case 'error':
        // Покупка не состоялась. Кнопка недоступной карточки выключена, а
        // причина написана на ней; сюда попадает только устаревшая карточка.
        if (event.code === 'noMoney' || event.code === 'noOil' || event.code === 'noCapacity') {
          sound.event(false);
        }
        break;
      default:
        break;
    }
    scheduleUi();
  });

  let oilFullShown = false;

  function onWin(): void {
    sound.fanfare();
    news.push('win');
    save();
    effettiWin();
    window.setTimeout(() => finale.show(game.state), 700);
  }

  function effettiWin(): void {
    const size = stageSize();
    effects.burst(size.width / 2, size.height / 2, 36);
  }

  function frame(now: number): void {
    const running = started && !hidden;
    const step = clock.advance(now, running);
    if (running) {
      if (step.awayMs > 0) {
        // Видимая вкладка стояла слишком долго (сон ноутбука, отладчик):
        // это время начисляется как отсутствие, а не симулируется тиками.
        applyOfflineIncome(step.awayMs);
        scheduleUi();
      }
      // Экономический тик ровно раз в TICK_MS, независимо от fps. Остаток
      // времени FrameClock переносит на следующие кадры.
      for (let tick = 0; tick < step.ticks; tick++) game.update(TICK_MS);
      newsTimer += step.elapsedMs;
      if (newsTimer > 15000) {
        newsTimer = 0;
        // Фоновая новость — только о том, что у игрока уже есть.
        news.pushRandom({ content, state: game.state, derived: game.derived() });
      }
      if (performance.now() - lastSaveAt > config.autosaveSeconds * 1000) save();
    }
    if (uiDirty) {
      uiRefreshElapsed += step.elapsedMs;
      if (uiRefreshElapsed >= UI_REFRESH_INTERVAL_MS) refreshUi();
    }
    requestAnimationFrame(frame);
  }

  function refreshUi(): void {
    uiDirty = false;
    uiRefreshElapsed = 0;
    const derived = game.derived();
    hud.update(game.state, derived);
    flowControls.update(game.state, derived);
    oplog.update(game.state.log);
    shop.update();
  }

  function toggleStats(): void {
    showBadge(statsLine());
  }

  function statsLine(): string {
    const minutes = Math.round(game.state.playtimeMs / 60000);
    return `${texts.get('stats.time')}: ${minutes} · ${texts.get('stats.production')}: ${formatNumber(game.derived().oilPerSecond)} ${texts.get('units.perSecondTonnes')}`;
  }

  // Пауза, когда вкладка не видна: экономим батарею и не начисляем «за кадром».
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    clock.reset(performance.now());
    // До старта возвращение во вкладку ничего не начисляет: офлайн-доход
    // считается один раз, при нажатии «Продолжить».
    if (!hidden && started) {
      applyOfflineIncome();
      scheduleUi();
    }
  });

  // ------------------------------------------------------- диалоги-хелперы
  // Escape закрывает только верхнее окно. Порядок — обратный порядку
  // добавления в DOM: что добавлено позже, то нарисовано выше.
  const sheets: Array<{ visible: boolean; close: () => void }> = [
    // Финал закрывается как остальные окна; вернуться к титрам можно из меню.
    { get visible() { return finale.visible; }, close: () => finale.hide() },
    assetDetails,
    wealth,
    dev,
    { get visible() { return rules.visible; }, close: () => rules.hide() },
    settings,
  ];
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const top = sheets.find((sheet) => sheet.visible);
    if (top) top.close();
  });

  window.addEventListener('resize', () => {
    effects.resize();
  });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => effects.resize()).observe(feedbackCanvas);
  }

  // ------------------------------------------------- одна игра — одна вкладка
  // Сообщение живёт вне #app: сама игра под ним выключается целиком (inert).
  const otherTab = new OtherTabNotice(texts);
  document.body.append(otherTab.root);
  /** Игрок успел начать до того, как выяснилось, что сохранение занято. */
  let interrupted = false;
  claimSave({
    onBusy: () => {
      saveTaken = true;
      interrupted = started;
      // Всё, что зависит от `started`, останавливается: тики, сохранения,
      // офлайн-доход при возврате во вкладку.
      started = false;
      app.toggleAttribute('inert', true);
      otherTab.show();
    },
    onFree: () => {
      // Первая вкладка могла наиграть и сохраниться: тогда в памяти этой —
      // устаревший сейв, и продолжать с него нельзя.
      if (interrupted || readSave() !== rawSave) {
        window.location.reload();
        return;
      }
      saveTaken = false;
      app.toggleAttribute('inert', false);
      otherTab.hide();
    },
  });

  // -------------------------------------------------------------- диагностика
  // Нужно e2e-тестам и отладке: window.__game позволяет проверить состояние.
  (window as unknown as { __game: Game }).__game = game;
  (window as unknown as { __creditsPlaceholder: boolean }).__creditsPlaceholder =
    creditsIsPlaceholder(creditsRaw);

  // Первый кадр рисуем сразу: иначе до следующего requestAnimationFrame
  // (в скрытой вкладке и в тестах он может не прийти) панель стоит пустой.
  refreshUi();
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
