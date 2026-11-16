import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { q4 } from '../../src/physics/mathUtil';
it('fwd', async () => {
  let k = 0;
  await runSession(Number(process.env.T ?? 5), (t, c, sb) => {
    c.move.set(0, 0, 1);
    if (k++ % Number(process.env.EVERY ?? 96) === 0 && t > Number(process.env.FROM ?? 0)) {
      const p = sb.player; const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation()));
      const sd = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.sword.rotation()));
      const h = p.body.translation(), v = p.body.linvel();
      console.log(t.toFixed(2), 'hip', h.y.toFixed(2), h.z.toFixed(2), 'v', v.z.toFixed(2), 'up', up.x.toFixed(2), up.z.toFixed(2), 'sword', sd.x.toFixed(2), sd.y.toFixed(2), sd.z.toFixed(2), 'com-hip z', (p.state.com.z - h.z).toFixed(2), 'drive', p.gait.vDrive.z.toFixed(2), 'tauT', p.feet.hipTorqueTarget.x.toFixed(0), 'tau', p.feet.hipTorque.x.toFixed(0), 'N', p.feet.totalN.toFixed(0), p.feet.feet.map(f => f.phase[0] + f.points.map(c => c.state.slice(0, 2)).join('/')).join(' '), 'Fz', p.feet.feet.reduce((a, f) => a + f.points.reduce((b, c) => b + c.force.z, 0), 0).toFixed(0), 'swv', p.sword.linvel().z.toFixed(2), 'wx', p.body.angvel().x.toFixed(2), 'steps', p.gait.stepCount, 'drv-v', (p.gait.vDrive.z - v.z).toFixed(4), 'pt', p.feet.feet.map(f => f.points.map(c => c.state === 'air' ? '-' : ((c.world.z - c.anchor.z) * 1000).toFixed(0) + '/' + c.vel.z.toFixed(2)).join(',')).join(' | '));
    }
  }, {}, {}, (sb) => { const t: any = sb.player.tech; const u = t.update.bind(t); t.update = (dt: number, c: any, p: any) => { const o = u(dt, c, p); o.face = null; return o; }; });
});
