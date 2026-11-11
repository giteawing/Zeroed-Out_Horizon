/**
 * Финал: катсцена «насос включается», титры со стихотворением из credits.txt,
 * карикатура и статистика.
 *
 * Если владелец ещё не положил стихотворение, показываем creditsFallback
 * («Здесь будет стихотворение.») — как требует ТЗ §7.4.
 */
import { el } from './dom';
import { icon, image } from '../core/assets';
import type { Texts } from './texts';
import { formatDuration, formatMoney, formatNumber } from '../core/format';
import { creditsIsPlaceholder } from '../core/content';
import type { Content, GameState } from '../core/types';

export interface FinaleCallbacks {
  onRestart: () => void;
  onClose: () => void;
}

export class Finale {
  readonly root: HTMLElement;
  private cutsceneTimer: number | null = null;

  constructor(
    private readonly content: Content,
    private readonly texts: Texts,
    private readonly currency: string,
    private readonly callbacks: FinaleCallbacks,
  ) {
    this.root = el('div', { class: 'finale', hidden: true, role: 'dialog', 'aria-modal': 'true' });
  }

  /** Показать финальную сцену и титры. */
  show(state: GameState): void {
    this.clearCutsceneTimer();
    this.root.hidden = false;
    this.root.replaceChildren(this.buildCutscene(state));
  }

  private buildCutscene(state: GameState): HTMLElement {
    const lines = this.texts.list('finale', 'cutscene');
    const cutscene = el('div', { class: 'cutscene' }, [
      el('div', { class: 'cutscene__pump' }, [
        el('img', { src: icon('win-pump'), alt: '', width: 160, height: 160 }),
      ]),
    ]);
    lines.forEach((line, index) => {
      const paragraph = el('p', { class: 'cutscene__line' }, line);
      paragraph.style.animationDelay = `${index * 1.1}s`;
      cutscene.append(paragraph);
    });
    const skip = el('button', { class: 'btn btn--ghost', type: 'button' }, this.texts.get('finale.skip'));
    skip.addEventListener('click', () => {
      this.clearCutsceneTimer();
      this.root.replaceChildren(this.buildCredits(state));
    });
    cutscene.append(skip);

    // Автоматический переход к титрам, когда катсцена «доиграла».
    const total = lines.length * 1100 + 1200;
    this.cutsceneTimer = window.setTimeout(() => {
      this.cutsceneTimer = null;
      if (!this.root.hidden) this.root.replaceChildren(this.buildCredits(state));
    }, total);
    return cutscene;
  }

  private buildCredits(state: GameState): HTMLElement {
    const poem =
      this.content.credits && !creditsIsPlaceholder(this.content.credits)
        ? this.content.credits.trim()
        : this.texts.get('finale.creditsFallback');

    const poemBlock = el('pre', { class: 'credits__poem' }, poem);
    const stats = this.buildStats(state);

    const playAgain = el('button', { class: 'btn btn--gold', type: 'button' }, this.texts.get('finale.playAgain'));
    playAgain.addEventListener('click', () => this.callbacks.onRestart());

    const toggle = el('button', { class: 'btn', type: 'button' }, this.texts.get('finale.showStats'));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = this.texts.get(!expanded ? 'finale.hideStats' : 'finale.showStats');
      stats.hidden = expanded;
    });

    const close = el('button', { class: 'btn btn--ghost', type: 'button' }, this.texts.get('panel.close'));
    close.addEventListener('click', () => this.callbacks.onClose());

    return el('div', { class: 'credits' }, [
      el('h2', { class: 'credits__title' }, this.texts.get('finale.victoryTitle')),
      el('img', {
        class: 'credits__art',
        src: image('finale.svg'),
        alt: this.texts.get('finale.victoryTitle'),
        width: 420,
        height: 420,
      }),
      el('div', { class: 'credits__scroll' }, [
        el('h3', { class: 'credits__heading' }, this.texts.get('finale.creditsTitle')),
        poemBlock,
      ]),
      stats,
      el('div', { class: 'credits__actions' }, [playAgain, toggle, close]),
    ]);
  }

  private buildStats(state: GameState): HTMLElement {
    const rows: Array<[string, string]> = [
      [this.texts.get('stats.time'), formatDuration(state.wonAtMs ?? state.playtimeMs)],
      [this.texts.get('stats.sold'), formatNumber(state.totalSold)],
      [this.texts.get('stats.earned'), formatMoney(state.totalEarned, this.currency)],
      [this.texts.get('stats.luxurySpent'), formatMoney(state.luxurySpent, this.currency)],
      [this.texts.get('stats.purchases'), String(state.totalPurchases)],
      [this.texts.get('stats.achievements'), String(state.achievements.length)],
    ];
    return el(
      'dl',
      { class: 'stats', hidden: true },
      rows.map(([label, value]) => el('div', { class: 'stats__row' }, [
        el('dt', {}, label),
        el('dd', {}, value),
      ])),
    );
  }

  private clearCutsceneTimer(): void {
    if (this.cutsceneTimer === null) return;
    window.clearTimeout(this.cutsceneTimer);
    this.cutsceneTimer = null;
  }

  hide(): void {
    this.clearCutsceneTimer();
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
