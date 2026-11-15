import { it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from '../../tests/helpers';
import { q4 } from '../../src/physics/mathUtil';
it('stand3', async () => {
  const { player, run } = await makeSandbox(JSON.parse(process.env.OVER ?? '{}'));
  let k = 0;
  run(Number(process.env.T ?? 2), (t) => {
    if (k++ % Number(process.env.EVERY ?? 48) === 0) {
      const p = player.body.translation();
      const pu = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(player.body.rotation()));
      const f = player.feet;
      console.log(t.toFixed(2), 'hip', p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2), 'up', pu.x.toFixed(2), pu.z.toFixed(2), 'N', f.totalN.toFixed(0), 'cop', f.cop.x.toFixed(2), f.cop.z.toFixed(2), 'tauT', f.hipTorqueTarget.x.toFixed(0), f.hipTorqueTarget.z.toFixed(0), 'tau', f.hipTorque.x.toFixed(0), f.hipTorque.z.toFixed(0), 'com', player.state.com.z.toFixed(2), f.feet.map(ft => ft.phase[0] + ':' + ft.points.map(c => c.state.slice(0, 2)).join('/') + ' c' + ft.center.y.toFixed(2)).join(' '), 'steps', player.gait.stepCount, 'w', JSON.stringify(Object.values(player.body.angvel()).map(v=>+v.toFixed(2))), 'vh', player.body.linvel().x.toFixed(3), 'sw', JSON.stringify(Object.values(player.sword.angvel()).map(v=>+v.toFixed(2))));
    }
  });
});
