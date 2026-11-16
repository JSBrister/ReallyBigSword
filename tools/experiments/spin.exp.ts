import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { GoblinManager } from '../../src/physics/goblin';
// After the chop: how fast does he turn, and what are the legs asking for?
it('spin', async () => {
  const TG: [number, number][] = process.env.TG ? JSON.parse(process.env.TG) : [[4, 0], [5, 1.5]];
  for (const [d, x] of TG) {
    const target = new THREE.Vector3(x, 0, d); let k = 0, maxW = 0, maxWState = '';
    await runSession(Number(process.env.T ?? 14), (t, c, sb) => {
      const pl = sb.player; const p = pl.body.translation();
      const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
      c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
      const wy = pl.body.angvel().y; const st = pl.tech!.state;
      if (Math.abs(wy) > maxW) { maxW = Math.abs(wy); maxWState = `${st}@${t.toFixed(1)}`; }
      if (process.env.V && !pl.holding && k++ % 24 === 0) {
        const o = pl.tech!.out; const b = pl.balanceWorld();
        console.log(t.toFixed(2), st, 'wy', wy.toFixed(2), 'yaw', pl.feet.frameYaw.toFixed(2), 'face', o.face?.toFixed(2), 'twist', pl.feet.twistRate.toFixed(2), 'distB', Math.hypot(b.x - p.x, b.z - p.z).toFixed(2), 'mv', o.moveVel.x.toFixed(2), o.moveVel.z.toFixed(2), 'swW', pl.sword.angvel().y.toFixed(2));
      }
    }, {}, {}, (sb) => { const gm = new GoblinManager(sb.pw, sb.tun); gm.spawn(target, 'none', Math.PI, true); sb.pw.hooks.push({ pre: (dt) => gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false), post: () => {} }); });
    console.log('target', d, x, 'max yaw rate', maxW.toFixed(2), 'in', maxWState);
  }
});
