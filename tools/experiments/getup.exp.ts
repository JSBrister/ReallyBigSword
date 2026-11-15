import { it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from '../../tests/helpers';
import { q4 } from '../../src/physics/mathUtil';
it('getup', async () => {
  const ax = process.env.AX === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const ang = Number(process.env.ANG ?? 1.5);
  const { player, run } = await makeSandbox({}, { grounded: false, position: new THREE.Vector3(0, -0.6, 0), tiltRotation: new THREE.Quaternion().setFromAxisAngle(ax, ang) });
  let k = 0;
  run(Number(process.env.T ?? 6), (t) => {
    if (k++ % Number(process.env.EVERY ?? 240) === 0 && t > Number(process.env.FROM ?? 0)) {
      const p = player.body.translation();
      const pu = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(player.body.rotation()));
      console.log(t.toFixed(2), 'pos', p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2), 'up', pu.toArray().map(v => v.toFixed(2)).join(','), 'fallen', player.fallen, 'scr', player.feet.scramble, 'tip', player.swordTip.y.toFixed(2), 'str', player.swordAct.strength.toFixed(2), 'N', player.feet.totalN.toFixed(0), 'tau', player.feet.hipTorque.x.toFixed(0), player.feet.hipTorque.z.toFixed(0), 'act%', (player.swordAct.usage*100).toFixed(0), 'sword', JSON.stringify(new THREE.Vector3(0,1,0).applyQuaternion(q4(player.sword.rotation())).toArray().map(v=>+v.toFixed(2))), player.feet.feet.map(f => f.phase[0] + f.points.map(c => c.state.slice(0, 2)).join('/')).join(' '), 'vy', player.body.linvel().y.toFixed(2));
    }
  });
});
