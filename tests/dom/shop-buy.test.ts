// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { Game } from '../../src/core/game';
import { createInitialState, normalizeState } from '../../src/core/state';
import { formatMoney } from '../../src/core/format';
import { Shop } from '../../src/ui/shop';
import { Texts } from '../../src/ui/texts';
import { Hud } from '../../src/ui/hud';
import { wellPricePerDailyTonne } from '../../src/core/economy';

describe('магазин: пакетная покупка из реальной кнопки', () => {
  it('кнопка «Купить 10» передаёт 10 в Game.buy и выдаёт 10 скважин', () => {
    const content = loadContent();
    const state = createInitialState(content.config, 77);
    state.coins = 1e12;
    state.totalEarned = 1e12;
    const game = new Game(content, state);
    const shop = new Shop(game, new Texts(content.texts), content.config.currency, {
      onBuy: (id, count) => {
        game.buy(id, count);
      },
      onError: (check) => {
        throw new Error(`покупка неожиданно заблокирована: ${check.reason}`);
      },
    });

    const initialWells = state.wells.length;
    shop.setTab('production');
    const button = shop.root.querySelector<HTMLButtonElement>('[data-id="t_well"] .card__buy')!;
    expect(button.textContent).toBe(content.texts.shop.buyMax.replace('{n}', '10'));
    expect(button.dataset.count).toBe('10');
    button.click();

    expect(state.levels.t_well).toBe(10);
    expect(state.wells).toHaveLength(initialWells + 10);
    const restored = normalizeState(
      JSON.parse(JSON.stringify(game.snapshot())), content.config, content,
    );
    expect(restored.levels.t_well).toBe(10);
    expect(restored.wells).toHaveLength(initialWells + 10);
  });

  it('не предлагает пакет для repeatable и финальной покупки', () => {
    const content = loadContent();
    const state = createInitialState(content.config, 78);
    state.coins = 1e15;
    state.totalEarned = 1e15;
    state.oil = 100;
    for (const req of content.config.winRequirements) {
      if (req.upgrade) state.levels[req.upgrade] = req.level ?? 1;
    }
    const game = new Game(content, state);
    const shop = new Shop(game, new Texts(content.texts), content.config.currency, {
      onBuy: () => undefined,
      onError: () => undefined,
    });
    shop.setTab('political');
    const repeatable = shop.root.querySelector<HTMLButtonElement>('[data-id="p_export"] .card__buy')!;
    expect(repeatable.dataset.count).toBe('1');
    expect(repeatable.textContent).not.toContain('10');

    shop.setTab('goals');
    const win = shop.root.querySelector<HTMLButtonElement>('[data-id="win_pump"] .card__buy')!;
    expect(win.dataset.count).toBe('1');
  });
});

describe('HUD согласован с экономикой', () => {
  it('показывает складской статус и единую рыночную стоимость скважин', () => {
    const content = loadContent();
    content.config.oil.channels.contract.unlimited = false;
    content.config.oil.channels.contract.baseRate = 100;
    const state = createInitialState(content.config, 4);
    state.levels.t_refinery = 1;
    state.wells = [{ kind: 'unique', dailyTonnes: 10_000 }];
    const game = new Game(content, state);
    const hud = new Hud(new Texts(content.texts), content.config.currency, content.config);
    hud.root.querySelector('[data-testid="balance"]')?.remove();
    document.body.append(hud.balance, hud.root);
    hud.update(state, game.derived());

    const spill = hud.root.textContent ?? '';
    expect(spill).toContain(content.texts.hud.productStorageEtaLabel);
    expect(game.derived().flows.productsSpill).toBe(0);
    expect(
      hud.root.querySelector('[data-row="productsStorageEta"]')?.textContent,
    ).toContain(content.texts.hud.productStorageFull);
    expect(Number.isFinite(game.derived().grossPerSecond)).toBe(true);

    const assetsRow = [...hud.root.querySelectorAll('.hud__row')]
      .find((row) => row.textContent?.includes(content.texts.hud.assets));
    expect(assetsRow?.textContent).toContain(formatMoney(
      game.derived().assetsValue,
      content.config.currency,
    ));
    expect(game.derived().assetsValue).toBeGreaterThanOrEqual(
      10_000 * wellPricePerDailyTonne(content.config),
    );
  });
});
