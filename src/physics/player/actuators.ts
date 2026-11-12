/**
 * INTERNAL ACTUATORS. One of exactly two modules allowed to push on player bodies.
 *
 * Every actuator here acts *between* two player bodies, so whatever it does to one body it
 * does equal-and-opposite to the other:
 *  - Sword actuator: warrior <-> sword at the grip. Implemented as Rapier spherical-joint angular
 *    velocity motors. Joint motor impulses are applied by the constraint solver to both bodies
 *    as an exact equal-and-opposite pair, and are clamped to a maximum torque. The motors are
 *    solved implicitly, which is what makes a 20 kN·m actuator stable between a 90 kg warrior
 *    and a 150 kg sword.
 *  - Reach: the grip anchor slides along the warrior's forward axis at a limited speed; the joint
 *    constraint supplies the (internal, equal-and-opposite) forces.
 *
 * The only exception is the AIR CONTROL cheat at the bottom, which is a force from nowhere on
 * purpose, off by default, and exists to demonstrate what the game refuses to do.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Tunables } from '../tunables';
import { withForceAuthority } from '../forceGuard';
import { q4, quatToRotVec, rotVecToQuat, v3, worldInertia } from '../mathUtil';

const ANG_AXES = [3, 4, 5] as const; // JointAxis.AngX/AngY/AngZ
/** Rest pose of the sword relative to the body: upright. */
const REST = new THREE.Quaternion();

interface RawJointSet {
  jointConfigureMotorModel(h: number, axis: number, model: number): void;
  jointSetMotorMaxForce(h: number, axis: number, max: number): void;
  jointConfigureMotorVelocity(h: number, axis: number, vel: number, factor: number): void;
}
// rapier3d-compat 0.21's SphericalImpulseJoint wrapper does not expose the per-axis motor
// methods its typings declare, so we talk to the raw joint set directly.
const raw = (j: RAPIER.ImpulseJoint) => (j as unknown as { rawSet: RawJointSet }).rawSet;

export function setupAngularMotors(j: RAPIER.ImpulseJoint, maxTorque: [number, number, number]): void {
  const r = raw(j);
  ANG_AXES.forEach((ax, i) => {
    r.jointConfigureMotorModel(j.handle, ax, 1 /* ForceBased: factor is N·m·s/rad */);
    r.jointSetMotorMaxForce(j.handle, ax, maxTorque[i]);
  });
}

function setMotorVelocity(j: RAPIER.ImpulseJoint, local: THREE.Vector3, factor: number): void {
  const r = raw(j);
  r.jointConfigureMotorVelocity(j.handle, 3, local.x, factor);
  r.jointConfigureMotorVelocity(j.handle, 4, local.y, factor);
  r.jointConfigureMotorVelocity(j.handle, 5, local.z, factor);
}

export interface ActuatedBodies {
  /** The body the sword is held by (the whole warrior). */
  torso: RAPIER.RigidBody;
  sword: RAPIER.RigidBody;
  gripJoint: RAPIER.ImpulseJoint;
}

const tq = new THREE.Quaternion();
const tqs = new THREE.Quaternion();
const tqi = new THREE.Quaternion();
const tqRel = new THREE.Quaternion();
const tqErr = new THREE.Quaternion();
const ta = new THREE.Vector3();
const tb = new THREE.Vector3();
const tc = new THREE.Vector3();
const tI = new THREE.Matrix3();

/**
 * Sword actuator. The player commands a target angular velocity of the sword relative to the
 * torso; with no command it holds the current relative pose. Both go through one target
 * orientation that is integrated from the command and never allowed to lead the real pose by
 * more than swordMaxLead (so a saturated actuator does not wind up).
 */
export class SwordActuator {
  /** Target orientation of the sword relative to the torso (torso frame). */
  readonly qTarget = new THREE.Quaternion();
  /** Estimated actuator torque on the sword (world), from the sword's measured dynamics. */
  readonly torque = new THREE.Vector3();
  usage = 0;
  private lastMax = -1;
  private prevSpin = new THREE.Vector3();
  private prevVcom = new THREE.Vector3();
  private havePrev = false;

  constructor(private tun: Tunables) {}

  reset(b: ActuatedBodies): void {
    q4(b.torso.rotation(), tq);
    q4(b.sword.rotation(), tqs);
    this.qTarget.copy(tq).invert().multiply(tqs);
    this.havePrev = false;
  }

  /** 0..1 strength multiplier chosen by the controller (relaxed grip while toppled). */
  strength = 1;
  /** rad/s at which an idle grip returns the sword to its rest pose (0 = just hold). */
  restRate = 0;

  apply(b: ActuatedBodies, cmdWorld: THREE.Vector3, dt: number): void {
    const tun = this.tun;
    const max = tun.swordMaxTorque * this.strength;
    if (this.lastMax !== max) {
      const m = max;
      setupAngularMotors(b.gripJoint, [m, m, m]);
      this.lastMax = max;
    }
    q4(b.torso.rotation(), tq);
    q4(b.sword.rotation(), tqs);
    tqi.copy(tq).invert();
    tqRel.copy(tqi).multiply(tqs);

    const cmdLocal = ta.copy(cmdWorld).applyQuaternion(tqi);
    if (cmdLocal.length() > tun.swordMaxRate) cmdLocal.setLength(tun.swordMaxRate);

    // integrate the target: d(qRel)/dt = 0.5 * omega_local ⊗ qRel
    const dq = rotVecToQuat(tb.copy(cmdLocal).multiplyScalar(dt), tqErr);
    this.qTarget.premultiply(dq).normalize();

    // error, with anti-windup lead clamp
    tqErr.copy(this.qTarget).multiply(tqs.copy(tqRel).invert());
    const err = quatToRotVec(tqErr, tb);
    const e = err.length();
    if (e > tun.swordMaxLead) {
      err.multiplyScalar(tun.swordMaxLead / e);
      this.qTarget.copy(rotVecToQuat(err, tqErr)).multiply(tqRel).normalize();
    }
    if (this.strength < 1) {
      // relaxed: let the sword settle where it lies instead of holding the old pose
      this.qTarget.slerp(tqRel, 1 - this.strength);
    }
    if (this.restRate > 0 && cmdWorld.lengthSq() < 1e-6) {
      // bring the sword back to its rest pose (upright in front) at a limited rate
      this.qTarget.rotateTowards(REST, this.restRate * dt);
    }
    const vTarget = tc.copy(cmdLocal).addScaledVector(err, tun.swordHoldGain);
    setMotorVelocity(b.gripJoint, vTarget, tun.swordMotorFactor);
  }

  /**
   * After a step: infer the actuator torque from the sword's own dynamics,
   *   tau = dL_spin/dt - (grip - com) x (m (a_com - g))
   * (ignores sword contacts, so it reads high during impacts). Display only.
   */
  measure(b: ActuatedBodies, gripWorld: THREE.Vector3, dt: number): void {
    const s = b.sword;
    const spin = v3(s.angvel(), ta).applyMatrix3(worldInertia(s, tI));
    const vcom = v3(s.linvel(), tb);
    if (this.havePrev) {
      const dL = tc.copy(spin).sub(this.prevSpin).divideScalar(dt);
      const acc = this.prevVcom.sub(vcom).multiplyScalar(-1 / dt); // a = (v - vprev)/dt
      acc.y += 9.81 * s.gravityScale();
      const r = v3(s.worldCom(), new THREE.Vector3()).sub(gripWorld).multiplyScalar(-1); // grip - com
      const jointMoment = new THREE.Vector3().crossVectors(r, acc.multiplyScalar(s.mass()));
      dL.sub(jointMoment);
      this.torque.lerp(dL, 0.15);
      this.usage = this.torque.length() / this.tun.swordMaxTorque;
    }
    this.prevSpin.copy(spin);
    this.prevVcom.copy(vcom);
    this.havePrev = true;
  }
}

/** Reach: slide the grip anchor along the torso forward axis at limited speed. */
export function applyReach(b: ActuatedBodies, gripLocal: THREE.Vector3): void {
  b.gripJoint.setAnchor1({ x: gripLocal.x, y: gripLocal.y, z: gripLocal.z });
}

/**
 * CHEAT (off by default): air control. A horizontal force from nowhere steering the
 * airborne warrior toward the move direction. This is exactly what the game is a joke about.
 */
export function applyAirControlCheat(bodies: RAPIER.RigidBody[], move: THREE.Vector3, dt: number): void {
  withForceAuthority(() => {
    for (const body of bodies) {
      const v = body.linvel();
      const m = body.mass();
      const imp = new THREE.Vector3(move.x * 6 - v.x, 0, move.z * 6 - v.z).multiplyScalar(m * 3 * dt);
      body.applyImpulse(imp, true);
    }
  });
}
