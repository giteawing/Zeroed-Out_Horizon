/**
 * Инженерное меню: читерская панель для проверки игры без многочасового гринда.
 * Открывается кнопкой 🛠 в шапке. Всё, что здесь есть, сразу пишется в сейв.
 */
import { el } from './dom';
import { formatMoney } from '../core/format';
import type { Texts } from './texts';

export interface DevMenuCallbacks {
  /** Начислить деньги «из воздуха» (в нефтефантиках). */
  onAddMoney: (amount: number) => void;
  /** Мгновенно купить финальный насос, не собирая деньги. */
  onWin: () => void;
  /** Открыть все покупки: снять требования по деньгам и влиянию. */
  onUnlockAll: () => void;
  onClose: () => void;
}

/** Одна кнопка меню: подпись + действие + пояснение. */
interface DevAction {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export class DevMenu {
  readonly root: HTMLElement;
  private readonly moneyValue: HTMLElement;
  private readonly log: HTMLElement;

  constructor(
    texts: Texts,
    private readonly currency: string,
    private readonly callbacks: DevMenuCallbacks,
  ) {
    this.moneyValue = el('span', { class: 'dev__value' }, '');
    this.log = el('p', { class: 'dev__log', 'aria-live': 'polite' }, '');

    const actions: DevAction[] = [
      {
        id: 'money',
        label: texts.get('dev.addTrillion', { amount: formatMoney(1e12, this.currency) }),
        hint: texts.get('dev.addTrillionHint'),
        run: () => this.callbacks.onAddMoney(1e12),
      },
      {
        id: 'win',
        label: texts.get('dev.buyWin'),
        hint: texts.get('dev.buyWinHint'),
        run: () => this.callbacks.onWin(),
      },
      {
        id: 'unlock',
        label: texts.get('dev.unlockAll'),
        hint: texts.get('dev.unlockAllHint'),
        run: () => this.callbacks.onUnlockAll(),
      },
    ];

    const buttons = actions.map((action) => {
      const button = el('button', {
        class: 'btn btn--row dev__btn',
        type: 'button',
        'data-action': action.id,
      }, [
        el('span', {}, action.label),
        el('small', {}, action.hint),
      ]);
      button.addEventListener('click', () => {
        action.run();
        this.show(`${action.label} — ${texts.get('dev.done')}`);
      });
      return button;
    });

    const close = el('button', { class: 'btn btn--gold', type: 'button' }, texts.get('panel.close'));
    close.addEventListener('click', () => this.callbacks.onClose());

    this.root = el('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'sheet__inner dev' }, [
        el('h2', { class: 'sheet__title' }, texts.get('dev.title')),
        el('p', { class: 'dev__note' }, texts.get('dev.note')),
        el('div', { class: 'dev__wallet' }, [
          el('span', {}, texts.get('dev.wallet')),
          this.moneyValue,
        ]),
        ...buttons,
        this.log,
        close,
      ]),
    ]);
  }

  /** Показать меню. */
  open(coins: number): void {
    this.setCoins(coins);
    this.root.hidden = false;
    this.log.textContent = '';
  }

  close(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setCoins(coins: number): void {
    this.moneyValue.textContent = formatMoney(coins, this.currency);
  }

  private show(message: string): void {
    this.log.textContent = message;
  }
}
