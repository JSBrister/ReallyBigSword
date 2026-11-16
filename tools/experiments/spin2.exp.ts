import { it } from 'vitest';
import * as THREE from 'three';
import { runSession, fmt } from './session';
// Hold SPIN from the carry, then let go of the button. How fast, how low, does he stay up?
it('spin2', async () => {
  const HOLD = Number(process.env.HOLD ?? 8); let k = 0, last = '';
  const r = await runSession(Number(process.env.T ?? 15), (t, c, sb) => {
    const pl = sb.player; c.spin = t > 0.5 && t < HOLD; c.spinDir = Number(process.env.DIR ?? 1);
    const st = pl.tech!.state;
    const sd = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.sword.rotation() as any);
    const tipV = pl.sword.velocityAtPoint(pl.swordTip as any); const tv = Math.hypot(tipV.x, tipV.z);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.body.rotation() as any);
    if (st !== last || k++ % 60 === 0) console.log(t.toFixed(2), st, 'wy', pl.body.angvel().y.toFixed(2), 'swWy', pl.sword.angvel().y.toFixed(2), 'elev', Math.asin(sd.y).toFixed(2), 'tipV', tv.toFixed(1), 'tipY', pl.swordTip.y.toFixed(2), 'tilt', Math.acos(Math.min(1, u.y)).toFixed(2), 'hip', pl.body.translation().x.toFixed(2), pl.body.translation().z.toFixed(2), 'grip', pl.gripAlong.toFixed(2), 'drift', pl.balanceDrift().toFixed(2), 'tw', pl.feet.twistRate.toFixed(2), 'tau', pl.feet.hipTorqueTarget.z.toFixed(0)+'/'+pl.feet.hipTorque.z.toFixed(0), 'copx', (pl.feet.cop.x - pl.body.translation().x).toFixed(2), 'fx', pl.feet.feet.map((f: any) => (f.worldPos.x - pl.body.translation().x).toFixed(2)).join('/'), 'comx', ((pl as any).effState.com.x - pl.body.translation().x).toFixed(2), 'swcomx', (pl.sword.worldCom().x - pl.body.translation().x).toFixed(2), 'up', (()=>{const u=new THREE.Vector3(0,1,0).applyQuaternion(pl.body.rotation() as any);return u.x.toFixed(2)+','+u.z.toFixed(2)})(), 'v', pl.body.linvel().x.toFixed(2)+','+pl.body.linvel().z.toFixed(2), 'feet', pl.feet.feet.map((f: any) => f.phase[0] + f.phase[1] + (f.slipping ? '~' : '')).join(''));
    last = st;
  });
  console.log(fmt(r));
});
