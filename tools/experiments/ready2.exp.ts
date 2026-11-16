import { it } from 'vitest';
import * as THREE from 'three';
import { runSession } from './session';
import { ImpactDetector } from '../../src/physics/impacts';
import { GoblinManager } from '../../src/physics/goblin';
import { EXP } from '../../src/physics/player/technique';
// Sweep the "planted" stance (lean over the system COM, hand height) across READY sessions.
it('ready2', async () => {
  const L = new THREE.Vector3(0, -0.05, 0.3);
  const configs: [string, number, THREE.Vector3 | null, boolean][] = [
    ['com low step', 1, L, false], ['torso low step', 0, L, false], ['com low hold', 1, L, true], ['com chest step', 1, null, false],
  ];
  for (const [name, com, anchor, hold] of configs) {
    EXP.planted.com = com; EXP.planted.anchor = anchor; EXP.regripHold = hold;
    let line = name.padEnd(14);
    for (const [d, x] of [[4, 0], [6, 0], [5, 1.5], [3, -1]] as const) {
      let hits = 0, chops = 0, last = '', maxTilt = 0;
      const target = new THREE.Vector3(x, 0, d);
      const r = await runSession(20, (t, c, sb) => {
        const p = sb.player.body.translation();
        const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z); const dist = dir.length(); dir.normalize();
        c.charge = t > 0.3; c.move.copy(dist > 1.9 ? dir : dir.multiplyScalar(0.05));
        const st = sb.player.tech!.state; if (st === 'chop' && last !== 'chop') chops++; last = st;
        if (st === 'follow' || st === 'regrip' || st === 'raise') maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(sb.player.body.rotation() as any).y)));
      }, {}, {}, (sb) => {
        const gm = new GoblinManager(sb.pw, sb.tun); const g = gm.spawn(target, 'none', Math.PI, true);
        const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]); det.track(g.body);
        sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); for (const h of gm.applyImpacts(det.impacts)) if (h.damage > 0) hits++; } });
      });
      line += ` | ${d},${x}: chops ${chops} hits ${hits} falls ${r.falls} tilt ${maxTilt.toFixed(2)}`;
    }
    console.log(line);
  }
});
