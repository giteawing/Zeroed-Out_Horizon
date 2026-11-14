// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { formatNumber, formatPercent } from '../../src/core/format';
import { Game } from '../../src/core/game';
import { createInitialState } from '../../src/core/state';
import { Hud } from '../../src/ui/hud';
import { RefineryDetails } from '../../src/ui/refinery-details';
import { Shop } from '../../src/ui/shop';
import { Texts } from '../../src/ui/texts';

function setup() {
  const content = structuredClone(loadContent());
  const state = createInitialState(content.config, 5);
  state.wells = [{ kind: 'unique', dailyTonnes: 1500 }];
  state.levels = { t_refinery: 2, p_refinery: 1, r_depth_vacuum: 2, r_depth_visbreaking: 1 };
  state.coins = 1e15;
  state.totalEarned = 1e15;
  state.flowControl.contract = { mode: 'fixed', value: 0 };
  state.flowControl.export = { mode: 'fixed', value: 0 };
  const game = new Game(content, state);
  const texts = new Texts(content.texts);
  return { content, state, game, texts };
}

describe('статистика НПЗ', () => {
  it('кнопка находится рядом с выпуском нефтепродуктов и доступна клавиатуре', () => {
    const { content, texts } = setup();
    const hud = new Hud(texts, content.config.currency, content.config);
    const row = hud.root.querySelector('[data-row="productsOut"]');
    expect(row).not.toBeNull();
    const button = row!.querySelector<HTMLButtonElement>('[data-open-refinery]');
    expect(button).not.toBeNull();
    expect(button!.type).toBe('button');
    expect(button!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button!.getAttribute('aria-controls')).toBe('refinery-stats');
    expect(button!.getAttribute('aria-label')).toBe(texts.get('panel.refineriesTitle'));
  });

  it('показывает число заводов, каждую ступень, среднюю глубину и фактический выпуск из ядра', () => {
    const { game, texts } = setup();
    const modal = new RefineryDetails(game, texts);
    expect(modal.visible).toBe(false);
    modal.open();
    expect(modal.visible).toBe(true);
    expect(modal.root.getAttribute('role')).toBe('dialog');
    expect(modal.root.getAttribute('aria-label')).toBe(texts.get('panel.refineriesTitle'));
    const stat = (name: string): string => {
      const node = modal.root.querySelector(`[data-refinery-stat="${name}"]`);
      expect(node, name).not.toBeNull();
      return node!.textContent ?? '';
    };
    const d = game.derived();
    expect(stat('plants')).toContain('3');
    expect(stat('depth')).toContain(formatPercent(d.refineries.averageDepth, 1));
    expect(stat('input')).toContain(formatNumber(d.flows.refined));
    expect(stat('production')).toContain(formatNumber(d.flows.productsProduced));
    expect(stat('capacity')).toContain(formatNumber(d.refineryThroughputCapacity));
    for (const stage of d.refineries.stages) {
      const line = modal.root.querySelector(`[data-refinery-stage="${stage.id}"]`);
      expect(line, stage.id).not.toBeNull();
      expect(line!.textContent).toContain(game.content.byId.get(stage.id)!.name);
      expect(line!.textContent).toContain(`${stage.count} / 3`);
      expect(line!.textContent).toContain(formatPercent(stage.depth, 0));
    }
  });

  it('после покупки обновляет показания и закрывается кнопкой и затемнением', () => {
    const { game, texts } = setup();
    game.unlockAllForDevelopment();
    const modal = new RefineryDetails(game, texts);
    modal.open();
    expect(game.buy('r_depth_fcc').ok).toBe(true);
    modal.render();
    const stage = modal.root.querySelector('[data-refinery-stage="r_depth_fcc"]');
    expect(stage).not.toBeNull();
    expect(stage!.textContent).toContain('1 / 3');
    const close = modal.root.querySelector<HTMLButtonElement>('[data-refinery-close]');
    expect(close).not.toBeNull();
    close!.click();
    expect(modal.visible).toBe(false);
    modal.open();
    modal.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(modal.visible).toBe(false);
  });

  it('карточки не предлагают больше установок, чем подходящих заводов', () => {
    const { game, texts, content } = setup();
    const shop = new Shop(game, texts, content.config.currency, {
      onBuy: (id, count) => { expect(game.buy(id, count).ok).toBe(true); },
    });
    shop.setTab('production');
    const card = shop.root.querySelector<HTMLElement>('[data-id="r_depth_visbreaking"]');
    expect(card).not.toBeNull();
    const button = card!.querySelector<HTMLButtonElement>('.card__buy');
    const lock = card!.querySelector<HTMLElement>('.card__lock');
    expect(button).not.toBeNull();
    expect(lock).not.toBeNull();
    expect(button!.dataset.count).toBe('1');
    expect(button!.disabled).toBe(false);
    button!.click();
    shop.update();
    expect(game.level('r_depth_visbreaking')).toBe(2);
    expect(button!.disabled).toBe(true);
    expect(button!.dataset.reason).toBe('noRefinerySlot');
    expect(lock!.textContent).toBe(texts.get('shop.buyFailRefinerySlot'));
  });

  it('при отсутствии заводов показывает нули, а не NaN и не Infinity', () => {
    const content = structuredClone(loadContent());
    const game = new Game(content, createInitialState(content.config, 9));
    const modal = new RefineryDetails(game, new Texts(content.texts));
    modal.open();
    expect(modal.root.textContent).not.toMatch(/NaN|Infinity/);
    expect(modal.root.textContent).toContain('0 / 0');
    const depth = modal.root.querySelector('[data-refinery-stat="depth"]');
    expect(depth).not.toBeNull();
    expect(depth!.textContent).toContain(formatPercent(0, 1));
  });
});
