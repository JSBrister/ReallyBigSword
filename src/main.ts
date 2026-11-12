import { initRapier } from './physics/rapier';
import { Game } from './game/game';

initRapier().then((R) => {
  const game = new Game(R, document.body);
  (window as unknown as { game: Game }).game = game;
});
