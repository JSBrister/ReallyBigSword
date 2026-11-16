import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { q4 } from '../../src/physics/mathUtil';
it('chopdbg', async () => {
  let k = 0, st = '';
  await runSession(Number(process.env.T ?? 6), (t, c, sb) => {
    if (t > 0.3 && t < 0.31) c.drop = true;
    const p = sb.player; const s = p.tech!.state;
    if (s !== st || k++ % 96 === 0) {
      st = s;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation()));
      const sd = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.sword.rotation()));
      const h = p.body.translation(), v = p.body.linvel();
      console.log(t.toFixed(2), s.padEnd(7), 'up', up.x.toFixed(2), up.y.toFixed(2), up.z.toFixed(2), 'sword', sd.x.toFixed(2), sd.y.toFixed(2), sd.z.toFixed(2), 'tipY', p.swordTip.y.toFixed(2), 'hip', h.y.toFixed(2), h.z.toFixed(2), 'v', v.z.toFixed(2), 'grip', p.gripAlong.toFixed(2), 'mode', p.swordAct.mode, 'touch', p.swordTouching, 'fallen', p.fallen, 'com-hip', (p.state.com.z - h.z).toFixed(2));
    }
  });
});
