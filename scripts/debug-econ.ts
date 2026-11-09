import { loadContent } from '../src/core/content';
import { Game } from '../src/core/game';
import { createInitialState } from '../src/core/state';
import { decide } from '../src/core/simulator';

const content = loadContent();
const state = createInitialState(content.config, 7);
const game = new Game(content, state);
const bought = new Set<string>();
let lastBuy = '';
for (let s = 0; s < 900; s++) {
  game.update(1000);
  if (s % 2 === 0) {
    const before = state.coins;
    if (decide(game, content, bought)) {
      const spent = before - state.coins;
      if (spent > 0) lastBuy = `${spent.toFixed(0)}₦`;
    }
  }
  if (s % 60 === 0) {
    const d = game.derived();
    const fill = (state.oil / d.oilCapacity) * 100;
    console.log(`t=${String(s).padStart(3)}с ₦${state.coins.toFixed(0).padStart(8)} нефть ${fill.toFixed(0)}% добыча ${d.oilPerSecond.toFixed(1)} сбыт ${d.sellPerSecond.toFixed(0)} gross ${d.grossPerSecond.toFixed(0)} net ${d.netPerSecond.toFixed(0)} влиять ${d.influence} покупка ${lastBuy}`);
  }
}
