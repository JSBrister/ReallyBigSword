import { it } from 'vitest';
import * as THREE from 'three';
import { runSession, fmt } from './session';
import { EXP } from '../../src/physics/player/technique';
it('empty2', async () => {
  EXP.emptyWalk = true; let k = 0;
  const r = await runSession(Number(process.env.T ?? 1.2), (t, c, sb) => {
    const pl = sb.player; if (t < 0.01) pl.release();
    c.move.set(0, 0, t > 0.5 && t < Number(process.env.WEND ?? 0) ? 1 : 0);
    if (k++ % 8 === 0) {
      const u = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.body.rotation() as any); const fe = pl.feet as any; const h = pl.body.translation();
      console.log(t.toFixed(3), pl.tech!.state, 'pos', h.x.toFixed(2), h.z.toFixed(2), 'yaw', pl.feet.frameYaw.toFixed(2), 'mvz', pl.tech!.out.moveVel.z.toFixed(2), 'face', pl.tech!.out.face, 'up', u.x.toFixed(3), u.z.toFixed(3), 'w', pl.body.angvel().x.toFixed(2), 'tauT', fe.hipTorqueTarget.x.toFixed(0), 'tauD', fe.hipTorque.x.toFixed(0),
        'cop-hip', (fe.cop.z - h.z).toFixed(3), 'N', fe.totalN.toFixed(0), 'drv', fe.driveVel.z.toFixed(2), 'v', pl.body.linvel().z.toFixed(2), 'feet', fe.feet.map((f: any) => f.phase[0] + (f.inContact ? '+' : '-') + (f.worldPos.z - h.z).toFixed(2)).join(' '), 'defic', fe.torqueDeficit.toFixed(0), 'Ft', fe.lastFt.z.toFixed(0));
    }
  });
  console.log(fmt(r));
});
