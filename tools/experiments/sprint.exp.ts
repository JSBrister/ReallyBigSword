import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { CARRY, CARRY_ANCHOR } from '../../src/physics/player/technique';
it('sprint', async () => {
  CARRY.pose = new THREE.Quaternion(); CARRY.grip = 0; CARRY_ANCHOR.set(0, 0.45, 0.4);
  for (const sp of [2.4, 4]) for (const acc of [1]) {
    const f = await runSession(14, (t, c) => c.move.set(0, 0, t < 8 ? 1 : 0), { carrySpeed: sp, walkDecel: acc });
    const z = await runSession(8, (t, c) => c.move.set(Math.floor(t / 1.5) % 2 ? -0.7 : 0.7, 0, 0.7), { carrySpeed: sp, walkDecel: acc });
    console.log('speed', sp, 'decel', acc, '| fwd+stop falls', f.falls, 'maxV', f.maxHipSpeed.toFixed(1), 'z', f.pos.z.toFixed(1), 'tilt', f.maxTilt.toFixed(2), '| zigzag falls', z.falls, 'maxV', z.maxHipSpeed.toFixed(1));
  }
});
