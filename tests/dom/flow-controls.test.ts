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
import type { Channel, GameState } from '../../src/core/types';

const content = loadContent();
let state: GameState;
let game: Game;
let panel: FlowControlsPanel;
let onChange: ReturnType<typeof vi.fn<() => void>>;

const inputOf = (channel: Channel): HTMLInputElement => {
  const input = panel.root.querySelector<HTMLInputElement>(`[data-flow-input="${channel}"]`);
  expect(input).not.toBeNull();
  return input!;
};
const type = (channel: Channel, value: string): HTMLInputElement => {
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
    expect(local.flowControl.contract).toEqual({ mode: 'fixed', value: limits.contract });
  });
});
