import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { GoblinManager } from '../../src/physics/goblin';
it('readydbg', async () => {
  const target = new THREE.Vector3(0, 0, 4); let k = 0, last = '';
  await runSession(16, (t, c, sb) => {
    const p = sb.player.body.translation();
    const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
    c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
    const stt = sb.player.tech!.state; const ch = stt !== last; last = stt;
    if (ch || k++ % 480 === 0) { const v = sb.player.body.linvel(); console.log(t.toFixed(1), sb.player.tech!.state, 'dist', dist.toFixed(2), 'ahead', sb.player.targetAhead.toFixed(2), 'bearing', sb.player.targetBearing.toFixed(2), 'yaw', sb.player.feet.frameYaw.toFixed(2), 'speed', Math.hypot(v.x, v.z).toFixed(2), 'z', p.z.toFixed(2), 'tilt', Math.acos(Math.min(1, new THREE.Vector3(0,1,0).applyQuaternion(sb.player.body.rotation() as any).y)).toFixed(2), 'tipY', sb.player.swordTip.y.toFixed(2), 'touch', sb.player.swordTouching); }
  }, {}, {}, (sb) => { const gm = new GoblinManager(sb.pw, sb.tun); gm.spawn(target, 'none', Math.PI, true); sb.pw.hooks.push({ pre: (dt) => gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false), post: () => {} }); });
});
