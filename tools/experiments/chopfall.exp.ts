import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { ImpactDetector } from '../../src/physics/impacts';
import { GoblinManager } from '../../src/physics/goblin';
// One READY chop per target: did he stay up through chop + follow, and how hard did it hit?
it('chopfall', async () => {
  let line = '';
  for (const [d, x] of [[4, 0], [6, 0], [5, 1.5], [3, -1]] as const) {
    let best = 0, fellIn = '-', last = '', done = false;
    const target = new THREE.Vector3(x, 0, d);
    await runSession(20, (t, c, sb) => {
      const pl = sb.player; const p = pl.body.translation();
      const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
      c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
      const st = pl.tech!.state;
      if (!done && pl.fallen && fellIn === '-') fellIn = last;
      if (st === 'carry' && last === 'lower') done = true;
      last = st;
    }, {}, {}, (sb) => {
      const gm = new GoblinManager(sb.pw, sb.tun); const g = gm.spawn(target, 'none', Math.PI, true);
      const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]); det.track(g.body);
      sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); for (const h of gm.applyImpacts(det.impacts)) best = Math.max(best, h.impact.normalSpeed); } });
    });
    line += ` | ${d},${x}: hit ${best.toFixed(1)} fell ${fellIn}${done ? ' DONE' : ''}`;
  }
  console.log('chopfall' + line);
});
