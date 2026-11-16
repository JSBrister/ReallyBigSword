import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { GoblinManager } from '../../src/physics/goblin';
it('readydbg2', async () => {
  const target = new THREE.Vector3(0, 0, 4); let k = 0;
  await runSession(7, (t, c, sb) => {
    const pl = sb.player; const p = pl.body.translation();
    const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
    c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
    if (t > 3 && t < 7 && k++ % 48 === 0) {
      const v = pl.body.linvel(); const sd = new THREE.Vector3(0,1,0).applyQuaternion(pl.sword.rotation() as any);
      const fe = pl.feet as any;
      console.log(t.toFixed(2), pl.tech!.state, 'hip', p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2), 'v', v.x.toFixed(2), v.y.toFixed(2), v.z.toFixed(2),
        'tilt', Math.acos(Math.min(1, new THREE.Vector3(0,1,0).applyQuaternion(pl.body.rotation() as any).y)).toFixed(2),
        'sdir', sd.x.toFixed(2), sd.y.toFixed(2), sd.z.toFixed(2), 'tip', pl.swordTip.x.toFixed(2), pl.swordTip.y.toFixed(2), pl.swordTip.z.toFixed(2),
        'grip', pl.gripAlong.toFixed(2), 'N', fe.totalN.toFixed(0), 'slip', fe.slipping, 'fallen', pl.fallen, 'up', (()=>{const u=new THREE.Vector3(0,1,0).applyQuaternion(pl.body.rotation() as any);return u.x.toFixed(2)+','+u.z.toFixed(2)})(), 'feet', pl.feet.feet.map((f:any)=>f.phase+(f.inContact?'+':'-')+f.worldPos.x.toFixed(2)+','+f.worldPos.z.toFixed(2)).join(' '), 'share', pl.handShare().toFixed(2), 'rest', pl.swordRestAlong.toFixed(2));
    }
  }, {}, {}, (sb) => { const gm = new GoblinManager(sb.pw, sb.tun); gm.spawn(target, 'none', Math.PI, true); sb.pw.hooks.push({ pre: (dt) => gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false), post: () => {} }); });
});
