import type { Game } from '../core/game';
import { crudeStatsBreakdown } from '../core/economy';
import { formatNumber, formatPercent } from '../core/format';
import type { Well } from '../core/types';
import { el } from './dom';
import type { Texts } from './texts';

export type CrudeSection = 'wells' | 'domestic' | 'export' | 'contracts';
type WellFilter = 'all' | Well['kind'];

const WELLS_PER_PAGE = 100;

interface RenderedWellRow {
  index: number;
  kind: Well['kind'];
  valueEl: HTMLElement;
  lastValue: string;
}

/**
 * Подробная статистика добычи сырой нефти, скважин, рынков сбыта и договоров.
 * Только форматирует и выводит данные из экономического ядра.
 */
export class CrudeDetails {
  readonly root: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly sectionNodes = new Map<CrudeSection, HTMLElement>();
  private readonly wellsSummary: HTMLElement;
  private readonly wellsFilters: HTMLElement;
  private readonly wellsList: HTMLElement;
  private readonly wellsPager: HTMLElement;
  private readonly domesticContent: HTMLElement;
  private readonly exportContent: HTMLElement;
  private readonly contractsContent: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private filter: WellFilter = 'all';
  private page = 0;
  private resetWellsScroll = false;
  private renderedWells: RenderedWellRow[] = [];
  private renderedWellsEmpty = false;
  private filterSignature = '';
  private pagerSignature = '';
  private wellsSummarySignature = '';
  private domesticSignature = '';
  private exportSignature = '';
  private contractsSignature = '';

  constructor(private readonly game: Game, private readonly texts: Texts) {
    const t = (key: string): string => this.texts.get(`panel.${key}`);
    const makeSection = (key: CrudeSection, title: string, children: HTMLElement[]): HTMLElement => {
      const node = el('section', { class: 'crude__section', 'data-crude-section': key }, [
        el('h3', { class: 'refinery__heading' }, title),
        ...children,
      ]);
      this.sectionNodes.set(key, node);
      return node;
    };

    this.wellsSummary = el('div', { class: 'refinery__summary' });
    this.wellsFilters = el('div', { class: 'crude__filters' });
    this.wellsList = el('div', { class: 'crude__wells', 'data-crude-wells-list': 'true' });
    this.wellsPager = el('div', { class: 'crude__pager', hidden: true });
    this.domesticContent = el('div', { class: 'crude__section' });
    this.exportContent = el('div', { class: 'crude__section' });
    this.contractsContent = el('div', { class: 'crude__section' });

    const wellsSection = makeSection('wells', t('crudeSectionWells'), [
      this.wellsSummary,
      this.wellsFilters,
      this.wellsList,
      this.wellsPager,
    ]);
    const domesticSection = makeSection('domestic', t('crudeSectionDomestic'), [this.domesticContent]);
    const exportSection = makeSection('export', t('crudeSectionExport'), [this.exportContent]);
    const contractsSection = makeSection('contracts', t('crudeSectionContracts'), [this.contractsContent]);

    this.body = el('div', { class: 'crude__body' }, [
      wellsSection,
      domesticSection,
      exportSection,
      contractsSection,
    ]);
    this.closeButton = el('button', {
      class: 'btn btn--gold',
      type: 'button',
      'data-crude-close': 'true',
    }, texts.get('panel.close'));
    this.closeButton.addEventListener('click', () => this.close());
    this.inner = el('div', { class: 'sheet__inner crude__inner' }, [
      el('h2', { class: 'sheet__title' }, texts.get('panel.crudeTitle')),
      this.body,
      this.closeButton,
    ]);
    this.root = el('div', {
      id: 'crude-stats',
      class: 'sheet',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': texts.get('panel.crudeTitle'),
      'data-testid': 'crude-details',
    }, [this.inner]);
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
    this.closeButton.focus({ preventScroll: true });
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
    const prevInnerScroll = this.inner.scrollTop;
    const prevWellsScroll = this.wellsList.scrollTop;

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

    // 1. Сырая нефть — производство и скважины (x/y)
    const prod = data.production;
    const yearSeconds = Math.max(1, 365 * (this.game.config.oil.wells.secondsPerDay || 1));
    const currentYear = Math.floor((state.clockMs / 1000) / yearSeconds);
    const drilledThisYear = currentYear === state.wellsDrilledYear ? state.wellsDrilledThisYear : 0;
    const summaryPairs: Array<[string, string, string]> = [
      ['productionRate', t('crudeProductionRate'), rate(prod.oilPerSecond)],
      ['wellsTotal', t('crudeWellsTotal'), formatNumber(prod.wellsCount)],
      ['drillYearQuota', t('crudeDrillYearQuota'), t('crudeQuotaValue', {
        used: formatNumber(drilledThisYear),
        limit: formatNumber(this.game.config.oil.wells.maxDrillPerYear),
      })],
      ['conquestQuota', t('crudeConquestQuota'), t('crudeQuotaValue', {
        used: formatNumber(state.conquestWellsTotal),
        limit: formatNumber(this.game.config.oil.wells.maxConquestTotal),
      })],
      ['wellsDebit', t('crudeWellsDebit'), t('crudeWellDebit', {
        current: formatNumber(prod.wellsCurrentDaily),
        initial: formatNumber(prod.wellsLaunchDaily),
        unit: dailyUnit,
      })],
      ['declineFactor', t('crudeDeclineFactor'), formatPercent(prod.declineFactor, 1)],
      ['crewMult', t('crudeCrewMult'), this.texts.get('units.times', { value: formatNumber(prod.crewMultiplier) })],
      ['equipmentMult', t('crudeEquipmentMult'), this.texts.get('units.times', { value: formatNumber(prod.equipmentMultiplier) })],
      ['equipmentFlat', t('crudeEquipmentFlat'), rate(prod.equipmentFlat)],
      ['salesBoostSummary', t('crudeContractsCurrent'), this.texts.get('units.times', { value: formatNumber(prod.salesVolumeMultiplier) })],
    ];
    const nextWellsSummarySig = summaryPairs.map(([, , v]) => v).join('|');
    if (nextWellsSummarySig !== this.wellsSummarySignature) {
      this.wellsSummarySignature = nextWellsSummarySig;
      this.wellsSummary.replaceChildren(...summaryPairs.map(([key, label, value]) => stat(key, label, value)));
    }

    const filters: Array<{ key: WellFilter; label: string }> = [
      { key: 'all', label: t('crudeFilterAll', { count: formatNumber(prod.wellsCount) }) },
      { key: 'ordinary', label: t('crudeFilterOrdinary', { count: formatNumber(prod.countsByKind.ordinary) }) },
      { key: 'good', label: t('crudeFilterGood', { count: formatNumber(prod.countsByKind.good) }) },
      { key: 'unique', label: t('crudeFilterUnique', { count: formatNumber(prod.countsByKind.unique) }) },
    ];
    const nextFilterSig = `${this.filter}:${filters.map((item) => item.label).join('|')}`;
    if (nextFilterSig !== this.filterSignature) {
      this.filterSignature = nextFilterSig;
      this.wellsFilters.replaceChildren(
        ...filters.map((item) => {
          const btn = el('button', {
            class: this.filter === item.key ? 'crude__filter crude__filter--active' : 'crude__filter',
            type: 'button',
            'data-crude-filter': item.key,
          }, item.label);
          btn.addEventListener('click', () => {
            this.filter = item.key;
            this.page = 0;
            this.resetWellsScroll = true;
            this.render();
          });
          return btn;
        }),
      );
    }

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

    if (slice.length === 0) {
      if (!this.renderedWellsEmpty) {
        this.renderedWellsEmpty = true;
        this.renderedWells = [];
        this.wellsList.replaceChildren(el('p', { class: 'refinery__hint' }, t('crudeWellsEmpty')));
      }
    } else {
      const sameSlice =
        !this.renderedWellsEmpty &&
        this.renderedWells.length === slice.length &&
        slice.every((index, pos) => {
          const prev = this.renderedWells[pos]!;
          return prev.index === index && prev.kind === state.wells[index]!.kind;
        });

      if (sameSlice) {
        for (let pos = 0; pos < slice.length; pos++) {
          const index = slice[pos]!;
          const well = state.wells[index]!;
          const initial = well.dailyTonnes;
          const current = initial * prod.declineFactor;
          const nextValue = t('crudeWellDebit', {
            current: formatNumber(current),
            initial: formatNumber(initial),
            unit: dailyUnit,
          });
          const entry = this.renderedWells[pos]!;
          if (entry.lastValue !== nextValue) {
            entry.lastValue = nextValue;
            entry.valueEl.textContent = nextValue;
          }
        }
      } else {
        this.renderedWellsEmpty = false;
        const nextRendered: RenderedWellRow[] = [];
        const nodes: HTMLElement[] = [];
        for (const index of slice) {
          const well = state.wells[index]!;
          const initial = well.dailyTonnes;
          const current = initial * prod.declineFactor;
          const valueText = t('crudeWellDebit', {
            current: formatNumber(current),
            initial: formatNumber(initial),
            unit: dailyUnit,
          });
          const valueEl = el('strong', { class: 'refinery__stage-value' }, valueText);
          nodes.push(
            el('div', { class: 'refinery__stage', 'data-crude-well': String(index) }, [
              el('span', { class: 'refinery__stage-name' }, t('crudeWellRow', {
                index: index + 1,
                kind: this.texts.get(`wells.${well.kind}`),
              })),
              valueEl,
            ]),
          );
          nextRendered.push({ index, kind: well.kind, valueEl, lastValue: valueText });
        }
        this.renderedWells = nextRendered;
        this.wellsList.replaceChildren(...nodes);
      }
    }

    const nextPagerSig = totalPages > 1 ? `${this.page}/${totalPages}/${filteredIndexes.length}` : 'none';
    if (nextPagerSig !== this.pagerSignature) {
      this.pagerSignature = nextPagerSig;
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
            this.resetWellsScroll = true;
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
            this.resetWellsScroll = true;
            this.render();
          }
        });
        this.wellsPager.hidden = false;
        this.wellsPager.replaceChildren(
          prev,
          el('span', { class: 'crude__page-info' }, t('crudePageInfo', {
            page: formatNumber(this.page + 1),
            pages: formatNumber(totalPages),
            total: formatNumber(filteredIndexes.length),
          })),
          next,
        );
      } else {
        this.wellsPager.hidden = true;
        this.wellsPager.replaceChildren();
      }
    }

    // 2. Доступный объём внутреннего рынка
    const domCrude = data.domesticMarket.crude;
    const domProd = data.domesticMarket.products;
    const formatCap = (total: number, unlimited = false): string =>
      unlimited || !Number.isFinite(total) ? t('crudeMarketUnlimited') : rate(total);

    const domStats: Array<[string, string, string]> = [
      [
        'domesticCrudeVolume',
        `${t('crudeMarketCrude')} · ${t('crudeMarketUsedTotal')}`,
        `${formatNumber(domCrude.used)} / ${formatCap(domCrude.total, domCrude.unlimited)}`,
      ],
      [
        'domesticCrudeFree',
        `${t('crudeMarketCrude')} · ${t('crudeMarketFree')}`,
        formatCap(domCrude.free, domCrude.unlimited),
      ],
      [
        'domesticProductsVolume',
        `${t('crudeMarketProducts')} · ${t('crudeMarketUsedTotal')}`,
        `${formatNumber(domProd.used)} / ${rate(domProd.total)}`,
      ],
      [
        'domesticProductsFree',
        `${t('crudeMarketProducts')} · ${t('crudeMarketFree')}`,
        rate(domProd.free),
      ],
    ];
    const domRows: Array<[string, string]> = [
      [`${t('crudeMarketCrude')} · ${t('crudeMarketBase')}`, rate(domCrude.base)],
      [`${t('crudeMarketCrude')} · ${t('crudeMarketUpgrades')}`, rate(domCrude.upgrades)],
      [`${t('crudeMarketProducts')} · ${t('crudeMarketBase')}`, rate(domProd.base)],
      [`${t('crudeMarketProducts')} · ${t('crudeMarketUpgrades')}`, rate(domProd.upgrades)],
      [t('crudeMarketMult'), this.texts.get('units.times', { value: formatNumber(domCrude.multiplier) })],
      ...domCrude.items.map((item): [string, string] => [
        `${t('crudeMarketCrude')} · ${t('crudeMarketItem', {
          name: this.texts.upgradeName(item.id),
          level: formatNumber(item.level),
        })}`,
        `+${rate(item.rate)}`,
      ]),
      ...domProd.items.map((item): [string, string] => [
        `${t('crudeMarketProducts')} · ${t('crudeMarketItem', {
          name: this.texts.upgradeName(item.id),
          level: formatNumber(item.level),
        })}`,
        `+${rate(item.rate)}`,
      ]),
    ];
    const nextDomesticSig = [
      ...domStats.map(([, , v]) => v),
      ...domRows.map(([k, v]) => `${k}=${v}`),
    ].join('|');
    if (nextDomesticSig !== this.domesticSignature) {
      this.domesticSignature = nextDomesticSig;
      this.domesticContent.replaceChildren(
        el('div', { class: 'refinery__summary' }, domStats.map(([key, label, value]) => stat(key, label, value))),
        el('div', { class: 'refinery__stages' }, domRows.map(([name, value]) => row(name, value))),
      );
    }

    // 3. Доступный объём экспорта
    const expCrude = data.exportMarket.crude;
    const expProd = data.exportMarket.products;
    const expStats: Array<[string, string, string]> = [
      [
        'exportCrudeVolume',
        `${t('crudeMarketCrude')} · ${t('crudeMarketUsedTotal')}`,
        `${formatNumber(expCrude.used)} / ${rate(expCrude.total)}`,
      ],
      [
        'exportCrudeFree',
        `${t('crudeMarketCrude')} · ${t('crudeMarketFree')}`,
        rate(expCrude.free),
      ],
      [
        'exportProductsVolume',
        `${t('crudeMarketProducts')} · ${t('crudeMarketUsedTotal')}`,
        `${formatNumber(expProd.used)} / ${rate(expProd.total)}`,
      ],
      [
        'exportProductsFree',
        `${t('crudeMarketProducts')} · ${t('crudeMarketFree')}`,
        rate(expProd.free),
      ],
    ];
    const expRows: Array<[string, string]> = [
      [`${t('crudeMarketCrude')} · ${t('crudeMarketBase')}`, rate(expCrude.base)],
      [`${t('crudeMarketCrude')} · ${t('crudeMarketUpgrades')}`, rate(expCrude.upgrades)],
      [`${t('crudeMarketProducts')} · ${t('crudeMarketBase')}`, rate(expProd.base)],
      [`${t('crudeMarketProducts')} · ${t('crudeMarketUpgrades')}`, rate(expProd.upgrades)],
      [t('crudeMarketMult'), this.texts.get('units.times', { value: formatNumber(expCrude.contractMultiplier) })],
      [t('crudeMarketExtraMult'), this.texts.get('units.times', { value: formatNumber(expCrude.extraMultiplier) })],
      [
        `${t('crudeMarketModes')} · ${this.texts.get('hud.exportPipeline')}`,
        `${formatNumber(expCrude.modes.pipeline.used)} / ${rate(expCrude.modes.pipeline.total)}`,
      ],
      [
        `${t('crudeMarketModes')} · ${this.texts.get('hud.exportRail')}`,
        `${formatNumber(expCrude.modes.rail.used)} / ${rate(expCrude.modes.rail.total)}`,
      ],
      [
        `${t('crudeMarketModes')} · ${this.texts.get('hud.exportTanker')}`,
        `${formatNumber(expCrude.modes.tanker.used)} / ${rate(expCrude.modes.tanker.total)}`,
      ],
      ...expCrude.items.map((item): [string, string] => [
        `${t('crudeMarketCrude')} · ${t('crudeMarketItem', {
          name: this.texts.upgradeName(item.id),
          level: formatNumber(item.level),
        })}`,
        `+${rate(item.rate)}`,
      ]),
      ...expProd.items.map((item): [string, string] => [
        `${t('crudeMarketProducts')} · ${t('crudeMarketItem', {
          name: this.texts.upgradeName(item.id),
          level: formatNumber(item.level),
        })}`,
        `+${rate(item.rate)}`,
      ]),
    ];
    const nextExportSig = [
      ...expStats.map(([, , v]) => v),
      ...expRows.map(([k, v]) => `${k}=${v}`),
    ].join('|');
    if (nextExportSig !== this.exportSignature) {
      this.exportSignature = nextExportSig;
      this.exportContent.replaceChildren(
        el('div', { class: 'refinery__summary' }, expStats.map(([key, label, value]) => stat(key, label, value))),
        el('div', { class: 'refinery__stages' }, expRows.map(([name, value]) => row(name, value))),
      );
    }

    // 4. Множитель от договоров
    const contracts = data.contracts;
    const domTag = contracts.leading === 'contract' || contracts.leading === 'tie'
      ? ` · ${t('crudeContractsLeading')}`
      : contracts.domesticBonus > 0 ? ` · ${t('crudeContractsLagging')}` : '';
    const expTag = contracts.leading === 'export' || contracts.leading === 'tie'
      ? ` · ${t('crudeContractsLeading')}`
      : contracts.exportBonus > 0 ? ` · ${t('crudeContractsLagging')}` : '';

    const contractRowData: Array<[string, string, string]> = [
      ...contracts.domesticItems.map((item): [string, string, string] => [
        `${t('crudeContractsDomestic')} · ${t('crudeContractsItem', {
          name: this.texts.upgradeName(item.id),
          level: formatNumber(item.level),
        })}`,
        `+${formatPercent(item.percent / 100, 1)}`,
        item.id,
      ]),
      ...contracts.exportItems.map((item): [string, string, string] => [
        `${t('crudeContractsExport')} · ${t('crudeContractsItem', {
          name: this.texts.upgradeName(item.id),
          level: formatNumber(item.level),
        })}`,
        `+${formatPercent(item.percent / 100, 1)}`,
        item.id,
      ]),
    ];
    const contractStats: Array<[string, string, string]> = [
      ['contractsMultiplier', t('crudeContractsCurrent'), this.texts.get('units.times', { value: formatNumber(contracts.multiplier) })],
      [
        'contractsDomesticSum',
        `${t('crudeContractsDomestic')}${domTag}`,
        `+${formatPercent(contracts.domesticBonus, 1)} (${this.texts.get('units.times', { value: formatNumber(1 + contracts.domesticBonus) })})`,
      ],
      [
        'contractsExportSum',
        `${t('crudeContractsExport')}${expTag}`,
        `+${formatPercent(contracts.exportBonus, 1)} (${this.texts.get('units.times', { value: formatNumber(1 + contracts.exportBonus) })})`,
      ],
    ];
    const nextContractsSig = [
      ...contractStats.map(([, l, v]) => `${l}=${v}`),
      ...contractRowData.map(([n, v, id]) => `${id}:${n}=${v}`),
    ].join('|');
    if (nextContractsSig !== this.contractsSignature) {
      this.contractsSignature = nextContractsSig;
      this.contractsContent.replaceChildren(
        el('div', { class: 'refinery__summary' }, contractStats.map(([key, label, value]) => stat(key, label, value))),
        contractRowData.length > 0
          ? el('div', { class: 'refinery__stages' }, contractRowData.map(([name, value, id]) =>
              row(name, value, ['data-crude-contract', id]),
            ))
          : el('p', { class: 'refinery__hint' }, t('crudeContractsEmpty')),
      );
    }

    this.wellsList.scrollTop = this.resetWellsScroll ? 0 : prevWellsScroll;
    this.resetWellsScroll = false;
    this.inner.scrollTop = prevInnerScroll;
  }
}
