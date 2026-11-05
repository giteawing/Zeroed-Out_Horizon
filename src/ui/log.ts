/**
 * Журнал операций под долотом.
 *
 * Показывает последние сделки человеческим языком:
 *   «Экспорт: продано 5,2 млн т по ₦1,3 тыс./т — итого ₦6,8 млрд»
 *
 * Строки не пересобираются каждый кадр: сравнивается сигнатура журнала,
 * и перерисовка происходит только когда добавилась новая запись.
 */
import { clear, el } from './dom';
import type { Texts } from './texts';
import { formatMoney, formatNumber } from '../core/format';
import type { LogEntry } from '../core/types';

const VISIBLE = 3;

export class OperationLog {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private signature = '';

  constructor(
    private readonly texts: Texts,
    private readonly currency: string,
  ) {
    this.list = el('ol', { class: 'oplog__list', 'aria-live': 'polite' });
    this.root = el('section', { class: 'oplog', 'data-testid': 'oplog' }, [
      el('h2', { class: 'oplog__title' }, this.texts.get('log.title')),
      this.list,
    ]);
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
      case 'bought':
        return this.texts.get('log.bought', { name, money });
      default:
        return this.texts.get('log.event', { name, money });
    }
  }

  update(entries: readonly LogEntry[]): void {
    const head = entries.slice(0, VISIBLE);
    const signature = head.map((e) => `${e.at}:${e.kind}:${e.upgradeId ?? ''}:${e.money ?? 0}:${e.tonnes ?? 0}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    clear(this.list);
    if (head.length === 0) {
      this.list.append(el('li', { class: 'oplog__empty' }, this.texts.get('log.empty')));
      return;
    }
    for (const entry of head) {
      this.list.append(
        el('li', { class: 'oplog__item', 'data-kind': entry.kind }, this.describe(entry)),
      );
    }
  }
}
