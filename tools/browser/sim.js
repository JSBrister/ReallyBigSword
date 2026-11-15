(async () => {
  const g = window.game;
  document.querySelector('[data-pause]').click();
  g.paused = true; g.hud.showPause(false);
  const cmd = g.cmd;
  const sim = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { fn && fn(i / 60); g.pw.advance(1 / 60); g.gameLogic(1 / 60); g.level.update(1/60); g.effects.update(1/60); } };
  const log = [];
  const st = () => ({ z: +g.player.body.translation().z.toFixed(2), x: +g.player.body.translation().x.toFixed(2), fallen: g.player.fallen, hp: g.player.health, gob: g.goblins.goblins.filter(x => g.goblinRoom.get(x) === 0).map(x => x.state + ':' + x.hp + '@' + x.position.x.toFixed(1) + ',' + x.position.z.toFixed(1)) });
  SCRIPT
  g.paused = false;
  return log;
})()
