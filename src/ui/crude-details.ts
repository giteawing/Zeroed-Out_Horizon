import type { Game } from '../core/game';
import { crudeStatsBreakdown } from '../core/economy';
import { formatNumber, formatPercent } from '../core/format';
import type { Well } from '../core/types';
import { el } from './dom';
import type { Texts } from './texts';

export type CrudeSection = 'wells' | 'domestic' | 'export' | 'contracts';
type WellFilter = 'all' | Well['kind'];

const WELLS_PER_PAGE = 100;

/**
 * Подробная статистика добычи сырой нефти, скважин, рынков сбыта и договоров.
 * Только форматирует и выводит данные из экономического ядра.
 */
export class CrudeDetails {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly sectionNodes = new Map<CrudeSection, HTMLElement>();
  private returnFocus: HTMLElement | null = null;
  private filter: WellFilter = 'all';
  private page = 0;

  constructor(private readonly game: Game, private readonly texts: Texts) {
    this.body = el('div', { class: 'crude__body' });
    this.closeButton = el('button', {
      class: 'btn btn--gold',
      type: 'button',
      'data-crude-close': 'true',
    }, texts.get('panel.close'));
    this.closeButton.addEventListener('click', () => this.close());
    this.root = el('div', {
      id: 'crude-stats',
      class: 'sheet',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': texts.get('panel.crudeTitle'),
      'data-testid': 'crude-details',
    }, [
      el('div', { class: 'sheet__inner crude__inner' }, [
        el('h2', { class: 'sheet__title' }, texts.get('panel.crudeTitle')),
        this.body,
        this.closeButton,
      ]),
    ]);
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  open(section?: CrudeSection): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    this.root.hidden = false;
    this.closeButton.focus();
    if (section) {
      const target = this.sectionNodes.get(section);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start' });
      }
    }
  }

  close(): void {
    this.root.hidden = true;
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && target.isConnected) target.focus();
  }

  render(): void {
    const state = this.game.state;
    const derived = this.game.derived();
    const data = crudeStatsBreakdown(this.game.config, this.game.content.upgrades, state, derived);
    const t = (key: string, params?: Record<string, string | number>): string =>
      this.texts.get(`panel.${key}`, params);

    const rateUnit = this.texts.get('units.perSecondTonnes');
    const dailyUnit = t('crudeWellUnit');
    const rate = (value: number): string => `${formatNumber(value)} ${rateUnit}`;
    const stat = (key: string, label: string, value: string): HTMLElement =>
      el('div', { class: 'refinery__stat', 'data-crude-stat': key }, [
        el('span', { class: 'refinery__label' }, label),
        el('strong', { class: 'refinery__value' }, value),
      ]);
    const row = (name: string, value: string, testAttr?: [string, string]): HTMLElement => {
      const attrs: Record<string, string> = { class: 'refinery__stage' };
      if (testAttr) attrs[testAttr[0]] = testAttr[1];
      return el('div', attrs, [
        el('span', { class: 'refinery__stage-name' }, name),
        el('strong', { class: 'refinery__stage-value' }, value),
      ]);
    };

    const section = (key: CrudeSection, title: string, children: HTMLElement[]): HTMLElement => {
      const node = el('section', { class: 'crude__section', 'data-crude-section': key }, [
        el('h3', { class: 'refinery__heading' }, title),
        ...children,
      ]);
      this.sectionNodes.set(key, node);
      return node;
    };

    // 1. Сырая нефть — производство и скважины (x/y)
    const prod = data.production;
    const wellsSummary = el('div', { class: 'refinery__summary' }, [
      stat('productionRate', t('crudeProductionRate'), rate(prod.oilPerSecond)),
      stat('wellsTotal', t('crudeWellsTotal'), formatNumber(prod.wellsCount)),
      stat('wellsDebit', t('crudeWellsDebit'), t('crudeWellDebit', {
        current: formatNumber(prod.wellsCurrentDaily),
        initial: formatNumber(prod.wellsLaunchDaily),
        unit: dailyUnit,
      })),
      stat('declineFactor', t('crudeDeclineFactor'), formatPercent(prod.declineFactor, 1)),
      stat('crewMult', t('crudeCrewMult'), this.texts.get('units.times', { value: formatNumber(prod.crewMultiplier) })),
      stat('equipmentMult', t('crudeEquipmentMult'), this.texts.get('units.times', { value: formatNumber(prod.equipmentMultiplier) })),
      stat('equipmentFlat', t('crudeEquipmentFlat'), rate(prod.equipmentFlat)),
      stat('salesBoostSummary', t('crudeContractsCurrent'), this.texts.get('units.times', { value: formatNumber(prod.salesVolumeMultiplier) })),
    ]);

    const filters: Array<{ key: WellFilter; label: string }> = [
      { key: 'all', label: t('crudeFilterAll', { count: formatNumber(prod.wellsCount) }) },
      { key: 'ordinary', label: t('crudeFilterOrdinary', { count: formatNumber(prod.countsByKind.ordinary) }) },
      { key: 'good', label: t('crudeFilterGood', { count: formatNumber(prod.countsByKind.good) }) },
      { key: 'unique', label: t('crudeFilterUnique', { count: formatNumber(prod.countsByKind.unique) }) },
    ];
    const filterBar = el('div', { class: 'crude__filters' }, filters.map((item) => {
      const btn = el('button', {
        class: this.filter === item.key ? 'crude__filter crude__filter--active' : 'crude__filter',
        type: 'button',
        'data-crude-filter': item.key,
      }, item.label);
      btn.addEventListener('click', () => {
        this.filter = item.key;
        this.page = 0;
        this.render();
      });
      return btn;
    }));

    const filteredIndexes: number[] = [];
    for (let i = 0; i < state.wells.length; i++) {
      if (this.filter === 'all' || state.wells[i]!.kind === this.filter) {
        filteredIndexes.push(i);
      }
    }
    const totalPages = Math.max(1, Math.ceil(filteredIndexes.length / WELLS_PER_PAGE));
    if (this.page >= totalPages) this.page = totalPages - 1;
    const start = this.page * WELLS_PER_PAGE;
    const slice = filteredIndexes.slice(start, start + WELLS_PER_PAGE);

    const wellsList = el('div', { class: 'crude__wells', 'data-crude-wells-list': 'true' });
    if (slice.length === 0) {
      wellsList.append(el('p', { class: 'refinery__hint' }, t('crudeWellsEmpty')));
    } else {
      for (const index of slice) {
        const well = state.wells[index]!;
        const initial = well.dailyTonnes;
        const current = initial * prod.declineFactor;
        wellsList.append(
          row(
            t('crudeWellRow', {
              index: index + 1,
              kind: this.texts.get(`wells.${well.kind}`),
            }),
            t('crudeWellDebit', {
              current: formatNumber(current),
              initial: formatNumber(initial),
              unit: dailyUnit,
            }),
            ['data-crude-well', String(index)],
          ),
        );
      }
    }

    const pagerNodes: HTMLElement[] = [];
    if (totalPages > 1) {
      const prev = el('button', {
        class: 'crude__page-btn',
        type: 'button',
        'data-crude-page': 'prev',
      }, t('crudePagePrev'));
      prev.disabled = this.page <= 0;
      prev.addEventListener('click', () => {
        if (this.page > 0) {
          this.page -= 1;
          this.render();
        }
      });
      const next = el('button', {
        class: 'crude__page-btn',
        type: 'button',
        'data-crude-page': 'next',
      }, t('crudePageNext'));
      next.disabled = this.page >= totalPages - 1;
      next.addEventListener('click', () => {
        if (this.page < totalPages - 1) {
          this.page += 1;
          this.render();
        }
      });
      pagerNodes.push(
        el('div', { class: 'crude__pager' }, [
          prev,
          el('span', { class: 'crude__page-info' }, t('crudePageInfo', {
            page: formatNumber(this.page + 1),
            pages: formatNumber(totalPages),
            total: formatNumber(filteredIndexes.length),
          })),
          next,
        ]),
      );
    }

    const wellsSection = section('wells', t('crudeSectionWells'), [
      wellsSummary,
      filterBar,
      wellsList,
      ...pagerNodes,
    ]);

    // 2. Доступный объём внутреннего рынка
    const domCrude = data.domesticMarket.crude;
    const domProd = data.domesticMarket.products;
    const formatCap = (total: number, unlimited = false): string =>
      unlimited || !Number.isFinite(total) ? t('crudeMarketUnlimited') : rate(total);

    const domesticSection = section('domestic', t('crudeSectionDomestic'), [
      el('div', { class: 'refinery__summary' }, [
        stat(
          'domesticCrudeVolume',
          `${t('crudeMarketCrude')} · ${t('crudeMarketUsedTotal')}`,
          `${formatNumber(domCrude.used)} / ${formatCap(domCrude.total, domCrude.unlimited)}`,
        ),
        stat(
          'domesticCrudeFree',
          `${t('crudeMarketCrude')} · ${t('crudeMarketFree')}`,
          formatCap(domCrude.free, domCrude.unlimited),
        ),
        stat(
          'domesticProductsVolume',
          `${t('crudeMarketProducts')} · ${t('crudeMarketUsedTotal')}`,
          `${formatNumber(domProd.used)} / ${rate(domProd.total)}`,
        ),
        stat(
          'domesticProductsFree',
          `${t('crudeMarketProducts')} · ${t('crudeMarketFree')}`,
          rate(domProd.free),
        ),
      ]),
      el('div', { class: 'refinery__stages' }, [
        row(`${t('crudeMarketCrude')} · ${t('crudeMarketBase')}`, rate(domCrude.base)),
        row(`${t('crudeMarketCrude')} · ${t('crudeMarketUpgrades')}`, rate(domCrude.upgrades)),
        row(`${t('crudeMarketProducts')} · ${t('crudeMarketBase')}`, rate(domProd.base)),
        row(`${t('crudeMarketProducts')} · ${t('crudeMarketUpgrades')}`, rate(domProd.upgrades)),
        row(t('crudeMarketMult'), this.texts.get('units.times', { value: formatNumber(domCrude.multiplier) })),
        ...domCrude.items.map((item) =>
          row(
            `${t('crudeMarketCrude')} · ${t('crudeMarketItem', {
              name: this.texts.upgradeName(item.id),
              level: formatNumber(item.level),
            })}`,
            `+${rate(item.rate)}`,
          ),
        ),
        ...domProd.items.map((item) =>
          row(
            `${t('crudeMarketProducts')} · ${t('crudeMarketItem', {
              name: this.texts.upgradeName(item.id),
              level: formatNumber(item.level),
            })}`,
            `+${rate(item.rate)}`,
          ),
        ),
      ]),
    ]);

    // 3. Доступный объём экспорта
    const expCrude = data.exportMarket.crude;
    const expProd = data.exportMarket.products;
    const exportSection = section('export', t('crudeSectionExport'), [
      el('div', { class: 'refinery__summary' }, [
        stat(
          'exportCrudeVolume',
          `${t('crudeMarketCrude')} · ${t('crudeMarketUsedTotal')}`,
          `${formatNumber(expCrude.used)} / ${rate(expCrude.total)}`,
        ),
        stat(
          'exportCrudeFree',
          `${t('crudeMarketCrude')} · ${t('crudeMarketFree')}`,
          rate(expCrude.free),
        ),
        stat(
          'exportProductsVolume',
          `${t('crudeMarketProducts')} · ${t('crudeMarketUsedTotal')}`,
          `${formatNumber(expProd.used)} / ${rate(expProd.total)}`,
        ),
        stat(
          'exportProductsFree',
          `${t('crudeMarketProducts')} · ${t('crudeMarketFree')}`,
          rate(expProd.free),
        ),
      ]),
      el('div', { class: 'refinery__stages' }, [
        row(`${t('crudeMarketCrude')} · ${t('crudeMarketBase')}`, rate(expCrude.base)),
        row(`${t('crudeMarketCrude')} · ${t('crudeMarketUpgrades')}`, rate(expCrude.upgrades)),
        row(`${t('crudeMarketProducts')} · ${t('crudeMarketBase')}`, rate(expProd.base)),
        row(`${t('crudeMarketProducts')} · ${t('crudeMarketUpgrades')}`, rate(expProd.upgrades)),
        row(t('crudeMarketMult'), this.texts.get('units.times', { value: formatNumber(expCrude.contractMultiplier) })),
        row(t('crudeMarketExtraMult'), this.texts.get('units.times', { value: formatNumber(expCrude.extraMultiplier) })),
        row(
          `${t('crudeMarketModes')} · ${this.texts.get('hud.exportPipeline')}`,
          `${formatNumber(expCrude.modes.pipeline.used)} / ${rate(expCrude.modes.pipeline.total)}`,
        ),
        row(
          `${t('crudeMarketModes')} · ${this.texts.get('hud.exportRail')}`,
          `${formatNumber(expCrude.modes.rail.used)} / ${rate(expCrude.modes.rail.total)}`,
        ),
        row(
          `${t('crudeMarketModes')} · ${this.texts.get('hud.exportTanker')}`,
          `${formatNumber(expCrude.modes.tanker.used)} / ${rate(expCrude.modes.tanker.total)}`,
        ),
        ...expCrude.items.map((item) =>
          row(
            `${t('crudeMarketCrude')} · ${t('crudeMarketItem', {
              name: this.texts.upgradeName(item.id),
              level: formatNumber(item.level),
            })}`,
            `+${rate(item.rate)}`,
          ),
        ),
        ...expProd.items.map((item) =>
          row(
            `${t('crudeMarketProducts')} · ${t('crudeMarketItem', {
              name: this.texts.upgradeName(item.id),
              level: formatNumber(item.level),
            })}`,
            `+${rate(item.rate)}`,
          ),
        ),
      ]),
    ]);

    // 4. Множитель от договоров
    const contracts = data.contracts;
    const domTag = contracts.leading === 'contract' || contracts.leading === 'tie'
      ? ` · ${t('crudeContractsLeading')}`
      : contracts.domesticBonus > 0 ? ` · ${t('crudeContractsLagging')}` : '';
    const expTag = contracts.leading === 'export' || contracts.leading === 'tie'
      ? ` · ${t('crudeContractsLeading')}`
      : contracts.exportBonus > 0 ? ` · ${t('crudeContractsLagging')}` : '';

    const contractRows: HTMLElement[] = [
      ...contracts.domesticItems.map((item) =>
        row(
          `${t('crudeContractsDomestic')} · ${t('crudeContractsItem', {
            name: this.texts.upgradeName(item.id),
            level: formatNumber(item.level),
          })}`,
          `+${formatPercent(item.percent / 100, 1)}`,
          ['data-crude-contract', item.id],
        ),
      ),
      ...contracts.exportItems.map((item) =>
        row(
          `${t('crudeContractsExport')} · ${t('crudeContractsItem', {
            name: this.texts.upgradeName(item.id),
            level: formatNumber(item.level),
          })}`,
          `+${formatPercent(item.percent / 100, 1)}`,
          ['data-crude-contract', item.id],
        ),
      ),
    ];

    const contractsSection = section('contracts', t('crudeSectionContracts'), [
      el('div', { class: 'refinery__summary' }, [
        stat('contractsMultiplier', t('crudeContractsCurrent'), this.texts.get('units.times', { value: formatNumber(contracts.multiplier) })),
        stat(
          'contractsDomesticSum',
          `${t('crudeContractsDomestic')}${domTag}`,
          `+${formatPercent(contracts.domesticBonus, 1)} (${this.texts.get('units.times', { value: formatNumber(1 + contracts.domesticBonus) })})`,
        ),
        stat(
          'contractsExportSum',
          `${t('crudeContractsExport')}${expTag}`,
          `+${formatPercent(contracts.exportBonus, 1)} (${this.texts.get('units.times', { value: formatNumber(1 + contracts.exportBonus) })})`,
        ),
      ]),
      contractRows.length > 0
        ? el('div', { class: 'refinery__stages' }, contractRows)
        : el('p', { class: 'refinery__hint' }, t('crudeContractsEmpty')),
    ]);

    this.body.replaceChildren(wellsSection, domesticSection, exportSection, contractsSection);
  }
}
