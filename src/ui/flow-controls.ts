/**
 * Ручное распределение сырой нефти между рынками и НПЗ.
 *
 * У каждого направления три состояния. «Фиксировано» резервирует введённый
 * поток. «Макс.» числа не хранит: направление забирает весь доступный объём,
 * поэтому поле пересчитывается само — после покупки скважины, строительства
 * трубы или правки соседнего направления. «Авто» получает остаток по цене.
 */
import { el, setText } from './dom';
import type { Texts } from './texts';
import { formatNumber } from '../core/format';
import type { DerivedStats, FlowControl, FlowKey, GameState } from '../core/types';
import type { Game } from '../core/game';

interface FlowRow {
  input: HTMLInputElement;
  status: HTMLElement;
  auto: HTMLButtonElement;
  max: HTMLButtonElement;
  /**
   * Игрок печатает и ещё не подтвердил ввод. Пока так, поле принадлежит ему:
   * пересчёт «Макс.» не затирает набираемое значение.
   */
  editing: boolean;
}

/**
 * Порядок направлений в «Логистике»: сначала три пути сырья, затем два рынка
 * нефтепродуктов. Сырьё и топливо не смешиваются, поэтому подписи разные.
 */
const CRUDE_FLOWS: FlowKey[] = ['export', 'refine', 'contract'];
const PRODUCT_FLOWS: FlowKey[] = ['productExport', 'productDomestic'];

/**
 * Значение для поля: без «хвоста» двоичной арифметики (37,300000000000004).
 * Округление вверх не должно выводить число за предел направления — иначе
 * браузер пометит собственное поле как ошибочное.
 */
function fieldValue(value: number, limit: number): string {
  const digits = 4;
  const rounded = Number(value.toFixed(digits));
  const safe = rounded > limit ? Math.floor(value * 10 ** digits) / 10 ** digits : rounded;
  return String(Number(Math.max(0, safe).toFixed(digits)));
}

export class FlowControlsPanel {
  readonly root: HTMLElement;
  private readonly rows = new Map<FlowKey, FlowRow>();

  constructor(
    private readonly game: Game,
    private readonly texts: Texts,
    private readonly onChange: () => void,
  ) {
    const rowOf = (channel: FlowKey): HTMLElement => {
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
      const row: FlowRow = { input, status, auto, max, editing: false };
      const rowElement = el('div', { class: 'flow-controls__row' }, [
        el('label', { class: 'flow-controls__label' }, [
          el('span', {}, texts.get(`flows.${channel}`)),
          input,
        ]),
        el('div', { class: 'flow-controls__actions' }, [max, auto]),
        status,
      ]);
      this.rows.set(channel, row);
      input.addEventListener('input', () => {
        row.editing = true;
      });
      // Бросили поле недописанным — возвращаем в нём значение из состояния.
      input.addEventListener('blur', () => {
        row.editing = false;
        this.update(this.game.state, this.game.derived());
      });
      input.addEventListener('change', () => this.setFixed(channel, input));
      max.addEventListener('click', () => {
        this.apply(channel, { mode: 'max', value: 0 });
      });
      auto.addEventListener('click', () => {
        this.apply(channel, { mode: 'auto', value: 0 });
      });
      return rowElement;
    };
    const body = [
      ...CRUDE_FLOWS.map((channel) => rowOf(channel)),
      el('div', { class: 'flow-controls__subheading' }, texts.get('flows.productsTitle')),
      ...PRODUCT_FLOWS.map((channel) => rowOf(channel)),
    ];
    this.root = el('section', {
      class: 'flow-controls',
      'data-testid': 'flow-controls',
    }, [
      el('div', { class: 'flow-controls__heading' }, texts.get('flows.title')),
      el('p', { class: 'flow-controls__hint' }, texts.get('flows.hint')),
      ...body,
    ]);
  }

  /**
   * Применить режим направления и перерисовать панель.
   *
   * Кнопка забирает поле у игрока: нажатие во время набора отменяет ввод,
   * иначе «Макс.» оставил бы в поле старое число и не показал бы свой.
   */
  private apply(channel: FlowKey, setting: FlowControl): void {
    const row = this.rows.get(channel);
    if (row) row.editing = false;
    if (!this.game.setFlowControl(channel, setting)) return;
    this.onChange();
    this.update(this.game.state, this.game.derived());
  }

  /**
   * Применить введённое в поле значение.
   *
   * Пустое поле — это «Авто», как подсказывает placeholder: раньше
   * `Number('') === 0` молча превращал стёртое значение в «фиксированный 0»
   * и отключал маршрут. Нечисловой ввод браузер тоже отдаёт пустой строкой,
   * но с `validity.badInput` — это ошибка, а не просьба включить «Авто».
   */
  private setFixed(channel: FlowKey, input: HTMLInputElement): void {
    const row = this.rows.get(channel);
    if (row) row.editing = false;
    const raw = input.value.trim();
    const badInput = input.validity?.badInput === true;
    const setting: FlowControl | null = badInput
      ? null
      : raw === ''
        ? { mode: 'auto', value: 0 }
        : { mode: 'fixed', value: Number(raw.replace(',', '.')) };
    if (!setting || !this.game.setFlowControl(channel, setting)) {
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
    const actual: Record<FlowKey, number> = {
      contract: derived.flows.domestic,
      export: derived.flows.export,
      refine: derived.flows.refined,
      productDomestic: derived.flows.productsDomestic,
      productExport: derived.flows.productsExport,
    };
    for (const channel of [...CRUDE_FLOWS, ...PRODUCT_FLOWS]) {
      const row = this.rows.get(channel);
      if (!row) continue;
      const setting = state.flowControl[channel];
      const limit = derived.flowLimits[channel];
      // «Макс.» показывает объём, который направление забирает сейчас: он
      // меняется вместе с добычей и заявками соседей, поэтому поле нельзя
      // замораживать числом, записанным при нажатии кнопки. Перезаписываем
      // только то, что действительно изменилось: лишняя запись в поле
      // сбрасывает курсор, пока игрок правит значение.
      if (!row.editing) {
        const next = setting.mode === 'auto'
          ? ''
          : fieldValue(setting.mode === 'max' ? derived.flowClaims[channel] : setting.value, limit);
        if (row.input.value !== next) row.input.value = next;
      }
      row.input.max = String(limit);
      row.input.disabled = state.won;
      row.auto.disabled = state.won;
      row.max.disabled = state.won;
      row.max.setAttribute('aria-pressed', setting.mode === 'max' ? 'true' : 'false');
      row.auto.setAttribute('aria-pressed', setting.mode === 'auto' ? 'true' : 'false');
      setText(row.status, this.texts.get('flows.status', {
        actual: formatNumber(actual[channel]),
        maximum: formatNumber(limit),
      }));
    }
  }
}
