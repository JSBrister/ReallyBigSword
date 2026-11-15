import { it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from '../../tests/helpers';
import { ImpactDetector } from '../../src/physics/impacts';
import { GoblinManager } from '../../src/physics/goblin';
import type { PlayerCommand } from '../../src/physics/player/player';
async function trial(name: string, gpos: THREE.Vector3 | null, prog: (t: number, c: PlayerCommand, p: any) => void, T = 3, over = {}, swordDir?: THREE.Vector3) {
  const sb = await makeSandbox({ ...over, ...JSON.parse(process.env.OVER ?? '{}') }, { swordDir });
  sb.player.autoStandUp = false;
  let best = 0, dmg = 0, maxTip = 0, prev = new THREE.Vector3(), fellAt = -1;
  if (gpos) {
    const gm = new GoblinManager(sb.pw, sb.tun);
    const g = gm.spawn(gpos, 'none', Math.PI, true);
    const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]);
    det.track(g.body);
    sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); for (const h of gm.applyImpacts(det.impacts)) { dmg += h.damage; best = Math.max(best, h.impact.normalSpeed); } } });
  }
  sb.run(0.3);
  prev = sb.player.swordTip.clone();
  const t0 = sb.pw.time;
  sb.run(T, (tw) => {
    const t = tw - t0;
    prog(t, sb.cmd, sb.player);
    const tip = sb.player.swordTip; maxTip = Math.max(maxTip, tip.distanceTo(prev) / sb.pw.substepDt); prev = tip.clone();
    if (sb.player.fallen && fellAt < 0) fellAt = tw - t0;
  });
  console.log(name.padEnd(22), 'maxTip', maxTip.toFixed(1), 'impact', best.toFixed(1), 'dmg', dmg, 'fellAt', fellAt.toFixed(2), 'brace', sb.player.gait.brace.toFixed(2));
}
it('moves', async () => {
  const front = new THREE.Vector3(0, 0, 1.4);
  await trial('effort down', front, (t, c, p) => c.effort.set(0, p.swordTip.y > 0.45 && t < 1.5 ? -1 : 0), 2.5);
  await trial('effort down 0.5', front, (t, c, p) => c.effort.set(0, p.swordTip.y > 0.45 && t < 1.5 ? -0.5 : 0), 2.5);
  await trial('named slam', front, (t, c) => { if (t < 0.003) c.attack = 'slam'; }, 3);
  await trial('named slam far', new THREE.Vector3(0, 0, 1.8), (t, c) => { if (t < 0.003) c.attack = "slam"; }, 3);
  await trial('sweep right', new THREE.Vector3(-1.3, 0, 1.0), (t, c) => { if (t < 0.003) c.attack = "sweepRight"; }, 3);
  await trial('spin 4s', new THREE.Vector3(-2.5, 0, 0), (t, c) => { if (t < 0.003) c.attack = 'spin'; c.spinHeld = t < 4; }, 5);
  await trial('effort right 4s', null, (t, c) => c.effort.set(t < 4 ? 1 : 0, 0), 5, {}, new THREE.Vector3(0, 0.1, 1));
});
