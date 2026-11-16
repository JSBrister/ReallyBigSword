import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { GoblinManager } from '../../src/physics/goblin';
import { EXP } from '../../src/physics/player/technique';
it('readytl', async () => {
  EXP.planted.com = Number(process.env.COM ?? 1); EXP.planted.anchor = process.env.LOW ? new THREE.Vector3(0, 0.1, 0.35) : null;
  const TG: [number, number][] = process.env.TG ? JSON.parse(process.env.TG) : [[4, 0], [6, 0]];
  for (const [d, x] of TG) {
    const target = new THREE.Vector3(x, 0, d); let last = '', wasF = false; const ev: string[] = [];
    await runSession(20, (t, c, sb) => {
      const pl = sb.player; const p = pl.body.translation();
      const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
      c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
      const st = pl.tech!.state; const u = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.body.rotation() as any);
      const tag = `d${pl.targetAhead.toFixed(2)} v${Math.hypot(pl.body.linvel().x, pl.body.linvel().z).toFixed(2)} ft${pl.fallenTime.toFixed(1)} ${u.x.toFixed(2)},${u.z.toFixed(2)} tip${pl.swordTip.y.toFixed(1)} share${pl.handShare().toFixed(2)} grip${pl.gripAlong.toFixed(2)}`;
      if (st !== last) ev.push(`${t.toFixed(1)} ${st} ${tag}`); last = st;
      if (pl.fallen !== wasF) ev.push(`${t.toFixed(1)} ${pl.fallen ? 'FALL' : 'up'} in ${st} ${tag}`); wasF = pl.fallen;
    }, {}, {}, (sb) => { const gm = new GoblinManager(sb.pw, sb.tun); gm.spawn(target, 'none', Math.PI, true); sb.pw.hooks.push({ pre: (dt) => gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false), post: () => {} }); });
    console.log(`target ${d},${x}\n  ` + ev.filter((e) => !e.includes(' up in')).slice(0, 14).join('\n  '));
  }
});
