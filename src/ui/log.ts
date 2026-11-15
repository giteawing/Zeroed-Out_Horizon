/**
 * Журнал операций — окно из меню шапки.
 *
 * Показывает последние сделки человеческим языком:
 *   «Экспорт: продано 5,2 млн т по ₦1,3 тыс./т — итого ₦6,8 млрд»
 *
 * Раньше журнал висел на главном экране под панелью маршрутов и отнимал
 * место у статистики. Теперь это отдельная шторка: открывается из меню,
 * закрывается кнопкой, кликом по фону или Escape (Escape — в main.ts).
 *
 * Строки не пересобираются каждый кадр: сравнивается сигнатура журнала,
 * и перерисовка происходит только когда добавилась новая запись.
 */
import { clear, el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatNumber } from '../core/format';
import type { LogEntry } from '../core/types';

export class OperationLog {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;
  private signature = '';

  constructor(
    private readonly texts: Texts,
    private readonly currency: string,
  ) {
    this.list = el('ol', { class: 'oplog__list', 'aria-live': 'polite' });
    this.closeButton = el('button', { class: 'btn btn--gold', type: 'button' }, this.texts.get('panel.close'));
    this.closeButton.addEventListener('click', () => this.hide());
    this.root = el('div', {
      class: 'sheet sheet--oplog',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': this.texts.get('log.title'),
      'data-testid': 'oplog',
    }, [
      el('div', { class: 'sheet__inner oplog' }, [
        el('h2', { class: 'sheet__title oplog__title' }, this.texts.get('log.title')),
        this.list,
        this.closeButton,
      ]),
    ]);
    // Клик по затемнению вокруг листа закрывает журнал — как остальные шторки.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.hide();
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.closeButton.focus();
  }

  hide(): void {
    this.root.hidden = true;
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && target.isConnected) target.focus();
  }

  private channelName(entry: LogEntry): string {
    const key =
      entry.channel === 'refine' ? 'sales.refine' :
      entry.channel === 'export' ? 'sales.export' :
      'sales.contract';
    return this.texts.get(key);
  }

  /** Одна запись журнала — одна строка текста. */
  private describe(entry: LogEntry): string {
    const money = entry.money !== undefined ? formatMoney(entry.money, this.currency) : '';
    const name = entry.upgradeId
      ? this.texts.upgradeName(entry.upgradeId)
      : '';
    const tonnes = this.texts.get('units.tonnes');
    switch (entry.kind) {
      case 'sold':
        if (entry.tonnes === undefined) return this.texts.get('log.sold');
        return this.texts.get('log.soldChannel', {
          channel: this.channelName(entry),
          tonnes: formatNumber(entry.tonnes),
          unit: tonnes,
          price: entry.price !== undefined
            ? formatMoney(entry.price, this.currency)
            : formatMoney(0, this.currency),
          money,
        });
      case 'conquest':
        // Реприватизация приносит скважины — ей нужна своя строка с цифрами.
        if (entry.upgradeId === 'p_reprivatize' && entry.tonnes !== undefined) {
          return this.texts.get('log.reprivat', {
            wells: entry.count ?? 1,
            tonnes: formatNumber(entry.tonnes),
            unit: tonnes,
            money: entry.money !== undefined ? formatMoney(entry.money, this.currency) : money,
          });
        }
        return this.texts.get('log.conquest', { name, money });
      case 'launder':
        return this.texts.get('log.launder', { name, money });
      case 'achievement':
        return this.texts.get('log.achievement', { name: this.texts.achievementName(entry.upgradeId ?? '') });
      case 'drill':
        return this.texts.get('log.drill', {
          tonnes: formatNumber(entry.tonnes ?? 0),
          unit: tonnes,
        });
      case 'spill': {
        // Разлив: сколько утекло, куда и во сколько обошлось.
        // Локация берётся из texts.spill.places — падежи уже готовы.
        const isCrude = entry.spill !== 'products';
        return this.texts.get(isCrude ? 'log.spillCrude' : 'log.spillProducts', {
          tonnes: formatNumber(entry.tonnes ?? 0),
          unit: tonnes,
          place: this.texts.get(`spill.places.${entry.place ?? 'sea'}`),
          money: entry.money !== undefined ? formatMoney(entry.money, this.currency) : money,
        });
      }
      case 'bought':
        return this.texts.get('log.bought', { name, money });
      default:
        return this.texts.get('log.event', { name, money });
    }
  }

  update(entries: readonly LogEntry[]): void {
    const signature = entries.map((e) => `${e.at}:${e.kind}:${e.upgradeId ?? ''}:${e.money ?? 0}:${e.tonnes ?? 0}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    clear(this.list);
    if (entries.length === 0) {
      this.list.append(el('li', { class: 'oplog__empty' }, this.texts.get('log.empty')));
      return;
    }
    for (const entry of entries) {
      this.list.append(
        el('li', { class: 'oplog__item', 'data-kind': entry.kind }, this.describe(entry)),
      );
    }
  }
}
