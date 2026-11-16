import * as THREE from 'three';
import { makeSandbox } from '../../tests/helpers';
import type { Tunables } from '../../src/physics/tunables';
import type { PlayerCommand, SpawnOptions } from '../../src/physics/player/player';
import { q4 } from '../../src/physics/mathUtil';

export interface SessionResult {
  fallenTime: number; falls: number; standUps: number; maxHipSpeed: number; maxTipSpeed: number; maxTilt: number;
  maxComOffset: number; pos: THREE.Vector3; yaw: number; sb: Awaited<ReturnType<typeof makeSandbox>>;
}

/** Play `prog(t, cmd)` for T seconds in Carry/technique mode and report what happened. */
export async function runSession(T: number, prog: (t: number, cmd: PlayerCommand, sb: Awaited<ReturnType<typeof makeSandbox>>) => void,
  over: Partial<Tunables> = {}, spawn: Partial<SpawnOptions> = {}, setup?: (sb: Awaited<ReturnType<typeof makeSandbox>>) => void): Promise<SessionResult> {
  const sb = await makeSandbox({ ...over, ...JSON.parse(process.env.OVER ?? '{}') }, { carry: true, ...spawn });
  setup?.(sb);
  const r: SessionResult = { fallenTime: 0, falls: 0, standUps: 0, maxHipSpeed: 0, maxTipSpeed: 0, maxTilt: 0, maxComOffset: 0, pos: new THREE.Vector3(), yaw: 0, sb };
  let prev = sb.player.swordTip.clone(), was = false;
  const t0 = sb.pw.time;
  sb.run(T, (tw) => {
    const p = sb.player;
    prog(tw - t0, sb.cmd, sb);
    const tip = p.swordTip; r.maxTipSpeed = Math.max(r.maxTipSpeed, tip.distanceTo(prev) / sb.pw.substepDt); prev = tip.clone();
    const v = p.body.linvel(); r.maxHipSpeed = Math.max(r.maxHipSpeed, Math.hypot(v.x, v.z));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation()));
    r.maxTilt = Math.max(r.maxTilt, Math.acos(Math.min(1, up.y)));
    const h = p.body.translation();
    if (!p.fallen) r.maxComOffset = Math.max(r.maxComOffset, Math.hypot(p.state.com.x - h.x, p.state.com.z - h.z));
    if (p.fallen) r.fallenTime += sb.pw.substepDt;
    if (p.fallen && !was) r.falls++;
    was = p.fallen;
  });
  r.standUps = sb.player.stoodUp;
  r.pos.copy(sb.player.body.translation() as THREE.Vector3);
  r.yaw = sb.player.feet.frameYaw;
  return r;
}

export const fmt = (r: SessionResult) =>
  `falls ${r.falls} fallenT ${r.fallenTime.toFixed(2)} standUps ${r.standUps} maxTilt ${r.maxTilt.toFixed(2)} comOff ${r.maxComOffset.toFixed(2)} hipV ${r.maxHipSpeed.toFixed(1)} tipV ${r.maxTipSpeed.toFixed(1)} pos ${r.pos.x.toFixed(1)},${r.pos.z.toFixed(1)} yaw ${r.yaw.toFixed(2)} state ${r.sb.player.tech?.state}`;
