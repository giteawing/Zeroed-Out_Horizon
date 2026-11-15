// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { crudeStatsBreakdown } from '../../src/core/economy';
import { formatNumber } from '../../src/core/format';
import { Game } from '../../src/core/game';
import { createInitialState } from '../../src/core/state';
import { CrudeDetails } from '../../src/ui/crude-details';
import { Hud } from '../../src/ui/hud';
import { Texts } from '../../src/ui/texts';

function setup() {
  const content = structuredClone(loadContent());
  const state = createInitialState(content.config, 5);
  state.playtimeMs = content.config.oil.wells.decline.halfLifeSeconds * 1000;
  state.wells = [
    { kind: 'ordinary', dailyTonnes: 10 },
    { kind: 'good', dailyTonnes: 50 },
    { kind: 'unique', dailyTonnes: 200 },
  ];
  state.levels = {
    c_local: 3,
    e_rail: 2,
    e_contracts: 1,
  };
  state.coins = 1e12;
  state.totalEarned = 1e12;
  const game = new Game(content, state);
  const texts = new Texts(content.texts);
  return { content, state, game, texts };
}

describe('подробная статистика сырой нефти, рынков и договоров', () => {
  it('кнопки открытия стоят в нужных строках HUD и не меняют подписи строк', () => {
    const { content, texts } = setup();
    const hud = new Hud(texts, content.config.currency, content.config);

    const checks: Array<[string, string, string]> = [
      ['produced', 'wells', texts.get('hud.production')],
      ['salesBoost', 'contracts', texts.get('hud.salesBoost')],
      ['crudeMarketDomestic', 'domestic', texts.get('hud.marketDomestic')],
      ['crudeMarketExport', 'export', texts.get('hud.marketExport')],
    ];
    for (const [rowKey, section, expectedLabel] of checks) {
      const row = hud.root.querySelector(`[data-row="${rowKey}"]`);
      expect(row, rowKey).not.toBeNull();
      expect(row!.querySelector('.hud__row-label')?.textContent).toBe(expectedLabel);
      const btn = row!.querySelector<HTMLButtonElement>(`[data-open-crude="${section}"]`);
      expect(btn, section).not.toBeNull();
      expect(btn!.type).toBe('button');
      expect(btn!.getAttribute('aria-haspopup')).toBe('dialog');
      expect(btn!.getAttribute('aria-controls')).toBe('crude-stats');
    }
  });

  it('показывает скважины в формате x/y, фильтр классов, рынки и договоры из ядра', () => {
    const { game, texts } = setup();
    const modal = new CrudeDetails(game, texts);
    expect(modal.visible).toBe(false);
    modal.open('wells');
    expect(modal.visible).toBe(true);
    expect(modal.root.getAttribute('role')).toBe('dialog');
    expect(modal.root.getAttribute('aria-label')).toBe(texts.get('panel.crudeTitle'));

    const d = game.derived();
    const breakdown = crudeStatsBreakdown(game.config, game.content.upgrades, game.state, d);
    const wells = [...modal.root.querySelectorAll('[data-crude-well]')];
    expect(wells).toHaveLength(3);
    expect(wells[0]!.textContent).toContain(`${formatNumber(10 * breakdown.production.declineFactor)}/${formatNumber(10)}`);
    expect(wells[2]!.textContent).toContain(`${formatNumber(200 * breakdown.production.declineFactor)}/${formatNumber(200)}`);

    // Фильтр по классу «уникальная».
    modal.root.querySelector<HTMLButtonElement>('[data-crude-filter="unique"]')?.click();
    expect(modal.root.querySelectorAll('[data-crude-well]')).toHaveLength(1);
    modal.root.querySelector<HTMLButtonElement>('[data-crude-filter="all"]')?.click();
    expect(modal.root.querySelectorAll('[data-crude-well]')).toHaveLength(3);

    // Секции рынков и договоров содержат данные ядра.
    const stat = (key: string): string => {
      const node = modal.root.querySelector(`[data-crude-stat="${key}"]`);
      expect(node, key).not.toBeNull();
      return node!.textContent ?? '';
    };
    expect(stat('productionRate')).toContain(formatNumber(d.oilPerSecond));
    expect(stat('domesticCrudeVolume')).toContain(formatNumber(d.capacities.domestic.crude));
    expect(stat('exportCrudeVolume')).toContain(formatNumber(d.capacities.export.crude));
    expect(stat('contractsMultiplier')).toContain(`×${formatNumber(d.salesVolumeMultiplier)}`);
    expect(modal.root.querySelector('[data-crude-contract="c_local"]')?.textContent).toContain(
      game.content.byId.get('c_local')!.name,
    );
  });

  it('пагинирует длинный список скважин и закрывается кнопкой и затемнением', () => {
    const { game, texts } = setup();
    game.stateForTests().wells = Array.from({ length: 125 }, (_, i) => ({
      kind: i % 2 === 0 ? 'ordinary' : 'good',
      dailyTonnes: 10 + i,
    }));
    const modal = new CrudeDetails(game, texts);
    modal.open();
    expect(modal.root.querySelectorAll('[data-crude-well]')).toHaveLength(100);
    const next = modal.root.querySelector<HTMLButtonElement>('[data-crude-page="next"]');
    expect(next).not.toBeNull();
    next!.click();
    expect(modal.root.querySelectorAll('[data-crude-well]')).toHaveLength(25);

    modal.root.querySelector<HTMLButtonElement>('[data-crude-close]')?.click();
    expect(modal.visible).toBe(false);
    modal.open();
    modal.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(modal.visible).toBe(false);
  });
});
