import type { Game } from '../core/game';
import { formatNumber, formatPercent } from '../core/format';
import { el } from './dom';
import type { Texts } from './texts';

/** Подробная статистика НПЗ: только отображает снимок из экономического ядра. */
export class RefineryDetails {
  readonly root: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly stages: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly game: Game, private readonly texts: Texts) {
    this.summary = el('div', { class: 'refinery__summary' });
    this.stages = el('div', { class: 'refinery__stages' });
    this.closeButton = el('button', {
      class: 'btn btn--gold', type: 'button', 'data-refinery-close': 'true',
    }, texts.get('panel.close'));
    this.closeButton.addEventListener('click', () => this.close());
    this.root = el('div', {
      id: 'refinery-stats', class: 'sheet', hidden: true, role: 'dialog',
      'aria-modal': 'true', 'aria-label': texts.get('panel.refineriesTitle'),
    }, [
      el('div', { class: 'sheet__inner refinery__inner' }, [
        el('h2', { class: 'sheet__title' }, texts.get('panel.refineriesTitle')),
        this.summary,
        el('h3', { class: 'refinery__heading' }, texts.get('panel.refineriesStages')),
        this.stages,
        el('p', { class: 'refinery__hint' }, texts.get('panel.refineriesHint')),
        this.closeButton,
      ]),
    ]);
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get visible(): boolean { return !this.root.hidden; }

  open(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    this.root.hidden = false;
    this.closeButton.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  render(): void {
    const derived = this.game.derived();
    const { refineries, flows } = derived;
    const rate = (value: number): string => `${formatNumber(value)} ${this.texts.get('units.perSecondTonnes')}`;
    const stat = (key: string, label: string, value: string): HTMLElement =>
      el('div', { class: 'refinery__stat', 'data-refinery-stat': key }, [
        el('span', { class: 'refinery__label' }, label),
        el('strong', { class: 'refinery__value' }, value),
      ]);
    this.summary.replaceChildren(
      stat('plants', this.texts.get('panel.refineriesPlants'), formatNumber(refineries.plantCount)),
      stat('depth', this.texts.get('panel.refineriesAverage'), formatPercent(refineries.averageDepth, 1)),
      stat('capacity', this.texts.get('panel.refineriesCapacity'), rate(derived.refineryThroughputCapacity)),
      stat('input', this.texts.get('panel.refineriesInput'), rate(flows.refined)),
      stat('production', this.texts.get('panel.refineriesProduction'), rate(flows.productsProduced)),
    );
    this.stages.replaceChildren(...refineries.stages.map((stage) => {
      const name = this.game.content.byId.get(stage.id)?.name ?? stage.id;
      const count = this.texts.get('panel.refineriesStageCount', {
        count: formatNumber(stage.count), total: formatNumber(refineries.plantCount),
      });
      return el('div', { class: 'refinery__stage', 'data-refinery-stage': stage.id }, [
        el('span', { class: 'refinery__stage-name' }, name),
        el('strong', { class: 'refinery__stage-value' }, `${count} · ${formatPercent(stage.depth, 0)}`),
      ]);
    }));
  }
}
