// @vitest-environment happy-dom
/**
 * REVIEW A6: поле потока. Пустое поле — это «Авто» (так говорит placeholder),
 * а не «фиксированный ноль», который молча отключает маршрут.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../src/core/content';
import { Game } from '../../src/core/game';
import { createInitialState } from '../../src/core/state';
import { FlowControlsPanel } from '../../src/ui/flow-controls';
import { Texts } from '../../src/ui/texts';
import type { Channel, FlowKey, GameState } from '../../src/core/types';

const content = loadContent();
let state: GameState;
let game: Game;
let panel: FlowControlsPanel;
let onChange: ReturnType<typeof vi.fn<() => void>>;

const inputOf = (channel: FlowKey): HTMLInputElement => {
  const input = panel.root.querySelector<HTMLInputElement>(`[data-flow-input="${channel}"]`);
  expect(input).not.toBeNull();
  return input!;
};
const type = (channel: FlowKey, value: string): HTMLInputElement => {
  const input = inputOf(channel);
  input.value = value;
  input.dispatchEvent(new Event('change'));
  return input;
};

beforeEach(() => {
  document.body.innerHTML = '';
  state = createInitialState(content.config, 5);
  state.wells = [{ kind: 'unique', dailyTonnes: 1000 }];
  game = new Game(content, state);
  onChange = vi.fn<() => void>();
  panel = new FlowControlsPanel(game, new Texts(content.texts), onChange);
  document.body.append(panel.root);
  panel.update(state, game.derived());
});

describe('поле потока (REVIEW A6)', () => {
  it('число переводит канал в фиксированный режим', () => {
    type('contract', '0');
    expect(state.flowControl.contract).toEqual({ mode: 'fixed', value: 0 });
    type('contract', '12.5');
    expect(state.flowControl.contract).toEqual({ mode: 'fixed', value: 12.5 });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('пустое поле возвращает «Авто», а не фиксированный ноль', () => {
    type('contract', '7');
    expect(state.flowControl.contract.mode).toBe('fixed');
    const flowBefore = game.derived().flows.domestic;
    expect(flowBefore).toBeCloseTo(7, 9);

    const input = type('contract', '');
    expect(state.flowControl.contract).toEqual({ mode: 'auto', value: 0 });
    // Маршрут не отключился: авто снова отдаёт каналу доступный остаток.
    expect(game.derived().flows.domestic).toBeGreaterThan(flowBefore);
    expect(input.value).toBe('');
    const auto = panel.root.querySelector('[data-flow-auto="contract"]');
    expect(auto).not.toBeNull();
    expect(auto!.getAttribute('aria-pressed')).toBe('true');
  });

  it('десятичная запятая понимается как точка', () => {
    const input = inputOf('contract');
    Object.defineProperty(input, 'value', { value: '2,5', configurable: true, writable: true });
    input.dispatchEvent(new Event('change'));
    expect(state.flowControl.contract).toEqual({ mode: 'fixed', value: 2.5 });
  });

  it('нечисловой ввод не превращается в «Авто» и не меняет маршрут', () => {
    type('contract', '4');
    const input = inputOf('contract');
    const report = vi.spyOn(input, 'reportValidity').mockReturnValue(false);
    // Браузер для type="number" отдаёт value === '' и validity.badInput === true.
    Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
    input.value = '';
    input.dispatchEvent(new Event('change'));
    expect(state.flowControl.contract).toEqual({ mode: 'fixed', value: 4 });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('значение выше физического максимума отклоняется', () => {
    const limit = game.derived().flowLimits.contract;
    const input = inputOf('contract');
    const report = vi.spyOn(input, 'reportValidity').mockReturnValue(false);
    type('contract', String(limit * 10));
    expect(state.flowControl.contract).toEqual({ mode: 'auto', value: 0 });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('предел потока конечен даже для безлимитного канала, «Макс.» работает', () => {
    const unlimited = structuredClone(content);
    unlimited.config.oil.channels.contract.unlimited = true;
    const local = createInitialState(unlimited.config, 6);
    local.wells = [{ kind: 'unique', dailyTonnes: 1000 }];
    const localGame = new Game(unlimited, local);
    const localPanel = new FlowControlsPanel(localGame, new Texts(unlimited.texts), () => undefined);
    localPanel.update(local, localGame.derived());

    const limits = localGame.derived().flowLimits;
    for (const channel of ['contract', 'export', 'refine'] as Channel[]) {
      expect(Number.isFinite(limits[channel]), channel).toBe(true);
    }
    const max = localPanel.root.querySelector<HTMLButtonElement>('[data-flow-max="contract"]');
    const input = localPanel.root.querySelector<HTMLInputElement>('[data-flow-input="contract"]');
    expect(max).not.toBeNull();
    expect(input).not.toBeNull();
    expect(input!.max).not.toBe('Infinity');
    max!.click();
    expect(local.flowControl.contract.mode).toBe('max');
    expect(Number(input!.value)).toBeCloseTo(limits.contract, 3);
  });
});

/**
 * «Макс.» — это не разовое число, а состояние направления: пока кнопка
 * нажата, поле показывает текущий предел и пересчитывается вместе с добычей
 * и заявками соседей (иначе после покупки скважины поле застывает).
 */
describe('«Макс.» и «Авто» в «Логистике»', () => {
  const buttonOf = (channel: FlowKey, kind: 'max' | 'auto'): HTMLButtonElement => {
    const button = panel.root.querySelector<HTMLButtonElement>(`[data-flow-${kind}="${channel}"]`);
    expect(button).not.toBeNull();
    return button!;
  };
  const limitOf = (channel: FlowKey): number => game.derived().flowLimits[channel];
  const shownOf = (channel: FlowKey): number => Number(inputOf(channel).value);
  /** Добыча выросла: игрок купил скважину. */
  const addWell = (dailyTonnes = 1000): void => {
    state.wells = [...state.wells, { kind: 'unique' as const, dailyTonnes }];
    game.invalidate();
    panel.update(state, game.derived());
  };

  it('«Макс.» держит поле на пределе, пока растёт добыча', () => {
    buttonOf('contract', 'max').click();
    expect(state.flowControl.contract.mode).toBe('max');
    const before = shownOf('contract');
    expect(before).toBeCloseTo(limitOf('contract'), 3);
    expect(game.derived().flows.domestic).toBeCloseTo(before, 3);

    addWell();
    const after = shownOf('contract');
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(limitOf('contract'), 3);
    // Поле не застыло: новый объём действительно пошёл по направлению.
    expect(game.derived().flows.domestic).toBeCloseTo(after, 3);
    // Кнопка осталась нажатой: число в поле по-прежнему считается, а не записано.
    expect(state.flowControl.contract.mode).toBe('max');
  });

  it('ручная правка соседа пересчитывает направления на «Макс.»', () => {
    // Нужен НПЗ: без завода переработке некуда принимать сырьё.
    state.levels.t_refinery = 1;
    game.invalidate();
    panel.update(state, game.derived());
    buttonOf('contract', 'max').click();
    const whole = shownOf('contract');

    // Сырьё забирает переработка: у внутреннего рынка остаётся остаток.
    type('refine', String(Math.round(whole / 4)));
    expect(state.flowControl.refine.mode).toBe('fixed');
    expect(shownOf('contract')).toBeCloseTo(limitOf('contract'), 3);
    expect(shownOf('contract')).toBeLessThan(whole);
    expect(game.derived().flows.domestic).toBeCloseTo(shownOf('contract'), 3);

    // Сняли квоту — «Макс.» снова забирает всю добычу.
    type('refine', '');
    expect(shownOf('contract')).toBeCloseTo(whole, 3);
  });

  it('кнопки «Макс.» и «Авто» переключаются и показаны в aria-pressed', () => {
    const max = buttonOf('contract', 'max');
    const auto = buttonOf('contract', 'auto');
    expect(max.getAttribute('aria-pressed')).toBe('false');
    expect(auto.getAttribute('aria-pressed')).toBe('true');

    max.click();
    expect(state.flowControl.contract.mode).toBe('max');
    expect(max.getAttribute('aria-pressed')).toBe('true');
    expect(auto.getAttribute('aria-pressed')).toBe('false');

    // Введённое число — уже не максимум, а своя квота.
    type('contract', '5');
    expect(state.flowControl.contract).toEqual({ mode: 'fixed', value: 5 });
    expect(max.getAttribute('aria-pressed')).toBe('false');
    expect(auto.getAttribute('aria-pressed')).toBe('false');

    auto.click();
    expect(state.flowControl.contract).toEqual({ mode: 'auto', value: 0 });
    expect(auto.getAttribute('aria-pressed')).toBe('true');
    expect(inputOf('contract').value).toBe('');

    // Повторное нажатие «Макс.» ничего не ломает.
    max.click();
    max.click();
    expect(state.flowControl.contract.mode).toBe('max');
    expect(shownOf('contract')).toBeCloseTo(limitOf('contract'), 3);
  });

  it('повторное нажатие «Макс.» перехватывает объём у прежней заявки', () => {
    // Нужен НПЗ: без завода переработке некуда принимать сырьё.
    state.levels.t_refinery = 1;
    game.invalidate();
    panel.update(state, game.derived());
    buttonOf('contract', 'max').click();
    const whole = shownOf('contract');
    expect(whole).toBeGreaterThan(0);

    // «Макс.» нажали позже: переработка забирает объём первой.
    buttonOf('refine', 'max').click();
    expect(state.flowControl.refine.value).toBeGreaterThan(state.flowControl.contract.value);
    expect(game.derived().flows.refined).toBeGreaterThan(0);
    expect(shownOf('contract')).toBeLessThan(whole);
    expect(shownOf('contract') + shownOf('refine')).toBeCloseTo(whole, 3);
  });

  it('набираемое значение не затирается пересчётом, пока поле не покинули', () => {
    type('contract', '12.5');
    const input = inputOf('contract');
    input.focus();
    input.value = '99';
    input.dispatchEvent(new Event('input'));
    addWell();
    expect(input.value).toBe('99');

    // Бросили поле: в нём снова значение из состояния.
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('12.5');
  });

  it('отклонённое значение возвращает поле к значению из состояния', () => {
    type('contract', '4');
    const input = inputOf('contract');
    input.focus();
    input.value = '999999';
    input.dispatchEvent(new Event('input'));
    const report = vi.spyOn(input, 'reportValidity').mockReturnValue(false);
    input.dispatchEvent(new Event('change'));
    expect(report).toHaveBeenCalledTimes(1);
    expect(state.flowControl.contract).toEqual({ mode: 'fixed', value: 4 });
    expect(input.value).toBe('4');
  });

  it('«Макс.» работает и у рынков нефтепродуктов', () => {
    // Нужен НПЗ: без выпуска делить нечего.
    state.levels = { t_refinery: 2, t_depot: 2 };
    game.invalidate();
    panel.update(state, game.derived());
    const channel: FlowKey = 'productDomestic';
    expect(limitOf(channel)).toBeGreaterThan(0);
    buttonOf(channel, 'max').click();
    expect(state.flowControl[channel].mode).toBe('max');
    // Поле показывает выпуск, который рынок реально забирает.
    const claimed = shownOf(channel);
    expect(claimed).toBeGreaterThan(0);
    expect(game.derived().flows.productsDomestic).toBeCloseTo(claimed, 3);

    // Выросла добыча — вырос и выпуск НПЗ, а с ним поле «Макс.».
    addWell();
    expect(shownOf(channel)).toBeGreaterThan(claimed);
  });

  it('две заявки «Макс.» на рынках топлива делят выпуск НПЗ', () => {
    // Экспортный терминал нужен, иначе за границу топливо уйти не может.
    state.levels = { t_refinery: 2, t_depot: 2, t_productport: 1 };
    game.invalidate();
    panel.update(state, game.derived());
    buttonOf('productDomestic', 'max').click();
    const alone = shownOf('productDomestic');
    expect(alone).toBeGreaterThan(0);

    // Экспорт забирает выпуск первым: внутреннему рынку не остаётся тонн.
    buttonOf('productExport', 'max').click();
    expect(shownOf('productExport')).toBeGreaterThan(0);
    expect(shownOf('productDomestic')).toBe(0);
    expect(game.derived().flows.productsDomestic).toBe(0);

    // Сняли заявку экспорта — внутренний рынок снова забирает весь выпуск.
    buttonOf('productExport', 'auto').click();
    expect(shownOf('productDomestic')).toBeCloseTo(alone, 3);
  });
});
