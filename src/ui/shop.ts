/**
 * Магазин: вкладки «Политические / Технические / Роскошь / Цель» и список покупок.
 *
 * Карточки собираются один раз, при открытии вкладки. Дальше `update()`
 * только меняет их содержимое — и только там, где оно изменилось: main.ts
 * зовёт его до пяти раз в секунду, а на вкладке десятки карточек.
 */
import { clear, el, setClass, setHidden, setText } from './dom';
import { describeEffect } from './effect-line';
import { describeRequirementTerm } from './requirements';
import type { Texts } from './texts';
import { formatMoney, formatNumber } from '../core/format';
import { icon as iconPath } from '../core/assets';
import { isRepeatable, type BuyCheck, type Game } from '../core/game';
import { slotsOf, winRequirementBlocker, winRequirementTerms, type RequirementTerm } from '../core/economy';
import type { BuySlot, Tab, UpgradeDef } from '../core/types';

interface CardRefs {
  root: HTMLElement;
  name: HTMLElement;
  level: HTMLElement;
  effect: HTMLElement;
  cost: HTMLElement;
  /** Кнопки по порядку слотов: у уровней — ×1/×5/×10/MAX, у остальных — одна. */
  buttons: HTMLButtonElement[];
  lock: HTMLElement;
}

export interface ShopOptions {
  onBuy: (id: string, count: number) => void;
}

const TABS: Tab[] = ['technical', 'production', 'sales', 'political', 'luxury', 'goals'];

export class Shop {
  readonly root: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly list: HTMLElement;
  private readonly cards = new Map<string, CardRefs>();
  private readonly buttons = new Map<Tab, HTMLButtonElement>();
  private active: Tab = 'technical';
  /** Покупки открытой вкладки по возрастанию цены; список собирается при её открытии. */
  private defs: UpgradeDef[] = [];
  /** Какие покупки открывает данная. Контент не меняется, поэтому считается один раз. */
  private readonly unlockedNames = new Map<string, string[]>();

  constructor(
    private readonly game: Game,
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly options: ShopOptions,
  ) {
    this.tabBar = el('div', { class: 'tabs', role: 'tablist' });
    for (const tab of TABS) {
      const button = el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'data-tab': tab,
        'aria-selected': 'false',
      }, this.texts.get(`tabs.${tab}`));
      button.addEventListener('click', () => this.setTab(tab));
      this.buttons.set(tab, button);
      this.tabBar.append(button);
    }
    this.list = el('div', { class: 'shop__list', role: 'tabpanel' });
    this.root = el('section', { class: 'shop' }, [this.tabBar, this.list]);
    this.setTab(this.active);
  }

  get activeTab(): Tab {
    return this.active;
  }

  setTab(tab: Tab): void {
    this.active = tab;
    for (const [key, button] of this.buttons) {
      button.setAttribute('aria-selected', String(key === tab));
      button.classList.toggle('tab--active', key === tab);
    }
    this.buildList();
  }

  /**
   * Полная сборка списка — только при смене вкладки. Состав вкладки от хода
   * игры не зависит: заблокированные карточки тоже показаны. Разблокировка,
   * новый уровень и новая игра меняют содержимое карточек в `update()`.
   */
  private buildList(): void {
    clear(this.list);
    this.cards.clear();
    this.defs = this.defsFor(this.active);
    if (this.defs.length === 0) {
      this.list.append(el('p', { class: 'shop__empty' }, this.texts.get('shop.emptyTab')));
      return;
    }
    for (const def of this.defs) {
      const card = this.buildCard(def);
      this.cards.set(def.id, card.refs);
      this.list.append(card.node);
    }
  }

  private defsFor(tab: Tab): UpgradeDef[] {
    // Показываем ВСЁ, что есть на вкладке: игрок должен видеть, к чему идёт.
    // Заблокированные карточки неактивны, а красной строкой написано, что нужно.
    return this.game.content.upgrades
      .filter((u) => u.tab === tab)
      .sort((a, b) => a.baseCost - b.baseCost);
  }

  private buildCard(def: UpgradeDef): { node: HTMLElement; refs: CardRefs } {
    const icon = el('img', {
      class: 'card__icon',
      src: iconPath(def.icon),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      width: 56,
      height: 56,
    });
    const level = el('span', { class: 'card__level' }, '');
    const effect = el('span', { class: 'card__effect' }, '');
    const cost = el('span', { class: 'card__cost' }, '');
    const lock = el('span', { class: 'card__lock' }, '');

    // Карточка с уровнем получает четыре кнопки (×1, ×5, ×10, MAX), остальные —
    // одну «Купить». Кнопки создаются один раз: обновление лишь меняет их
    // доступность и цифру в `data-count`, поэтому фокус на нажатой кнопке
    // не сбрасывается.
    const slots = slotsOf(def);
    const leveled = slots.length > 1;
    const buttons: HTMLButtonElement[] = [];
    for (const slot of slots) {
      const button = el('button', {
        class: 'card__buy',
        type: 'button',
        'data-slot': slot,
      }, leveled ? this.slotLabel(slot) : this.texts.get('shop.buy'));
      button.addEventListener('click', () => {
        const count = Math.max(1, Number(button.dataset.count ?? 1));
        // Кнопка недоступной покупки выключена (`disabled`), а причина уже
        // написана на карточке. Проверка здесь — защита от устаревшей карточки:
        // состояние могло измениться между обновлениями интерфейса.
        if (!this.game.checkBuy(def.id, count).ok) return;
        this.options.onBuy(def.id, count);
      });
      buttons.push(button);
    }

    const name = el('h3', { class: 'card__name' }, this.cardName(def));
    const refs: CardRefs = { root: el('article'), name, level, effect, cost, buttons, lock };

    const node = el('article', { class: 'card', 'data-id': def.id }, [
      el('div', { class: 'card__art' }, [icon, level]),
      el('div', { class: 'card__body' }, [
        name,
        el('p', { class: 'card__desc' }, this.descriptionOf(def)),
        el('div', { class: 'card__meta' }, [effect, cost]),
        lock,
      ]),
      el('div', { class: 'card__action' }, [
        el('div', { class: 'card__buys' }, buttons),
      ]),
    ]);
    refs.root = node;
    this.refreshCard(def, refs);
    return { node, refs };
  }

  /**
   * Название карточки. У улучшений с историей (долото, насос, двигатель,
   * раствор, ГРП) каждая покупка — новая модель, поэтому показываем
   * следующую модель, а купленную — в подписи эффекта.
   */
  private cardName(def: UpgradeDef): string {
    if (!def.staged) return def.name;
    // Показываем ту модель, которую игрок купит следующим нажатием.
    const level = Math.max(1, this.game.level(def.id) + 1);
    return this.game.stagedName(def.id, level);
  }

  /** Подпись кнопки по слоту. Четыре ключа перечислены явно, чтобы сверка текстов видела каждую. */
  private slotLabel(slot: BuySlot): string {
    return slot === 'buy1'
      ? this.texts.get('shop.buy1')
      : slot === 'buy5'
        ? this.texts.get('shop.buy5')
        : slot === 'buy10'
          ? this.texts.get('shop.buy10')
          : this.texts.get('shop.buyMax');
  }

  /**
   * Применить текущее состояние к карточке. Вызывается часто, поэтому
   * проверка покупки — одна на карточку (`checkBuy`), а у уровней к ней
   * ещё один вызов `buySlotState` для состояния четырёх кнопок. DOM меняется
   * лишь там, где значение стало другим.
   */
  private refreshCard(def: UpgradeDef, refs: CardRefs): void {
    const check = this.game.checkBuy(def.id);
    const level = check.level;
    // Действие с перезарядкой (контрабанда, кризис, отмывание) не
    // «прокачивается»: у него нет максимума, иначе кнопка мигала бы между
    // «Купить» и «Максимум» после первой покупки.
    const repeatable = isRepeatable(def);
    const unlimited = Boolean(def.unlimited) && !repeatable && !def.win;

    // У покупок-действий уровень не растёт — показываем уровень коротко,
    // иначе бейдж «1/1» выглядел бы как ошибка. Для безлимитных карточек
    // показываем число купленных уровней без потолка.
    setText(refs.level, repeatable ? '×' : unlimited ? `${level}` : `${level}/${check.maxLevel}`);
    setHidden(refs.level, level <= 0 && !repeatable);
    setText(refs.name, this.cardName(def));
    setText(refs.effect, this.effectOf(def, level));
    const lockText = this.describeLock(def, check);
    setText(refs.lock, lockText);
    setHidden(refs.lock, lockText.length === 0);

    const maxed = !repeatable && !unlimited && !def.win && level >= check.maxLevel;
    setText(refs.cost, maxed
      ? this.texts.get('shop.maxLevel')
      : formatMoney(check.cost, this.currency));

    const leveled = slotsOf(def).length > 1;
    if (leveled) {
      // Уровни: кнопки фиксированы, меняется лишь доступность и цифра в
      // `data-count`. Подпись у кнопки остаётся та, которую задали при сборке.
      const slotState = this.game.buySlotState(def.id);
      for (let i = 0; i < refs.buttons.length; i += 1) {
        const button = refs.buttons[i]!;
        const slot = slotState.slots[i]!;
        const count = String(Math.max(1, slot.count));
        if (button.dataset.count !== count) button.dataset.count = count;
        if (button.disabled === slot.enabled) button.disabled = !slot.enabled;
        const reason = slot.reason;
        if (button.dataset.reason !== reason) button.dataset.reason = reason;
      }
    } else {
      // Одноразовые покупки, действия и цель: одна кнопка, подпись зависит
      // от состояния (перезарядка, потолок, финал).
      const button = refs.buttons[0]!;
      const count = String(Math.max(1, check.count));
      if (button.dataset.count !== count) button.dataset.count = count;
      let label = this.texts.get('shop.buy');
      if (def.win) label = this.texts.get('finale.buyButton');
      else if (maxed) label = this.texts.get('shop.maxLevel');
      else if (check.cooldownMs > 0) {
        label = this.texts.get('shop.cooldown', { seconds: Math.ceil(check.cooldownMs / 1000) });
      }
      setText(button, label);
      if (button.disabled === check.ok) button.disabled = !check.ok;
      const reason = check.reason ?? 'ok';
      if (button.dataset.reason !== reason) button.dataset.reason = reason;
    }

    setClass(refs.root, 'card--locked', !check.unlocked);
    setClass(refs.root, 'card--maxed', maxed);
    setClass(refs.root, 'card--conquest', !!def.conquest);
    setClass(refs.root, 'card--win', !!def.win);
    setClass(refs.root, 'card--ready', def.win ? check.ok : false);
  }

  /** Строка эффекта: текст собирает `describeEffect`, магазин даёт ему состояние игры. */
  private effectOf(def: UpgradeDef, level: number): string {
    const wells = this.game.state.wells;
    return describeEffect(def, level, {
      texts: this.texts,
      config: this.game.config,
      currency: this.currency,
      lastWell: wells[wells.length - 1],
      unlocks: this.unlockedNamesOf(def),
    });
  }

  /** Названия покупок, которым нужна данная: одна выборка на покупку, а не на каждое обновление. */
  private unlockedNamesOf(def: UpgradeDef): string[] {
    let names = this.unlockedNames.get(def.id);
    if (!names) {
      names = this.game.content.upgrades
        .filter((upgrade) => upgrade.unlockAt?.upgrade === def.id)
        .map((upgrade) => upgrade.name);
      this.unlockedNames.set(def.id, names);
    }
    return names;
  }

  /**
   * Что нужно, чтобы карточка открылась. Пишется красным прямо в карточке:
   * заблокированные покупки видит вся вкладка, а не только «следующие две».
   */
  private describeLock(def: UpgradeDef, check: BuyCheck): string {
    if (check.unlocked) {
      // У финальной цели обязательные условия лежат в config.winRequirements,
      // а не в unlockAt самой карточки. Показываем первое невыполненное —
      // из того же расчёта, по которому движок разрешает финал.
      if (def.win) {
        const blocker = winRequirementBlocker(
          this.game.config, this.game.state, this.game.derived().influence,
        );
        if (blocker) return this.describeTerm(blocker);
      }
      // Открытая карточка с выключенной кнопкой тоже объясняет причину:
      // на недоступной кнопке клик не срабатывает, поэтому пишем на карточке.
      if (check.reason === 'noOil') return this.texts.get('shop.buyFailOil');
      if (check.reason === 'noCapacity') return this.texts.get('shop.buyFailCapacity');
      if (check.reason === 'noRefinerySlot') return this.texts.get('shop.buyFailRefinerySlot');
      if (check.reason === 'yearWellLimit') {
        return this.texts.get('shop.buyFailYearLimit', {
          limit: formatNumber(this.game.config.oil.wells.maxDrillPerYear),
        });
      }
      if (check.reason === 'conquestWellLimit') {
        return this.texts.get('shop.buyFailConquestLimit', {
          limit: formatNumber(this.game.config.oil.wells.maxConquestTotal),
        });
      }
      return '';
    }
    return check.blocker ? this.describeTerm(check.blocker) : this.texts.get('shop.locked');
  }

  /**
   * Описание карточки. У финальной цели условия дописываются из
   * config.winRequirements — тем же расчётом, по которому движок разрешает
   * финал: в тексте покупки чисел нет, поэтому разойтись им не с чем.
   */
  private descriptionOf(def: UpgradeDef): string {
    if (!def.win) return def.description;
    const terms = winRequirementTerms(this.game.config);
    if (terms.length === 0) return def.description;
    return [def.description, ...terms.map((term) => `${this.describeTerm(term)}.`)].join(' ');
  }

  /** Невыполненное условие словами: порог уже итоговый, после кривой цен. */
  private describeTerm(term: RequirementTerm): string {
    return describeRequirementTerm(term, this.game.content, this.texts, this.currency);
  }

  /**
   * Частое обновление: только значения, без пересборки DOM. Узлы карточек
   * остаются теми же, поэтому фокус клавиатуры не теряется, когда покупка
   * открывает соседние карточки.
   */
  update(): void {
    for (const def of this.defs) {
      const refs = this.cards.get(def.id);
      if (refs) this.refreshCard(def, refs);
    }
  }

  /** Для тестов: сколько карточек сейчас в списке. */
  get cardCount(): number {
    return this.cards.size;
  }
}
