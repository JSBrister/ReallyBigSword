import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from './helpers';
import { systemState } from '../src/physics/player/metrics';
import { v3 } from '../src/physics/mathUtil';

/** Hard, changing swing commands (world frame, rad/s). */
function swingProgram(t: number): THREE.Vector3 {
  if (t < 0.25) return new THREE.Vector3(0, 14, 0); // hard horizontal swing
  if (t < 0.5) return new THREE.Vector3(10, 0, 4); // overhead-ish
  if (t < 0.75) return new THREE.Vector3(-6, -12, 3);
  return new THREE.Vector3(0, 0, 0); // hold
}

/** Sum of each body's own |angular momentum contribution| about the system COM — the scale of what is moving. */
function momentumScale(bodies: import('@dimforge/rapier3d-compat').RigidBody[]): number {
  const s = systemState(bodies);
  let sum = 0;
  for (const b of bodies) sum += systemState([b]).L.length() + b.mass() * v3(b.worldCom()).sub(s.com)
    .cross(v3(b.linvel()).sub(s.vcom)).length();
  return sum;
}

describe('airborne conservation', () => {
  it('total angular momentum about the system COM stays constant while swinging hard', async () => {
    const { player, run } = await makeSandbox({}, { position: new THREE.Vector3(0, 40, 0), grounded: false });
    player.swordCmdOverride = new THREE.Vector3();
    const L0 = systemState(player.bodies).L.clone();
    let maxErr = 0, maxScale = 0;
    run(1.0, (t) => {
      player.swordCmdOverride!.copy(swingProgram(t));
      const s = systemState(player.bodies);
      maxErr = Math.max(maxErr, s.L.clone().sub(L0).length());
      maxScale = Math.max(maxScale, momentumScale(player.bodies));
    });
    // sanity: the swings really happened (bodies carried lots of angular momentum)
    expect(maxScale).toBeGreaterThan(200);
    expect(player.feet.feet.every((f) => !f.inContact)).toBe(true);
    console.log(`angular momentum drift ${maxErr.toFixed(3)} kg·m²/s vs moving scale ${maxScale.toFixed(1)}`);
    expect(maxErr / maxScale).toBeLessThan(0.02);
  });

  it('system COM follows a gravity-only parabola regardless of swings', async () => {
    const { player, run } = await makeSandbox({}, { position: new THREE.Vector3(0, 40, 0), grounded: false });
    player.swordCmdOverride = new THREE.Vector3();
    const s0 = systemState(player.bodies);
    const c0 = s0.com.clone(), v0 = s0.vcom.clone();
    let maxErr = 0;
    run(1.0, (t) => {
      player.swordCmdOverride!.copy(swingProgram(t));
      const s = systemState(player.bodies);
      const expected = c0.clone().addScaledVector(v0, t).add(new THREE.Vector3(0, -0.5 * 9.81 * t * t, 0));
      maxErr = Math.max(maxErr, s.com.distanceTo(expected));
    });
    console.log(`COM deviation from parabola ${(maxErr * 1000).toFixed(2)} mm`);
    expect(maxErr).toBeLessThan(0.01);
  });
});
