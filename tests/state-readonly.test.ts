/**
 * Состояние партии снаружи только читается (AUDIT F04).
 *
 * `Game.state` был публичным изменяемым полем: интерфейс или отладка могли
 * записать `coins` в обход `invalidate()` и оставить кеш производных
 * показателей устаревшим. Теперь движок пишет в приватное состояние, наружу
 * отдаётся `DeepReadonly<GameState>`, а подготовка сценариев идёт через
 * `addCoins()` / `stateForTests()`.
 *
 * Проверка компилятором — в `tests/harness.test.ts` (`npm run build`): файл с
 * записью в `game.state.coins` обязан не собираться. Здесь — то, что можно
 * проверить в рантайме.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/core/content';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';

const content = loadContent();
const newGame = (): Game => new Game(content, createInitialState(content.config, 7));

describe('состояние партии доступно снаружи только на чтение (AUDIT F04)', () => {
  it('чтение отдаёт те же данные, что и раньше', () => {
    const game = newGame();
    expect(game.state.coins).toBe(content.config.startCoins);
    expect(game.state.flowControl.export.mode).toBe('auto');
    expect(game.state.wells.length).toBe(1);
    expect(game.state.levels).toEqual({});
  });

  it('пополнение счёта идёт командой и сбрасывает кеш производных', () => {
    const game = newGame();
    const before = game.derived();
    game.addCoins(1e12);
    // Кеш сброшен: прогресс до финала пересчитан, а не взят из старого снимка.
    expect(game.derived().progress).toBeGreaterThan(before.progress);
    expect(game.state.coins).toBe(content.config.startCoins + 1e12);
    expect(game.state.totalEarned).toBe(content.config.startCoins + 1e12);
  });

  it('команда не принимает мусор: отрицательные и нечисловые суммы игнорируются', () => {
    const game = newGame();
    const coins = game.state.coins;
    game.addCoins(-5);
    game.addCoins(Number.NaN);
    game.addCoins(Number.POSITIVE_INFINITY);
    expect(game.state.coins).toBe(coins);
  });

  it('дверь для тестов отдаёт то же состояние, что читает интерфейс', () => {
    const game = newGame();
    expect(game.stateForTests()).toBe(game.state);
    game.stateForTests().coins = 42;
    expect(game.state.coins).toBe(42);
  });
});
