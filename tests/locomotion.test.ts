import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from './helpers';
import { q4 } from '../src/physics/mathUtil';

const tilt = (q: { x: number; y: number; z: number; w: number }) =>
  Math.acos(Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(q4(q)).y));

describe('balance, toppling and spinning', () => {
  it('holding the sword upright with no input does not topple', async () => {
    const { player, run } = await makeSandbox();
    let maxTilt = 0;
    run(5, () => { maxTilt = Math.max(maxTilt, tilt(player.body.rotation())); });
    expect(player.fallen).toBe(false);
    expect(maxTilt).toBeLessThan(0.1);
  });

  it('holding the sword horizontally out front with no corrective input topples the warrior', async () => {
    const { player, run } = await makeSandbox({}, { swordDir: new THREE.Vector3(0, 0, 1) });
    player.autoStandUp = false;
    let fell = false;
    run(3, () => { if (player.fallen) fell = true; });
    expect(fell).toBe(true);
  });

  it('a sustained hard horizontal swing on stone slips the feet and spins the body the other way', async () => {
    const { player, run, cmd, pw } = await makeSandbox({}, { swordDir: new THREE.Vector3(0, 0, 1) });
    let slipTime = 0, bodyYawRate = 0, swordYawRate = 0, n = 0;
    cmd.effort.set(-1, 0); // full effort counter-clockwise seen from above (left)
    run(0.8, (t) => {
      if (player.feet.feet.some((f) => f.slipping)) slipTime += pw.substepDt;
      if (t > 0.1 && t < 0.5) { bodyYawRate += player.body.angvel().y; swordYawRate += player.sword.angvel().y; n++; }
    });
    bodyYawRate /= n; swordYawRate /= n;
    console.log(`slip ${slipTime.toFixed(2)} s, body yaw rate ${bodyYawRate.toFixed(2)}, sword yaw rate ${swordYawRate.toFixed(2)} rad/s`);
    expect(slipTime).toBeGreaterThan(0.05);
    expect(bodyYawRate).toBeLessThan(-1); // body spins clockwise, opposite the swing
    // the swing itself happened (relative rotation); in the world the warrior mostly orbits the
    // heavier sword, so the sword's own yaw rate is small
    expect(swordYawRate - bodyYawRate).toBeGreaterThan(1);
  });
});

describe('walking and jumping', () => {
  it('walks forward under friction-limited leg drive without falling', async () => {
    const { player, run, cmd } = await makeSandbox();
    cmd.move.set(0, 0, 1);
    run(3);
    const p = player.body.translation();
    console.log(`walked to z=${p.z.toFixed(2)} in 3 s, steps=${player.gait.stepCount}`);
    expect(player.fallen).toBe(false);
    expect(p.z).toBeGreaterThan(2.5);
  });

  it('jumps only from the ground, and high', async () => {
    const { player, run, cmd } = await makeSandbox();
    run(0.5);
    const y0 = player.body.translation().y;
    cmd.jump = true;
    let maxY = y0;
    run(1.5, () => { maxY = Math.max(maxY, player.body.translation().y); });
    console.log(`jump height ${(maxY - y0).toFixed(2)} m`);
    expect(maxY - y0).toBeGreaterThan(0.4);
    // mid-air jump request does nothing
    const air = await makeSandbox({}, { position: new THREE.Vector3(0, 20, 0), grounded: false });
    air.run(0.2);
    const vy0 = air.player.body.linvel().y;
    air.cmd.jump = true;
    air.run(0.2);
    expect(air.player.body.linvel().y).toBeLessThan(vy0); // still just falling
  });
});
