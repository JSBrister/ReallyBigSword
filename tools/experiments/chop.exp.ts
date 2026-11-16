import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { ImpactDetector } from '../../src/physics/impacts';
import { GoblinManager } from '../../src/physics/goblin';
async function trial(name: string, dist: number, mode: 'drop' | 'charge', T = 9) {
  let best = 0, dmg = 0, backAt = -1, released = false; const states = new Set<string>();
  const r = await runSession(T, (t, c, sb) => {
    if (mode === 'drop') { if (t > 0.3 && t < 0.31) c.drop = true; } else { if (sb.player.tech!.state === 'set') released = true; c.charge = t > 0.3 && !released; }
    const st = sb.player.tech!.state; states.add(st);
    if (t > 1 && st === 'carry' && backAt < 0) backAt = t;
  }, {}, {}, (sb) => {
    const gm = new GoblinManager(sb.pw, sb.tun);
    const g = gm.spawn(new THREE.Vector3(0, 0, dist), 'none', Math.PI, true);
    const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]);
    det.track(g.body);
    sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); for (const h of gm.applyImpacts(det.impacts)) { dmg += h.damage; best = Math.max(best, h.impact.normalSpeed); } } });
  });
  console.log(name.padEnd(14), 'impact', best.toFixed(1), 'dmg', String(dmg).padStart(3), 'falls', r.falls, 'tilt', r.maxTilt.toFixed(2), 'backToCarry', backAt.toFixed(1), 'tipV', r.maxTipSpeed.toFixed(1), 'end', r.sb.player.tech!.state, 'z', r.pos.z.toFixed(1));
}
it('chop', async () => {
  for (const d of [1.2, 1.5, 1.8, 2.1, 2.4]) await trial('drop @' + d, d, 'drop');
  for (const d of [5, 6, 7]) await trial('charge @' + d, d, 'charge', 12);
});
