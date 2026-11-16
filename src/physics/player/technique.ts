/**
 * TECHNIQUE CONTROLLER — the competent hero.
 *
 * The player chooses a verb (charge, spin, drop, plant) and a direction. This state machine
 * decides how a strong, sensible person would do it with a 150 kg sword and outputs TARGETS only:
 * a sword pose, where the hands are (along the sword and on the body), how fast to walk, which
 * way to face, how braced to be. It applies no forces: the sword actuator and the foot contact
 * model deliver the targets, so every limit (friction, strength, momentum) still applies.
 *
 * The main lever is where he holds the sword. At its balance point the sword puts no tipping
 * load on him and is easy to turn; toward the hilt it reaches further and whips him around.
 */
import * as THREE from 'three';
import type { Tunables } from '../tunables';
import type { Player, PlayerCommand } from './player';
import { q4, v3 } from '../mathUtil';

export type TechniqueState = 'carry' | 'charge' | 'set' | 'chop' | 'follow' | 'regrip' | 'raise' | 'lower' | 'spinUp' | 'spin' | 'release' | 'plant' | 'recover';

/** Body frame: +Z forward, +Y up, -X is his right. */
export const CARRY_ANCHOR = new THREE.Vector3(0, 0.45, 0.4); // in front of the chest
/** Experiment hook: alternative carry stance (pose, grip position, anchor). */
export const CARRY = { pose: new THREE.Quaternion() as THREE.Quaternion | null, grip: 0 as number | null };
const UPV = new THREE.Vector3(0, 1, 0);
const dirPose = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromUnitVectors(UPV, new THREE.Vector3(x, y, z).normalize());
const POSE_LEVEL_FWD = dirPose(0, 0, 1);

export interface TechniqueOutput {
  pose: THREE.Quaternion;
  poseRate: number;
  gripAlong: number;
  slideSpeed: number;
  anchor: THREE.Vector3;
  anchorSpeed: number;
  /** Free mode: explicit torque pair `effort` (world N·m) instead of holding a pose. */
  free: boolean;
  effort: THREE.Vector3;
  /** Free mode: 0..1 share of the sword's weight the arms carry. */
  support: number;
  /** 0..1 share of the sword the legs should balance (1 = carrying it, 0 = it is on the floor). */
  swordLoad: number;
  /** The load hangs from the hands (acts at the grip) rather than being held rigidly. */
  loadAtGrip: boolean;
  /** Desired ground velocity (world, m/s). */
  moveVel: THREE.Vector3;
  face: number | null;
  /** Direct yaw rate for the stance legs, or null. */
  twist: number | null;
  brace: number;
  allowJump: boolean;
  /** Feet planted, no stepping about. */
  holdGround: boolean;
}


export class TechniqueController {
  state: TechniqueState = 'carry';
  /** Seconds in the current state. */
  t = 0;
  /** Heading of the current charge (rad). */
  heading = 0;
  readonly out: TechniqueOutput = {
    pose: POSE_LEVEL_FWD.clone(), poseRate: 2, gripAlong: 0, slideSpeed: 1.5, anchor: CARRY_ANCHOR.clone(), anchorSpeed: 1.5,
    free: false, effort: new THREE.Vector3(), support: 1, swordLoad: 1, loadAtGrip: false, moveVel: new THREE.Vector3(), face: null, twist: null, brace: 0, allowJump: true, holdGround: false,
  };

  constructor(private tun: Tunables, private balance: number) {
    this.out.gripAlong = balance;
  }

  private go(s: TechniqueState): void { this.state = s; this.t = 0; }

  update(dt: number, cmd: PlayerCommand, p: Player): TechniqueOutput {
    const tun = this.tun, o = this.out;
    this.t += dt;
    const yaw = p.feet.frameYaw;
    const vel = v3(p.body.linvel());
    const speed = Math.hypot(vel.x, vel.z);
    const moveMag = Math.hypot(cmd.move.x, cmd.move.z);
    const moveYaw = moveMag > 0.1 ? Math.atan2(cmd.move.x, cmd.move.z) : null;

    // defaults: the Carry stance
    o.pose.copy(CARRY.pose ?? POSE_LEVEL_FWD); o.poseRate = 2.5;
    o.gripAlong = CARRY.grip ?? this.balance; o.slideSpeed = tun.gripSlideSpeed;
    o.anchor.copy(CARRY_ANCHOR); o.anchorSpeed = tun.anchorSpeed;
    o.free = false; o.effort.set(0, 0, 0); o.support = 1; o.swordLoad = 1; o.loadAtGrip = false;
    o.moveVel.set(cmd.move.x, 0, cmd.move.z).multiplyScalar(tun.carrySpeed);
    o.face = moveYaw; o.twist = null; o.brace = 0; o.allowJump = true; o.holdGround = false;

    if (p.fallen) { this.go('recover'); }

    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const rightAxis = new THREE.Vector3(-fwd.z, 0, fwd.x); // his right; + rotation about it tips the blade back
    const sdir = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.sword.rotation()));
    const startChop = () => { this.heading = yaw; this.go('chop'); };
    void moveMag;

    switch (this.state) {
      case 'carry':
        if (cmd.charge) this.go('charge');
        else if (cmd.drop) this.go('set');
        break;

      case 'charge': {
        // READY: he walks as usual with the chop armed. It goes off by itself when a target is
        // in reach and he has all but stopped (he cannot chop on the run without going over);
        // letting go of the button chops as soon as he has stopped.
        o.allowJump = false;
        const inRange = p.targetAhead > tun.chopMin && p.targetAhead < tun.chopRange;
        const ideal = (tun.chopMin + tun.chopRange) / 2;
        const toT = new THREE.Vector3(Math.sin(p.targetBearing), 0, Math.cos(p.targetBearing));
        const pullingAway = moveMag > 0.3 && cmd.move.x * toT.x + cmd.move.z * toT.z < -0.3;
        if (p.targetAhead < 4.5 && !pullingAway) {
          // he squares up and closes to striking distance by himself, slowing as he gets there
          o.face = p.targetBearing;
          const v = THREE.MathUtils.clamp(0.8 * (p.targetAhead - ideal), -0.5, tun.carrySpeed);
          o.moveVel.copy(toT).multiplyScalar(Math.abs(p.targetAhead - ideal) < 0.12 ? 0 : v);
        }
        const squared = Math.abs(Math.atan2(Math.sin(p.targetBearing - yaw), Math.cos(p.targetBearing - yaw))) < 0.08;
        if (!cmd.charge) this.go('set');
        else if (inRange && squared && speed < 0.3) startChop();
        break;
      }

      case 'set': {
        // plant the feet, let the sway die down, then strike
        o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        if ((speed < 0.25 && this.t > 0.15) || this.t > 4) startChop();
        break;
      }

      case 'chop': {
        // let the blade fall forward and help it along; the legs keep walking into it
        // Gravity does the work (about 9 m/s at the tip from upright). He only tips it over and
        // stops carrying its weight: pushing harder would just throw him backwards.
        o.free = true; o.support = 0;
        // until it is really falling it is still his to balance
        o.swordLoad = sdir.dot(fwd) < 0.3 ? 1 : 0.15;
        // push until it is clearly going over (it may start out leaning back if he is running)
        if (sdir.dot(fwd) < 0.3 && this.t < tun.chopNudgeTime) o.effort.copy(rightAxis).multiplyScalar(-tun.chopNudge);
        o.face = this.heading;
        o.moveVel.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(0);
        o.allowJump = false; o.brace = 1;
        if (p.swordTip.y < 0.45 || (this.t > 0.15 && p.swordTouching) || this.t > 1.5) this.go('follow');
        break;
      }

      case 'follow': {
        // no more push: the blade finishes on its own momentum and comes to rest
        o.free = true; o.support = 0; o.swordLoad = 0.15;
        o.face = this.heading; o.moveVel.set(0, 0, 0);
        o.allowJump = false; o.brace = 1;
        const rel = v3(p.sword.angvel()).sub(v3(p.body.angvel())).length();
        // wait until it has really come to rest on the floor and he is steady
        const down = p.swordTip.y - (p.feet.cop.y || 0) < 0.3;
        if ((this.t > 0.25 && rel < 0.6 && down && speed < 0.3) || this.t > 3) this.go('regrip');
        break;
      }

      case 'regrip': {
        // Grip hard where it landed (he and the planted sword make a stable tripod), then, since
        // it must never be lifted by the hilt, walk the hands up the blade to the balance point.
        // (loose arms, no torque at all: the floor holds the tip, his hands only carry the blade
        // where they hold it, and at the balance point that is the whole sword with no leverage)
        o.free = true; o.support = 0;
        o.swordLoad = 0.3 + 0.7 * Math.min(1, p.gripAlong / this.balance);
        o.gripAlong = this.t > 0.2 ? this.balance : 0;
        o.holdGround = true;
        o.slideSpeed = tun.gripSlideSpeed * 0.6;
        o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        if (Math.abs(p.gripAlong - this.balance) < 0.02 || this.t > 2.5) this.go('raise');
        break;
      }

      case 'raise': {
        // at the balance point the sword turns upright without tipping him
        // (as the blade comes up, let it slip down through the hands just enough that the pommel
        // clears the floor; near vertical the grip position no longer matters for balance)
        const gripH = p.gripPoint().y - (p.feet.cop.y || 0);
        o.gripAlong = Math.min(this.balance, (gripH - 0.15) / Math.max(sdir.y, 0.1) - 0.3);
        o.poseRate = tun.raiseRate;
        o.holdGround = true;
        o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        if (sdir.y > 0.985 || this.t > 4) this.go('lower');
        break;
      }

      case 'lower': {
        // upright again: let it slide down through the hands to the hilt carry
        o.slideSpeed = tun.gripSlideSpeed * 0.6;
        o.moveVel.multiplyScalar(0.5);
        o.allowJump = false;
        if (p.gripAlong < 0.02 || this.t > 3) this.go('carry');
        break;
      }

      case 'recover': {
        // on the floor or just up: relax until he is upright, then re-shoulder the sword
        o.moveVel.set(0, 0, 0); o.face = null; o.allowJump = false;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation())).y;
        if (!p.fallen && up > 0.95 && this.t > 0.5) this.go('carry');
        break;
      }

      default:
        this.go('carry');
    }
    return o;
  }
}
