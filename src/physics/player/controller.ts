/**
 * Locomotion & balance controller. Decides *what the legs try to do*: where to step, how fast
 * the planted legs sweep (walking drive), when to jump.
 * It never applies a force. Everything it asks for is delivered through the foot contact
 * model (feet.ts) and the internal actuators (actuators.ts), so it is friction- and
 * strength-limited and frequently loses to the sword. That is the game.
 */
import * as THREE from 'three';
import type { Tunables } from '../tunables';
import type { FootSystem, Foot } from './feet';
import type { SystemState } from './metrics';
import { clampLen, convexHullXZ, signedDistToPolygon, yawOf } from '../mathUtil';
import { GEOM } from './geometry';

export interface GaitInput {
  /** World-space horizontal desired direction, |move| <= 1. */
  move: THREE.Vector3;
  jump: boolean;
  /** Heading (rad, 0 = +Z) the legs should turn the body toward, or null to leave it alone. */
  faceYaw: number | null;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class GaitController {
  /** Balance (capture-point corrective steps) enabled. Tests switch it off. */
  balanceEnabled = true;
  steppingEnabled = true;
  readonly vDrive = new THREE.Vector3();
  readonly capture = new THREE.Vector3();
  readonly supportCenter = new THREE.Vector3();
  support: { x: number; z: number }[] = [];
  airborne = true;
  jumpTimer = 0;
  jumpCooldown = 0;
  timeSinceLand = 1;
  lastStepSide: -1 | 1 = 1;
  stepCount = 0;
  lastStepReason = '';
  /** 0..1: braced for a swing (crouched, wider/staggered stance, stiffer hips). */
  brace = 0;
  /** Horizontal direction to stagger the feet along (pitch swings), or null for a wide stance. */
  braceAxis: THREE.Vector3 | null = null;

  setBrace(target: number, axis: THREE.Vector3 | null, dt: number): void {
    const want = target * this.tun.braceAmount;
    const rate = want > this.brace ? 6 : 2.5;
    this.brace += THREE.MathUtils.clamp(want - this.brace, -rate * dt, rate * dt);
    if (axis) this.braceAxis = (this.braceAxis ?? new THREE.Vector3()).copy(axis);
    else if (target > 0.1) this.braceAxis = null;
  }
  private retracting = false;

  constructor(private tun: Tunables, private feet: FootSystem) {}

  /**
   * pelvisPos: hip (body origin). pelvisQ: the legs' stance frame (heading only).
   * bodyQ/bodyW: the torso's actual orientation and angular velocity.
   */
  update(dt: number, input: GaitInput, sys: SystemState, pelvisPos: THREE.Vector3, pelvisQ: THREE.Quaternion,
    bodyQ: THREE.Quaternion, bodyW: THREE.Vector3, hipVel: THREE.Vector3): void {
    const tun = this.tun;
    const feet = this.feet;
    const stance = feet.feet.filter((f) => f.phase === 'stance' && f.inContact);
    this.airborne = stance.length === 0;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.timeSinceLand += dt;
    for (const f of feet.feet) if (f.justLanded) this.timeSinceLand = 0;

    // --- walking drive (what the planted legs sweep at) ---
    const vDes = new THREE.Vector3(input.move.x, 0, input.move.z).multiplyScalar(tun.walkSpeed);
    // The legs push the hips toward the desired velocity with a bounded acceleration: the planted
    // feet sweep back at (current hip velocity + a·dt). Friction decides how much of that push
    // actually happens; the support polygon decides whether the torso can stay upright doing it.
    if (this.airborne || feet.legsDisabled) {
      this.vDrive.set(hipVel.x, 0, hipVel.z);
    } else if (vDes.lengthSq() < 1e-4 && Math.hypot(hipVel.x, hipVel.z) < 0.15) {
      // standing: the planted feet just hold their ground (friction decides how much they can)
      this.vDrive.set(0, 0, 0);
    } else {
      // walking: push the hips toward the desired velocity with a bounded acceleration
      const acc = new THREE.Vector3(vDes.x - hipVel.x, 0, vDes.z - hipVel.z).divideScalar(0.25);
      clampLen(acc, tun.walkAccel);
      this.vDrive.set(hipVel.x, 0, hipVel.z).addScaledVector(acc, dt);
    }
    feet.driveVel.copy(this.vDrive);
    feet.hipStrengthScale = 1 + this.brace;

    // --- turning: the stance legs twist the hips toward the wanted heading (friction limited) ---
    if (input.faceYaw !== null && !this.airborne && !feet.legsDisabled) {
      let e = input.faceYaw - feet.frameYaw;
      while (e > Math.PI) e -= 2 * Math.PI;
      while (e < -Math.PI) e += 2 * Math.PI;
      feet.twistRate = THREE.MathUtils.clamp(3 * e, -tun.turnRate, tun.turnRate);
    } else feet.twistRate = 0;

    // --- support polygon, capture point, lean ---
    const pts: { x: number; z: number }[] = [];
    for (const f of stance) for (const cp of f.points) if (cp.state !== 'air') pts.push({ x: cp.anchor.x, z: cp.anchor.z });
    this.support = convexHullXZ(pts);
    // centre of pressure: load-weighted centroid of the planted contacts
    this.supportCenter.set(0, 0, 0);
    let sumN = 0;
    for (const f of stance) for (const cp of f.points) {
      if (cp.state === 'air') continue;
      const n = Math.max(cp.N, 1e-3);
      this.supportCenter.x += cp.anchor.x * n; this.supportCenter.z += cp.anchor.z * n; sumN += n;
    }
    if (sumN > 0) this.supportCenter.divideScalar(sumN);
    let groundY = 0;
    for (const f of stance) groundY = Math.max(groundY, ...f.points.map((p) => (p.groundY > -1e6 ? p.groundY : 0)));
    const h = Math.max(0.4, sys.com.y - groundY);
    const w0 = Math.sqrt(9.81 / h);
    this.capture.set(sys.com.x + sys.vcom.x / w0, groundY, sys.com.z + sys.vcom.z / w0);

    // --- balance ---
    // Hip torque keeping the torso upright on its legs. It is delivered by moving the centre of
    // pressure, so it is limited by the support polygon as well as by the hip's strength.
    if (this.balanceEnabled && !this.airborne) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQ);
      const e = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0)); // axis * sin(tilt)
      const wh = bodyW.clone(); wh.y = 0;
      // feed-forward: hold up everything above the hips (torso + sword) against gravity
      const ff = new THREE.Vector3().subVectors(sys.com, pelvisPos).cross(new THREE.Vector3(0, sys.mass * 9.81, 0));
      const tau = e.multiplyScalar(tun.hipStiffness).addScaledVector(wh, -tun.hipDamping).add(ff);
      tau.y = 0;
      const hipMax = tun.hipMaxTorque * (1 + this.brace);
      if (tau.length() > hipMax) tau.setLength(hipMax);
      feet.hipTorqueTarget.copy(tau);
    } else feet.hipTorqueTarget.set(0, 0, 0);

    // --- jump ---
    if (input.jump && !this.airborne && this.jumpCooldown <= 0 && this.jumpTimer <= 0 && !feet.legsDisabled) {
      this.jumpTimer = tun.jumpPushTime;
      this.jumpCooldown = tun.jumpPushTime + 0.35;
      for (const f of feet.feet) if (f.phase === 'swing') this.abortSwing(f, pelvisPos, pelvisQ);
    }
    if (this.jumpTimer > 0) {
      this.jumpTimer -= dt;
      feet.thrust = this.airborne ? 0 : tun.jumpForce;
      this.setExtension(0.22, 2.0, dt);
      this.retracting = true;
    } else {
      feet.thrust = 0;
      // after take-off tuck the legs a little, then return to normal length
      if (this.retracting && this.airborne) this.setExtension(-0.12, 2.5, dt);
      else { this.retracting = false; this.setExtension(-tun.braceCrouch * this.brace, 0.4, dt); }
    }

    // legs usable again after being upside down: put the feet straight under the warrior
    if (feet.regained) this.plantAt(sys, pelvisPos, pelvisQ);

    // --- swing feet ---
    const yaw = yawOf(pelvisQ);
    for (const f of feet.feet) if (f.phase === 'swing') this.progressSwing(f, dt, sys, pelvisPos, pelvisQ, yaw, vDes);

    // --- decide a new step ---
    if (!this.steppingEnabled || feet.legsDisabled || this.jumpTimer > 0) return;
    if (feet.feet.some((f) => f.phase === 'swing')) return;
    if (stance.length === 0) return; // airborne: wait for contact
    if (this.timeSinceLand < 0.03) return;

    const targets = feet.feet.map((f) => this.footTarget(f, sys, pelvisPos, yaw, vDes));
    const errs = feet.feet.map((f, i) => Math.hypot(f.worldPos.x - targets[i].x, f.worldPos.z - targets[i].z));
    const walking = vDes.length() > 0.1;
    const captureOut = signedDistToPolygon({ x: this.capture.x, z: this.capture.z }, this.support) > -0.03;
    const twist = feet.feet.map((f) => (f.phase === 'stance' ? this.twistWindup(f) : 0));
    // a foot that finished its swing but has not found ground for a while gets re-placed
    const airFoot = feet.feet.findIndex((f) => f.phase === 'air' && f.noContactTime > 0.12);

    let pick = -1;
    if (airFoot >= 0 && stance.length === 1) pick = airFoot;
    else if (stance.length === 2) {
      const need = walking || (this.balanceEnabled && captureOut) || Math.max(...errs) > 0.2 || Math.max(...twist) > 0.3;
      if (need) {
        if (walking && Math.abs(errs[0] - errs[1]) < 0.15) pick = this.lastStepSide < 0 ? 1 : 0;
        else if (Math.max(...twist) > 0.3 && Math.max(...errs) < 0.2) pick = twist[0] > twist[1] ? 0 : 1;
        else pick = errs[0] > errs[1] ? 0 : 1;
        // only lift a foot if the other one can carry the load
        if (pick >= 0 && !feet.feet[1 - pick].inContact) pick = -1;
      }
    }
    if (pick < 0) return;
    if (walking && errs[pick] < 0.06 && !captureOut) return;
    this.lastStepReason = `${airFoot >= 0 ? 'air ' : ''}${walking ? 'walk ' : ''}${captureOut ? 'capture ' : ''}` +
      `err=${errs.map((e) => e.toFixed(2)).join('/')} twist=${twist.map((e) => e.toFixed(2)).join('/')}`;
    this.startSwing(feet.feet[pick], targets[pick], yaw);
  }

  private setExtension(target: number, rate: number, dt: number): void {
    const f = this.feet;
    const d = THREE.MathUtils.clamp(target - f.legExtension, -rate * dt, rate * dt);
    f.legExtension += d;
    f.legExtensionRate = d / dt;
  }

  /** Where this foot should go now (world, ground level). */
  footTarget(f: Foot, sys: SystemState, pelvisPos: THREE.Vector3, yaw: number, vDes: THREE.Vector3): THREE.Vector3 {
    const tun = this.tun;
    const T = tun.stepDuration;
    // capture point (where the COM would come to rest over a point foot), pulled back a little
    // when walking so the body keeps rolling forward over the new foot
    const h = Math.max(0.5, sys.com.y - (f.worldPos.y || 0));
    const w0 = Math.sqrt(9.81 / h);
    const base = new THREE.Vector3(sys.com.x + sys.vcom.x / w0, 0, sys.com.z + sys.vcom.z / w0)
      .addScaledVector(new THREE.Vector3(sys.vcom.x, 0, sys.vcom.z), -tun.walkPlacementLag);
    void vDes;
    void T;
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    base.addScaledVector(right, f.side * (GEOM.stanceHalfWidth + tun.braceWiden * this.brace));
    // braced for a pitch swing: split stance along the blade (left foot forward, right back)
    if (this.braceAxis && this.brace > 0.05) base.addScaledVector(this.braceAxis, -f.side * tun.braceStagger * this.brace);
    // the target is for the middle of the sole, the controller positions the ankle
    base.addScaledVector(fwd, -(GEOM.heel + GEOM.toe) / 2);
    // keep within leg reach of the hip
    const hip = new THREE.Vector3(pelvisPos.x, 0, pelvisPos.z).addScaledVector(right, f.side * 0.1);
    const d = base.clone().sub(hip);
    clampLen(d, tun.maxStepLength);
    return hip.add(d);
  }

  /** Angle between the planted foot's current heel->toe line and its anchors' line. */
  private twistWindup(f: Foot): number {
    const [a, b] = f.points;
    if (a.state === 'air' || b.state === 'air') return 0;
    const c1 = Math.atan2(b.world.x - a.world.x, b.world.z - a.world.z);
    const c2 = Math.atan2(b.anchor.x - a.anchor.x, b.anchor.z - a.anchor.z);
    let d = c1 - c2;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  }

  private startSwing(f: Foot, target: THREE.Vector3, yaw: number): void {
    f.phase = 'swing';
    for (const p of f.points) p.state = 'air';
    f.swingFrom.copy(f.worldPos);
    f.swingTo.copy(target);
    f.swingYawFrom = f.worldYaw;
    f.swingYawTo = yaw;
    f.swingT = 0;
    const dist = Math.hypot(target.x - f.worldPos.x, target.z - f.worldPos.z);
    f.swingDur = Math.max(this.tun.stepDuration * (0.5 + 0.5 * Math.min(1, dist / 0.4)), dist / this.tun.maxFootSpeed);
    this.lastStepSide = f.side;
    this.stepCount++;
  }

  private progressSwing(f: Foot, dt: number, sys: SystemState, pelvisPos: THREE.Vector3, q: THREE.Quaternion,
    yaw: number, vDes: THREE.Vector3): void {
    f.swingT += dt;
    const s = Math.min(1, f.swingT / f.swingDur);
    if (s < 0.65) {
      // keep re-aiming early in the swing (balance reacts during the step)
      const t = this.footTarget(f, sys, pelvisPos, yaw, vDes);
      f.swingTo.lerp(t, 0.2);
      f.swingYawTo = yaw;
    }
    const k = smooth(s);
    const world = f.swingFrom.clone().lerp(f.swingTo, k);
    const lift = Math.sin(Math.PI * s) * Math.min(0.18, 0.06 + 0.25 * f.swingFrom.distanceTo(f.swingTo));
    f.worldPos.copy(world).setY(world.y + lift);
    f.lift = lift;
    let dy = f.swingYawTo - f.swingYawFrom;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    f.worldYaw = f.swingYawFrom + dy * k;
    // pelvis-local setpoint follows the swing
    const local = world.clone().sub(pelvisPos).applyQuaternion(q.clone().invert());
    f.center.set(local.x, local.z);
    let ly = f.worldYaw - yaw;
    while (ly > Math.PI) ly -= 2 * Math.PI;
    while (ly < -Math.PI) ly += 2 * Math.PI;
    f.yaw = ly;
    if (s >= 1) {
      f.phase = 'air'; // becomes 'stance' the moment the sole touches
      f.noContactTime = 0;
      f.lift = 0;
    }
  }

  private abortSwing(f: Foot, pelvisPos: THREE.Vector3, q: THREE.Quaternion): void {
    const local = f.worldPos.clone().sub(pelvisPos).applyQuaternion(q.clone().invert());
    f.center.set(local.x, local.z);
    f.phase = 'air';
  }

  /** Place feet directly (spawn): both planted at their targets. */
  plantAt(sys: SystemState, pelvisPos: THREE.Vector3, q: THREE.Quaternion): void {
    const yaw = yawOf(q);
    for (const f of this.feet.feet) {
      const t = this.footTarget(f, sys, pelvisPos, yaw, new THREE.Vector3());
      const local = t.clone().sub(pelvisPos).applyQuaternion(q.clone().invert());
      f.center.set(local.x, local.z);
      f.yaw = 0;
      f.phase = 'air';
      f.worldPos.copy(t);
      f.worldYaw = yaw;
    }
  }
}
