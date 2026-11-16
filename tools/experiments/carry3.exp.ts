import { it } from 'vitest';
import * as THREE from 'three';
import { runSession, fmt } from './session';
import { CARRY, CARRY_ANCHOR } from '../../src/physics/player/technique';
it('carry3', async () => {
  const cfgs: [string, number, number, [number, number, number], number | null][] = [
    // name, pitch of blade from vertical toward forward (rad), anchor, grip
    ['level-shoulder', Math.PI / 2, 0, [-0.16, 0.62, 0], null],
    ['upright-bal', 0, 0, [0, 0.45, 0.3], null],
    ['upright-mid', 0, 0, [0, 0.45, 0.3], 0.7],
    ['upright-hilt', 0, 0, [0, 0.45, 0.4], 0],
    ['slope-shoulder', 1.0, 0, [-0.16, 0.62, 0], null],
    ['slope-back', -0.9, 0, [-0.16, 0.62, 0], 0.5],
  ];
  for (const [name, pitch, , a, grip] of cfgs) {
    CARRY.pose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    CARRY.grip = grip; CARRY_ANCHOR.set(...a);
    for (const sp of [1.6, 2.4]) {
      const f = await runSession(6, (_t, c) => c.move.set(0, 0, 1), { carrySpeed: sp });
      const c = await runSession(8, (t, c) => c.move.set(Math.sin(t * 0.8), 0, Math.cos(t * 0.8)), { carrySpeed: sp });
      const b = await runSession(6, (_t, c) => c.move.set(0, 0, -1), { carrySpeed: sp });
      console.log(name.padEnd(15), 'speed', sp, '| fwd falls', f.falls, 'z', f.pos.z.toFixed(1), '| circle falls', c.falls, '| back(turn) falls', b.falls, 'z', b.pos.z.toFixed(1), 'comOff', f.maxComOffset.toFixed(2));
    }
  }
});
