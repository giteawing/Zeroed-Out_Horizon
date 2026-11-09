/**
 * Ручное распределение сырой нефти между рынками и НПЗ.
 *
 * Фиксированный режим резервирует указанный поток. Авто отдаёт каналу
 * максимально возможный остаток с учётом физических мощностей и цены.
 */
import { el } from './dom';
import type { Texts } from './texts';
import { formatNumber } from '../core/format';
import type { Channel, DerivedStats, FlowControl, GameState } from '../core/types';
import type { Game } from '../core/game';

interface FlowRow {
  input: HTMLInputElement;
  status: HTMLElement;
  auto: HTMLButtonElement;
  max: HTMLButtonElement;
}

const CHANNELS: Channel[] = ['export', 'refine', 'contract'];

export class FlowControlsPanel {
  readonly root: HTMLElement;
  private readonly rows = new Map<Channel, FlowRow>();

  constructor(
    private readonly game: Game,
    private readonly texts: Texts,
    private readonly onChange: () => void,
  ) {
    const body = CHANNELS.map((channel) => {
      const input = el('input', {
        type: 'number',
        min: '0',
        step: '0.1',
        inputMode: 'decimal',
        class: 'flow-controls__input',
        'data-flow-input': channel,
        'aria-label': texts.get(`flows.${channel}`),
      });
      input.placeholder = texts.get('flows.autoPlaceholder');
      const auto = el('button', {
        type: 'button',
        class: 'flow-controls__auto',
        'data-flow-auto': channel,
      }, texts.get('flows.autoButton'));
      const max = el('button', {
        type: 'button',
        class: 'flow-controls__max',
        'data-flow-max': channel,
      }, texts.get('flows.maxButton'));
      const status = el('small', { class: 'flow-controls__status' }, '');
      const row = el('div', { class: 'flow-controls__row' }, [
        el('label', { class: 'flow-controls__label' }, [
          el('span', {}, texts.get(`flows.${channel}`)),
          input,
        ]),
        el('div', { class: 'flow-controls__actions' }, [max, auto]),
        status,
      ]);
      this.rows.set(channel, { input, status, auto, max });
      max.addEventListener('click', () => {
        const maximum = this.game.derived().flowLimits[channel];
        if (this.game.setFlowControl(channel, { mode: 'fixed', value: maximum })) {
          this.onChange();
          this.update(this.game.state, this.game.derived());
        }
      });
      input.addEventListener('change', () => this.setFixed(channel, input));
      auto.addEventListener('click', () => {
        if (this.game.setFlowControl(channel, { mode: 'auto', value: 0 })) {
          this.onChange();
          this.update(this.game.state, this.game.derived());
        }
      });
      return row;
    });
    this.root = el('section', {
      class: 'flow-controls',
      'data-testid': 'flow-controls',
    }, [
      el('div', { class: 'flow-controls__heading' }, texts.get('flows.title')),
      el('p', { class: 'flow-controls__hint' }, texts.get('flows.hint')),
      ...body,
    ]);
  }

  private setFixed(channel: Channel, input: HTMLInputElement): void {
    const value = Number(input.value);
    const setting: FlowControl = { mode: 'fixed', value };
    if (!this.game.setFlowControl(channel, setting)) {
      input.setCustomValidity(this.texts.get('flows.invalid'));
      input.reportValidity();
      input.setCustomValidity('');
      this.update(this.game.state, this.game.derived());
      return;
    }
    this.onChange();
    this.update(this.game.state, this.game.derived());
  }

  update(state: GameState, derived: DerivedStats): void {
    const actual: Record<Channel, number> = {
      contract: derived.flows.domestic,
      export: derived.flows.export,
      refine: derived.flows.refined,
    };
    for (const channel of CHANNELS) {
      const row = this.rows.get(channel);
      if (!row) continue;
      const setting = state.flowControl[channel];
      if (document.activeElement !== row.input) {
        row.input.value = setting.mode === 'fixed' ? String(setting.value) : '';
      }
      row.input.max = String(derived.flowLimits[channel]);
      row.input.disabled = state.won;
      row.auto.disabled = state.won;
      row.max.disabled = state.won;
      row.max.setAttribute(
        'aria-pressed',
        setting.mode === 'fixed' && Math.abs(setting.value - derived.flowLimits[channel]) <= 1e-9
          ? 'true'
          : 'false',
      );
      row.auto.setAttribute('aria-pressed', setting.mode === 'auto' ? 'true' : 'false');
      row.status.textContent = this.texts.get('flows.status', {
        actual: formatNumber(actual[channel]),
        maximum: formatNumber(derived.flowLimits[channel]),
      });
    }
  }
}
