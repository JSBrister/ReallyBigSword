import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { GoblinManager } from '../../src/physics/goblin';
import { EXP } from '../../src/physics/player/technique';
it('regripdbg', async () => {
  EXP.planted.com = Number(process.env.COM ?? 0); EXP.planted.anchor = new THREE.Vector3(0, Number(process.env.AY ?? -0.05), Number(process.env.AZ ?? 0.3)); EXP.regripHold = !!process.env.HOLD;
  const target = new THREE.Vector3(0, 0, 4); let k = 0, on = false;
  console.log('start'); const rr = await runSession(7, (t, c, sb) => {
    const pl = sb.player; const p = pl.body.translation();
    const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
    c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
    const st = pl.tech!.state; if (st === 'regrip') on = true;
    if (on && k++ % 24 === 0 && !pl.fallen) { try {
      const u = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.body.rotation() as any);
      const fe = pl.feet as any, g = pl.gait as any, e = (pl as any).effState;
      console.log(t.toFixed(2), st, 'upz', u.z.toFixed(2), 'hipz', p.z.toFixed(2), 'comz', e.com.z.toFixed(2), 'capz', g.capture.z.toFixed(2),
        'feetz', fe.feet.map((f: any) => f.phase[1] + f.worldPos.z.toFixed(2)).join(' '), 'copz', fe.cop.z.toFixed(2), 'tauT', fe.hipTorqueTarget.x.toFixed(0), 'def', fe.torqueDeficit.toFixed(0),
        'grip', pl.gripAlong.toFixed(2), 'gripY', pl.gripPoint().y.toFixed(2), 'share', pl.handShare().toFixed(2), 'tip', pl.swordTip.y.toFixed(2), 'eM', e.mass.toFixed(0)); } catch (err) { console.log('ERR', String(err)); }
    }
  }, {}, {}, (sb) => { const gm = new GoblinManager(sb.pw, sb.tun); gm.spawn(target, 'none', Math.PI, true); sb.pw.hooks.push({ pre: (dt) => gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false), post: () => {} }); });
});
