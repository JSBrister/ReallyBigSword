import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { ImpactDetector } from '../../src/physics/impacts';
import { GoblinManager } from '../../src/physics/goblin';
export async function chopTrial(dist: number, mode: 'drop' | 'charge', over: object, T = 9) {
  let best = 0, dmg = 0, backAt = -1;
  const r = await runSession(T, (t, c, sb) => {
    if (mode === 'drop') { if (t > 0.3 && t < 0.31) c.drop = true; } else c.charge = t > 0.3;
    if (t > 1 && sb.player.tech!.state === 'carry' && backAt < 0) backAt = t;
  }, over, {}, (sb) => {
    const gm = new GoblinManager(sb.pw, sb.tun);
    const g = gm.spawn(new THREE.Vector3(0, 0, dist), 'none', Math.PI, true);
    const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]);
    det.track(g.body);
    sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); for (const h of gm.applyImpacts(det.impacts)) { dmg += h.damage; best = Math.max(best, h.impact.normalSpeed); } } });
  });
  return { best, dmg, falls: r.falls, backAt, tipV: r.maxTipSpeed };
}
it('chop2', async () => {
  for (const [n, tt] of [[600, 0.25], [1200, 0.4], [1200, 0.8], [2000, 0.5], [2000, 1.0]] as const) {
    const out: string[] = [];
    for (const d of [1.5, 1.8, 2.1, 2.4]) { const r = await chopTrial(d, 'drop', { chopNudge: n, chopNudgeTime: tt }); out.push(`@${d}: ${r.best.toFixed(1)}m/s dmg${r.dmg} f${r.falls}`); }
    console.log('nudge', n, 'time', tt, '|', out.join(' | '));
  }
});
