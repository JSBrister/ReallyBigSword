import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { CARRY, CARRY_ANCHOR } from '../../src/physics/player/technique';
it('long', async () => {
  CARRY.pose = new THREE.Quaternion(); CARRY.grip = 0; CARRY_ANCHOR.set(0, 0.45, 0.4);
  for (const sp of [1.6, 2.0, 2.4]) for (const os of [1.25, 1.05]) for (const dec of [1, 4]) {
    const f = await runSession(26, (t, c) => c.move.set(0, 0, t < 20 ? 1 : 0), { carrySpeed: sp, walkDecel: dec, driveOverspeed: os });
    console.log('speed', sp, 'overspeed', os, 'decel', dec, '| falls', f.falls, 'maxV', f.maxHipSpeed.toFixed(1), 'z', f.pos.z.toFixed(1), 'tilt', f.maxTilt.toFixed(2));
  }
});
