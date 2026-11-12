import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from './helpers';
import { withForceAuthority } from '../src/physics/forceGuard';
import type { Player } from '../src/physics/player/player';

/**
 * Test-only external push: "the world" shoving the warrior, applied at ground height at the
 * centre of the stance so it neither tips nor twists him. Tests are allowed to be the outside world.
 */
function push(player: Player, f: THREE.Vector3, dt: number) {
  const c = player.gait.supportCenter; // centroid of the planted contact points
  withForceAuthority(() => player.pelvis.applyImpulseAtPoint(f.clone().multiplyScalar(dt), { x: c.x, y: 0.02, z: c.z }, true));
}

function frictionAudit(player: Player) {
  let worstStick = 0, worstSlip = 0;
  const transitions = new Map<string, number>();
  const prev = new Map<string, string>();
  const check = () => {
    for (const f of player.feet.feet) for (const cp of f.points) {
      if (cp.state === 'air' || cp.N <= 1) continue;
      if (cp.forceMode === 'stick') worstStick = Math.max(worstStick, cp.force.length() / (cp.muS * cp.N));
      else worstSlip = Math.max(worstSlip, cp.force.length() / (cp.muK * cp.N));
      const p = prev.get(cp.name);
      if ((p === 'stick' && cp.state === 'slip') || (p === 'slip' && cp.state === 'stick')) {
        transitions.set(cp.name, (transitions.get(cp.name) ?? 0) + 1);
      }
      prev.set(cp.name, cp.state);
    }
  };
  return { check, get worstStick() { return worstStick; }, get worstSlip() { return worstSlip; }, transitions };
}

const quiet = (player: Player) => { player.gait.steppingEnabled = false; player.gait.balanceEnabled = false; };
const W = (player: Player) => player.state.mass * 9.81;

describe('foot friction', () => {
  it('friction never exceeds mu_s·N while sticking or mu_k·N while slipping; overload slips without chatter', async () => {
    const { player, run, pw } = await makeSandbox();
    quiet(player);
    run(0.5);
    const audit = frictionAudit(player);
    const F = new THREE.Vector3(1.4 * pw.tun.muStatic * W(player), 0, 0); // well over mu_s·N
    let slipped = false;
    run(1.0, () => {
      push(player, F, pw.substepDt);
      audit.check();
      if (player.feet.feet.some((f) => f.slipping)) slipped = true;
    });
    expect(slipped).toBe(true);
    expect(audit.worstStick).toBeLessThanOrEqual(1 + 1e-6);
    expect(audit.worstSlip).toBeLessThanOrEqual(1 + 1e-6);
    // hysteresis: a sustained overload slips once and keeps slipping (no stick/slip chatter)
    for (const [name, n] of audit.transitions) expect(n, name).toBeLessThanOrEqual(2);
  });

  it('a push between mu_k·N and mu_s·N does not start a slide, but sustains one once started', async () => {
    const { player, run, pw } = await makeSandbox();
    quiet(player);
    run(0.5);
    const mid = (pw.tun.muKinetic + 0.7 * (pw.tun.muStatic - pw.tun.muKinetic)) * W(player);
    expect(mid).toBeGreaterThan(pw.tun.muKinetic * W(player));
    expect(mid).toBeLessThan(pw.tun.muStatic * W(player));
    const F = new THREE.Vector3(mid, 0, 0);

    // 1. stays put
    const x0 = player.pelvis.translation().x;
    let anySlip = false;
    const t0 = pw.time;
    run(1.0, (t) => {
      // ramp the push in so the test measures friction, not the shock of a step load
      push(player, F.clone().multiplyScalar(Math.min(1, (t - t0) / 0.4)), pw.substepDt);
      if (player.feet.feet.some((f) => f.slipping)) anySlip = true;
    });
    const moved = player.pelvis.translation().x - x0;
    console.log(`static push ${mid.toFixed(0)} N: moved ${(moved * 100).toFixed(2)} cm, slipped=${anySlip}`);
    expect(anySlip).toBe(false);
    expect(Math.abs(moved)).toBeLessThan(0.05); // springs give a few cm, no sliding

    // 2. a brief hard shove starts a slide; the same moderate push then keeps it going
    run(0.06, () => push(player, F.clone().multiplyScalar(3), pw.substepDt));
    let minSpeed = Infinity;
    const xs = player.pelvis.translation().x;
    run(1.0, (t) => {
      push(player, F, pw.substepDt);
      if (t > 1.7) minSpeed = Math.min(minSpeed, player.pelvis.linvel().x);
    });
    const slid = player.pelvis.translation().x - xs;
    console.log(`after shove: slid ${slid.toFixed(2)} m, min speed late ${minSpeed.toFixed(2)} m/s`);
    expect(slid).toBeGreaterThan(0.5);
    expect(minSpeed).toBeGreaterThan(0.3);
  });
});
