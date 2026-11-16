import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { GoblinManager } from '../../src/physics/goblin';
it('approachdbg', async () => {
  const target = new THREE.Vector3(0, 0, 4); let k = 0;
  await runSession(Number(process.env.T ?? 6.5), (t, c, sb) => {
    const pl = sb.player; const p = pl.body.translation();
    const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
    c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
    const st = pl.tech!.state;
    if (t > Number(process.env.FROM ?? 4.5) && k++ % 24 === 0) {
      const u = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.body.rotation() as any); const v = pl.body.linvel(); const o = pl.tech!.out; const b = pl.balanceWorld();
      console.log(t.toFixed(2), st, 'up', u.x.toFixed(2), u.z.toFixed(2), 'hip', p.x.toFixed(2), p.z.toFixed(2), 'v', v.x.toFixed(2), v.z.toFixed(2), 'B', b.x.toFixed(2), b.y.toFixed(2), b.z.toFixed(2), 'face', o.face?.toFixed(2), 'yaw', pl.feet.frameYaw.toFixed(2), 'mv', o.moveVel.x.toFixed(2), o.moveVel.z.toFixed(2),
        'feet', pl.feet.feet.map((f: any) => f.phase[0] + (f.inContact ? '+' : '-')).join(''), 'hold', pl.holding, 'hand', pl.gripLocal.toArray().map((x) => x.toFixed(2)).join(','));
    }
  }, {}, {}, (sb) => { const gm = new GoblinManager(sb.pw, sb.tun); gm.spawn(target, 'none', Math.PI, true); sb.pw.hooks.push({ pre: (dt) => gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false), post: () => {} }); });
});
