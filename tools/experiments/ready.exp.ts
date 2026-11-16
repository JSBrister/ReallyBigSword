import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { ImpactDetector } from '../../src/physics/impacts';
import { GoblinManager } from '../../src/physics/goblin';
it('ready', async () => {
  for (const [d, x] of [[4, 0], [6, 0], [5, 1.5], [3, -1]] as const) {
    let dmg = 0, best = 0, hits = 0, cycles = 0, last = '';
    const target = new THREE.Vector3(x, 0, d);
    const r = await runSession(30, (t, c, sb) => {
      // a simple "player": hold READY and walk at the dummy
      const p = sb.player.body.translation();
      const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z);
      const dist = dir.length(); dir.normalize();
      c.charge = t > 0.3;
      c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
      const st = sb.player.tech!.state; if (st === 'chop' && last !== 'chop') cycles++; last = st;
    }, {}, {}, (sb) => {
      const gm = new GoblinManager(sb.pw, sb.tun);
      const g = gm.spawn(target, 'none', Math.PI, true);
      const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]);
      det.track(g.body);
      sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); for (const h of gm.applyImpacts(det.impacts)) { if (h.damage > 0) hits++; dmg += h.damage; best = Math.max(best, h.impact.normalSpeed); } } });
    });
    console.log('target', d, x, '| chops', cycles, 'damaging hits', hits, 'dmg', dmg, 'best', best.toFixed(1), 'falls', r.falls, 'standUps', r.standUps);
  }
});
