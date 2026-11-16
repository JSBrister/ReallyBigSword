import { it } from 'vitest';
import * as THREE from 'three';
import { runSession, fmt } from './session';
import { EXP } from '../../src/physics/player/technique';
it('empty', async () => {
  EXP.emptyWalk = true;
  for (const walk of [0]) {
    let k = 0;
    const r = await runSession(6, (t, c, sb) => {
      if (t < 0.05) sb.player.release();
      c.move.set(0, 0, walk && t > 1 && t < 4 ? 1 : 0);
      const u = new THREE.Vector3(0, 1, 0).applyQuaternion(sb.player.body.rotation() as any);
      if (process.env.V && k++ % 24 === 0 && t < 2.5) console.log(walk, t.toFixed(2), sb.player.tech!.state, 'feet', sb.player.feet.feet.map((f: any) => f.phase[0] + (f.inContact ? '+' : '-') + f.worldPos.z.toFixed(2)).join(' '), 'cap', (sb.player.gait as any).capture.z.toFixed(2), 'drv', sb.player.feet.driveVel.z.toFixed(2), 'tau', sb.player.feet.hipTorqueTarget.x.toFixed(0), 'eff', (sb.player as any).effState.mass.toFixed(0), (sb.player as any).effState.com.toArray().map((x: number) => x.toFixed(2)).join(','), 'bcom', sb.player.body.worldCom().y.toFixed(2), sb.player.body.worldCom().z.toFixed(2), 'w', sb.player.body.angvel().x.toFixed(2), 'up', u.x.toFixed(2), u.z.toFixed(2), 'hipY', sb.player.body.translation().y.toFixed(2), 'v', sb.player.body.linvel().z.toFixed(2), 'hold', sb.player.holding);
    });
    console.log('walk', walk, fmt(r));
  }
});
