// @vitest-environment happy-dom
/**
 * «Правила игры» ↔ движок (REVIEW B3, B4, H7).
 * Окно правил собирается из config.json, но формулировки лежат в texts.json:
 * текст не должен утверждать то, чего игра не делает.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../src/core/content';
import { computeDerived, wellDeclineFactor, wellDeclineFloorSeconds } from '../../src/core/economy';
import { formatNumber, formatPercent } from '../../src/core/format';
import { createInitialState } from '../../src/core/state';
import { Rules } from '../../src/ui/rules';
import { Texts } from '../../src/ui/texts';
import type { Content } from '../../src/core/types';

function rulesOf(content: Content): { root: HTMLElement; texts: Texts; section: (titleKey: string) => string } {
  const texts = new Texts(content.texts);
  const rules = new Rules(content, texts, content.config.currency, () => undefined);
  const section = (titleKey: string): string => {
    const title = texts.get(titleKey);
    const node = [...rules.root.querySelectorAll('.rules__section')]
      .find((candidate) => candidate.querySelector('.rules__title')?.textContent === title);
    expect(node, `раздел «${title}»`).toBeDefined();
    return node!.textContent ?? '';
  };
  return { root: rules.root, texts, section };
}

describe('правила: падение дебита (REVIEW B4)', () => {
  const content = loadContent();
  const { config } = content;
  const decline = config.oil.wells.decline;

  it('движок: дебит падает до пола и дальше не снижается', () => {
    const floorSeconds = wellDeclineFloorSeconds(config);
    const at = (seconds: number): number => {
      const state = createInitialState(config, 1);
      state.playtimeMs = seconds * 1000;
      return wellDeclineFactor(config, state);
    };
    expect(decline.minFactor).toBeGreaterThan(0.5);
    // Пол достигается раньше «периода полураспада»: половины не будет никогда.
    expect(floorSeconds).toBeGreaterThan(0);
    expect(floorSeconds).toBeLessThan(decline.halfLifeSeconds);
    expect(floorSeconds).toBeCloseTo(decline.halfLifeSeconds * Math.log2(1 / decline.minFactor), 6);
    expect(at(0)).toBe(1);
    expect(at(floorSeconds - 1)).toBeGreaterThan(decline.minFactor);
    expect(at(floorSeconds + 1)).toBe(decline.minFactor);
    expect(at(decline.halfLifeSeconds)).toBe(decline.minFactor);
    expect(at(decline.halfLifeSeconds * 10)).toBe(decline.minFactor);
  });

  it('текст называет пол и время его достижения, а не «половину»', () => {
    const { section } = rulesOf(content);
    const wells = section('rules.wellsTitle');
    const minutes = Math.round(wellDeclineFloorSeconds(config) / 60);
    expect(minutes).toBeGreaterThan(0);
    expect(wells).toContain(formatPercent(decline.minFactor, 0));
    expect(wells).toContain(`${minutes} `);
    // Раньше правила обещали «половина уходит за 1800 секунд».
    expect(wells).not.toContain('половина');
    expect(wells).not.toContain(String(decline.halfLifeSeconds));
  });

  it('без падения дебита правила так и говорят', () => {
    const flat = structuredClone(content);
    flat.config.oil.wells.decline.minFactor = 1;
    expect(wellDeclineFloorSeconds(flat.config)).toBe(0);
    const { section, texts } = rulesOf(flat);
    expect(section('rules.wellsTitle')).toContain(texts.get('rules.wellsNoDecline'));
  });
});

describe('правила: внутренний рынок сырой нефти (REVIEW B3)', () => {
  it('ограниченный контрактный канал не описан как «берёт весь остаток»', () => {
    const content = loadContent();
    expect(content.config.oil.channels.contract.unlimited).toBe(false);
    const { section } = rulesOf(content);
    const channels = section('rules.channelsTitle');

    const state = createInitialState(content.config, 1);
    const derived = computeDerived(content.config, content.upgrades, state, [], content);
    const capacity = derived.capacities.domestic.crude;
    expect(Number.isFinite(capacity)).toBe(true);
    expect(capacity).toBeGreaterThan(0);

    expect(channels).not.toContain('весь остаток');
    // Стартовая мощность — та же, по которой движок ограничивает продажу.
    expect(channels).toContain(formatNumber(capacity));
  });

  it('безлимитный контрактный канал описан как безлимитный', () => {
    const content = structuredClone(loadContent());
    content.config.oil.channels.contract.unlimited = true;
    const { section, texts } = rulesOf(content);
    const channels = section('rules.channelsTitle');
    expect(channels).toContain(texts.get('rules.channelDomesticUnlimited'));
    expect(channels).toContain('весь остаток');
  });
});
