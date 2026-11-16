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
import { GEOM } from './geometry';

export type TechniqueState = 'carry' | 'charge' | 'set' | 'chop' | 'follow' | 'approach' | 'pickup' | 'lift' | 'raise' | 'lower' | 'spinUp' | 'spin' | 'spinDown' | 'plant' | 'recover';

/** Body frame: +Z forward, +Y up, -X is his right. */
export const CARRY_ANCHOR = new THREE.Vector3(0, 0.45, 0.4); // in front of the chest
/** Where the deadlift brings the hands (sword held at its balance point): chest height, close in. */
export const LIFT_ANCHOR = new THREE.Vector3(0, 0.45, Number(process.env.LIFT_Z ?? 0.12));
/** Where the hands hold the sword at its balance point while spinning: low, close in front of the hips. */
export const SPIN_ANCHOR = new THREE.Vector3(0, 0.05, 0.3);
/** ...and as high as head height while the blade is still steep (pommel clearance). */
export const SPIN_HIGH = new THREE.Vector3(0, 1.0, 0.2); // overhead
/** How far in front of the hips he stands from the point he picks the sword up at (m). */
const PICKUP_REACH = 0.45;
/** Experiment hook: alternative carry stance (pose, grip position, anchor). */
export const EXP = { spinHeading: process.env.SPIN_BODY !== '1', spinW0: Number(process.env.SPIN_W0 ?? 0), spinHandZ: Number(process.env.SPIN_Z ?? 0.25), spinSlide: Number(process.env.SPIN_SLIDE ?? 0.12), slideAccel: Number(process.env.SLIDE_ACC ?? 5), chopDraw: Number(process.env.CHOP_DRAW ?? 0), raiseHands: Number(process.env.RAISE_HANDS ?? 0.4), liftFree: process.env.LIFT_FREE !== '0', chopHold: process.env.CHOP_HOLD !== '0', releaseAt: Number(process.env.RELEASE_AT ?? 0.3), emptyWalk: false, releaseOnStrike: true, followHold: true, regripWalk: 1, planted: { com: 0, anchor: null as THREE.Vector3 | null } };
export const CARRY = { pose: new THREE.Quaternion() as THREE.Quaternion | null, grip: 0 as number | null };
const UPV = new THREE.Vector3(0, 1, 0);
const dirPose = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromUnitVectors(UPV, new THREE.Vector3(x, y, z).normalize());
const POSE_LEVEL_FWD = dirPose(0, 0, 1);

export interface TechniqueOutput {
  pose: THREE.Quaternion;
  /** The pose is in the heading frame (world vertical, turning with his heading), not the torso's. */
  poseInHeading: boolean;
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
  /** Balance the whole system (1) or the torso (0) over the hips; null = tunable. */
  balanceOnCom: number | null;
}


export class TechniqueController {
  state: TechniqueState = 'carry';
  /** Seconds in the current state. */
  t = 0;
  /** Heading of the current charge (rad). */
  heading = 0;
  private inRangeT = 0;
  /** Spin: commanded yaw rate of the planted legs (rad/s), its direction, and the blade's elevation target. */
  private spinW = 0;
  private slideV = 0;
  private dtLast = 1 / 480;
  private spinSign = 1;
  private spinElev = Math.PI / 2;
  private spinCross = 0;
  readonly out: TechniqueOutput = {
    pose: POSE_LEVEL_FWD.clone(), poseInHeading: false, poseRate: 2, gripAlong: 0, slideSpeed: 1.5, anchor: CARRY_ANCHOR.clone(), anchorSpeed: 1.5,
    free: false, effort: new THREE.Vector3(), support: 1, swordLoad: 1, loadAtGrip: false, moveVel: new THREE.Vector3(), face: null, twist: null, brace: 0, allowJump: true, holdGround: false, balanceOnCom: null,
  };

  constructor(private tun: Tunables, private balance: number) {
    this.out.gripAlong = balance;
  }

  private go(s: TechniqueState): void { this.state = s; this.t = 0; }

  /** Spin sword pose (body frame): lowered forward (his fore-aft balance is far better than his
   *  sideways balance) to `elev` above horizontal, then, once low, turned crosswise in front of
   *  him (`cross` 0..1), which at the balance point costs no balance at all. */
  private sidePose(elev: number, cross = this.spinCross): THREE.Quaternion {
    const side = -this.spinSign, psi = cross * Math.PI / 2;
    return new THREE.Quaternion().setFromUnitVectors(UPV,
      new THREE.Vector3(side * Math.sin(psi) * Math.cos(elev), Math.sin(elev), Math.cos(psi) * Math.cos(elev)));
  }

  /** Spin grip: hands from the chest (blade up) down to the hips (blade level), and as far up the
   *  blade toward its balance point as keeps the pommel off the floor. */
  private spinGrip(o: TechniqueOutput, p: Player, sdir: THREE.Vector3): void {
    // Hands as high as it takes for the pommel to clear the floor with the sword held at its
    // balance point (overhead while it is upright), coming down to the hips as it is laid down.
    const needH = 0.12 + (this.balance + GEOM.pommel) * Math.max(0, Math.sin(this.spinElev)); // m above the floor
    const y = THREE.MathUtils.clamp(needH - 0.95, SPIN_ANCHOR.y, SPIN_HIGH.y);
    o.anchor.set(0, y, EXP.spinHandZ); o.anchorSpeed = this.tun.anchorSpeed * 0.6;
    // the grip works up toward the balance point as fast as the hands' height lets the pommel clear
    const gripH = p.gripPoint().y - (p.feet.cop.y || 0);
    o.gripAlong = THREE.MathUtils.clamp((gripH - 0.08) / Math.max(sdir.y, 0.05) - GEOM.pommel, 0, this.balance);
    // Smoothly: 150 kg sliding through his hands, started or stopped abruptly, pitches him about
    // the hips. Ease in and out (bounded acceleration) instead.
    const d = Math.abs(o.gripAlong - p.gripAlong);
    const vWant = Math.min(this.tun.gripSlideSpeed * EXP.spinSlide, Math.sqrt(2 * EXP.slideAccel * d));
    this.slideV = THREE.MathUtils.clamp(vWant, this.slideV - EXP.slideAccel * this.dtLast, this.slideV + EXP.slideAccel * this.dtLast);
    o.slideSpeed = this.slideV;
  }

  /** Upright and not swaying: the only state he starts a heavy move from. */
  private steady(p: Player, tilt = 0.08, w = 0.3): boolean {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation())).y;
    return Math.acos(THREE.MathUtils.clamp(up, -1, 1)) < tilt && v3(p.body.angvel()).length() < w;
  }

  /** Feet planted with the blade down: lean back over everything and keep the hands low. */
  private planted(): void {
    this.out.balanceOnCom = EXP.planted.com;
    if (EXP.planted.anchor) this.out.anchor.copy(EXP.planted.anchor);
  }

  update(dt: number, cmd: PlayerCommand, p: Player): TechniqueOutput {
    const tun = this.tun, o = this.out;
    this.t += dt; this.dtLast = dt;
    const yaw = p.feet.frameYaw;
    const vel = v3(p.body.linvel());
    const speed = Math.hypot(vel.x, vel.z);
    const moveMag = Math.hypot(cmd.move.x, cmd.move.z);
    const moveYaw = moveMag > 0.1 ? Math.atan2(cmd.move.x, cmd.move.z) : null;

    // defaults: the Carry stance
    o.pose.copy(CARRY.pose ?? POSE_LEVEL_FWD); o.poseRate = 2.5; o.poseInHeading = false;
    o.gripAlong = CARRY.grip ?? this.balance; o.slideSpeed = tun.gripSlideSpeed;
    o.anchor.copy(CARRY_ANCHOR); o.anchorSpeed = tun.anchorSpeed;
    o.free = false; o.effort.set(0, 0, 0); o.support = 1; o.swordLoad = 1; o.loadAtGrip = false;
    o.moveVel.set(cmd.move.x, 0, cmd.move.z).multiplyScalar(tun.carrySpeed);
    o.face = moveYaw; o.twist = null; o.brace = 0; o.allowJump = true; o.holdGround = false; o.balanceOnCom = null;

    if (p.fallen) { this.go('recover'); }
    // empty-handed (let go of it): the only thing to do is go and pick it up again
    else if (!p.holding && this.state !== 'approach' && this.state !== 'pickup' && this.state !== 'recover' && this.state !== 'follow' && this.state !== 'chop') this.go('approach');

    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const rightAxis = new THREE.Vector3(-fwd.z, 0, fwd.x); // his right; + rotation about it tips the blade back
    const sdir = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.sword.rotation()));
    const startChop = () => { this.heading = yaw; this.go('chop'); };
    void moveMag;

    switch (this.state) {
      case 'carry':
        if (cmd.spin && this.steady(p, 0.12, 0.5)) { this.spinSign = cmd.spinDir >= 0 ? 1 : -1; this.spinW = 0; this.spinElev = Math.PI / 2; this.spinCross = 0; this.go('spinUp'); }
        else if (cmd.charge) this.go('charge');
        else if (cmd.drop) this.go('set');
        break;

      case 'charge': {
        // READY: he walks as usual with the chop armed. It goes off by itself when a target is
        // in reach and he has all but stopped (he cannot chop on the run without going over);
        // letting go of the button chops as soon as he has stopped.
        o.allowJump = false;
        const cMin = tun.chopMin * tun.swordLength, cMax = tun.chopRange * tun.swordLength;
        const inRange = p.targetAhead > cMin && p.targetAhead < cMax;
        const ideal = (cMin + cMax) / 2;
        const toT = new THREE.Vector3(Math.sin(p.targetBearing), 0, Math.cos(p.targetBearing));
        const pullingAway = moveMag > 0.3 && cmd.move.x * toT.x + cmd.move.z * toT.z < -0.3;
        if (p.targetAhead < 4.5 && !pullingAway) {
          // he squares up and closes to striking distance by himself, slowing as he gets there
          o.face = p.targetBearing;
          const v = THREE.MathUtils.clamp(0.8 * (p.targetAhead - ideal), -0.5, tun.carrySpeed);
          o.moveVel.copy(toT).multiplyScalar(Math.abs(p.targetAhead - ideal) < 0.12 ? 0 : v);
        }
        this.inRangeT = inRange ? this.inRangeT + dt : 0;
        const squared = Math.abs(Math.atan2(Math.sin(p.targetBearing - yaw), Math.cos(p.targetBearing - yaw))) < 0.08;
        if (!cmd.charge) this.go('set');
        else if (inRange && squared && speed < 0.3 && (this.steady(p, 0.12, 0.5) || this.inRangeT > 1.5)) startChop();
        break;
      }

      case 'set': {
        // plant the feet, let the sway die down, then strike
        o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        if ((speed < 0.25 && this.t > 0.15 && this.steady(p, 0.12, 0.5)) || this.t > 4) startChop();
        break;
      }

      case 'chop': {
        // let the blade fall forward and help it along; the legs keep walking into it
        // Gravity does the work (about 9 m/s at the tip from upright). He only tips it over and
        // stops carrying its weight: pushing harder would just throw him backwards.
        o.free = true; o.support = 0;
        // until it is really falling it is still his to balance
        o.swordLoad = !p.holding ? 0 : sdir.dot(fwd) < 0.3 ? 1 : 0.15; // (nothing, once he has let go)
        // push until it is clearly going over (it may start out leaning back if he is running)
        if (sdir.dot(fwd) < 0.3 && this.t < tun.chopNudgeTime) o.effort.copy(rightAxis).multiplyScalar(-tun.chopNudge);
        // and tip it like a balanced broom: draw the hands back under it, so it falls forward
        // without a torque that would turn him over backwards instead
        o.anchor.copy(CARRY_ANCHOR); o.anchor.z -= EXP.chopDraw;
        // once it is clearly going over, gravity does the rest: let go before its pull builds up
        if (EXP.releaseAt < 1 && p.holding && sdir.dot(fwd) > EXP.releaseAt) p.release();
        o.face = this.heading;
        o.moveVel.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(0);
        o.allowJump = false; o.brace = p.holding ? 1 : 0; o.holdGround = EXP.chopHold && p.holding;
        if (p.swordTip.y < 0.45 || (this.t > 0.15 && p.swordTouching) || this.t > 1.5) {
          // it has struck: let go, or the blade stopping dead would yank him over with it
          if (EXP.releaseOnStrike) p.release();
          this.go('follow');
        }
        break;
      }

      case 'follow': {
        // no more push: the blade finishes on its own momentum and comes to rest
        // whatever the blade is not resting on hangs from his hands
        o.free = true; o.support = 0; o.swordLoad = !p.holding ? 0 : p.swordTouching ? p.handShare() : 0.15; o.loadAtGrip = true;
        // (empty-handed he lets his heading go while he finds his feet: holding a heading while
        // catching a sideways drift turns it into a runaway sidestep)
        o.face = p.holding ? this.heading : null; o.moveVel.set(0, 0, 0); o.holdGround = EXP.followHold && p.holding; this.planted();
        o.allowJump = false; o.brace = p.holding ? 1 : 0;
        const rel = p.holding ? v3(p.sword.angvel()).sub(v3(p.body.angvel())).length() : v3(p.sword.angvel()).length() + v3(p.sword.linvel()).length();
        // wait until it has really come to rest on the floor and he is steady
        const down = p.swordTip.y - (p.feet.cop.y || 0) < 0.3;
        const tiltF = Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation())).y, -1, 1));
        const steady = tiltF < 0.12 && v3(p.body.angvel()).length() < 0.4;
        if ((this.t > 0.25 && rel < 0.6 && down && speed < 0.3 && steady) || this.t > 3) { p.release(); this.go('approach'); }
        break;
      }

      case 'approach': {
        // He has let go. Step up to the sword's balance point and face it: picking a 150 kg
        // beam up anywhere else means fighting its leverage.
        o.swordLoad = 0; o.anchor.copy(LIFT_ANCHOR);
        const b = p.balanceWorld();
        const hip = v3(p.body.translation());
        const to = new THREE.Vector3(b.x - hip.x, 0, b.z - hip.z);
        const dist = to.length(); to.normalize();
        o.face = speed < 0.4 ? Math.atan2(to.x, to.z) : null; // square up to it once slow
        const err = dist - PICKUP_REACH;
        o.moveVel.copy(to).multiplyScalar(Math.abs(err) < 0.08 ? 0 : THREE.MathUtils.clamp(1.2 * err, -0.4, 0.6));
        o.allowJump = false;
        const fy = Math.atan2(to.x, to.z); const facing = Math.abs(Math.atan2(Math.sin(fy - yaw), Math.cos(fy - yaw))) < 0.2;
        if (EXP.emptyWalk) { o.moveVel.set(cmd.move.x, 0, cmd.move.z).multiplyScalar(tun.carrySpeed); o.face = process.env.FACE0 ? 0 : moveYaw; break; }
        if (Math.abs(err) < 0.15 && facing && speed < 0.3 && this.t > 0.3) this.go('pickup');
        break;
      }

      case 'pickup': {
        // reach down to it (empty hands move freely), then close the grip where they are
        o.swordLoad = 0; o.holdGround = true; o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        const hand = p.swordPointInBody(this.balance);
        o.anchor.copy(hand); o.anchorSpeed = tun.anchorSpeed;
        const reach = hand.distanceTo(new THREE.Vector3(0, 0.45, 0.1));
        if (reach > 1.5 || this.t > 3) { this.go('approach'); break; } // out of reach (arms plus a crouch): step closer
        if (p.gripLocal.distanceTo(hand) < 0.03) { p.grab(hand, this.balance); this.go('lift'); }
        break;
      }

      case 'lift': {
        // deadlift: it hangs from his hands at its balance point, straight in front of the hips;
        // keep its orientation (hold mode, pose = as gripped) and bring the hands up
        // loose grip (no torque): held at its balance point it just hangs level from his hands;
        // a rigid grip on a beam lying on the floor would let the floor shove him about
        o.free = EXP.liftFree; o.support = 1;
        o.pose.copy(p.swordRelPose()); o.poseRate = 0;
        o.gripAlong = this.balance; o.anchor.copy(LIFT_ANCHOR); o.anchorSpeed = tun.anchorSpeed * 0.5;
        o.holdGround = true; o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        // then wait until he is steady before turning it upright
        const tiltL = Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation())).y, -1, 1));
        if ((p.gripLocal.distanceTo(LIFT_ANCHOR) < 0.03 && tiltL < 0.1 && v3(p.body.angvel()).length() < 0.3) || this.t > 5) this.go('raise');
        break;
      }

      case 'raise': {
        // at the balance point the sword turns upright without tipping him
        // (as the blade comes up, let it slip down through the hands just enough that the pommel
        // clears the floor; near vertical the grip position no longer matters for balance)
        const gripH = p.gripPoint().y - (p.feet.cop.y || 0);
        o.gripAlong = Math.min(this.balance, (gripH - 0.05) / Math.max(sdir.y, 0.1) - GEOM.pommel);
        o.poseRate = Math.min(tun.raiseRate, tun.raiseRate * this.t / 0.8); // ease in: the reaction lands on him
        // and lift the hands toward head height as it comes up, so it can stand upright at its
        // balance point without the pommel reaching the floor
        o.holdGround = true; o.anchor.copy(LIFT_ANCHOR); o.anchor.y += EXP.raiseHands * Math.max(0, sdir.y) ** 2; o.anchorSpeed = tun.anchorSpeed * 0.4;
        o.face = null; o.moveVel.set(0, 0, 0); o.allowJump = false; o.brace = 0.5;
        if (sdir.y > 0.985 || this.t > 4) this.go('lower');
        break;
      }

      case 'lower': {
        // upright again: let it slide down through the hands to the hilt carry
        o.slideSpeed = tun.gripSlideSpeed * 0.6;
        o.moveVel.multiplyScalar(0.5);
        o.allowJump = false;
        if ((p.gripAlong < 0.02 && this.steady(p)) || this.t > 4) this.go('carry');
        break;
      }

      case 'spinUp': {
        // brace and start the twist; the rest happens in 'spin'
        this.spinGrip(o, p, sdir);
        o.moveVel.set(0, 0, 0); o.face = null; o.allowJump = false; o.brace = 0.5;
        if (!cmd.spin) { this.go('lower'); break; }
        if (this.t > 0.2) this.go('spin');
        break;
      }

      case 'spin': {
        // The planted feet twist him round (friction limits how hard), and the blade is laid down
        // sideways only as the spin builds: lowering it multiplies the inertia the feet must turn.
        // The hands work up toward the balance point as far as the pommel's clearance of the floor
        // allows, and come down in front of the hips as the blade comes down.
        this.spinGrip(o, p, sdir);
        o.moveVel.set(0, 0, 0); o.face = null; o.allowJump = false; o.brace = 1;
        // Lower the blade only as fast as he stays balanced: watch where the whole system's centre
        // of mass is over his feet and lift it back a little if it drifts toward their edge.
        // (Held at its balance point it costs nothing; short of it, the overhang is a lever on him.)
        const drift = p.balanceDrift();
        if (drift > tun.spinComMargin) this.spinElev = Math.min(Math.PI / 2, this.spinElev + tun.spinLowerRate * dt);
        else if (drift < tun.spinComMargin * 0.6) this.spinElev = Math.max(tun.spinElevation, this.spinElev - tun.spinLowerRate * dt);
        // once it is low and held at its balance point, turn it crosswise
        const ready = this.spinElev < 0.5 && Math.abs(this.balance - p.gripAlong) < 0.1;
        this.spinCross = THREE.MathUtils.clamp(this.spinCross + (ready ? 1 : -1) * 0.6 * dt, 0, 1);
        // ...and only spin fast once it is low: a steep blade spun fast is a huge lever on him
        const low = this.spinCross; // (spin up only as it comes crosswise)
        const wTarget = EXP.spinW0 + (tun.spinRate - EXP.spinW0) * low;
        this.spinW = Math.min(wTarget, this.spinW + tun.spinAccel * dt);
        if (process.env.SPIN_NOTWIST) this.spinW = 0;
        o.twist = this.spinSign * this.spinW;
        o.holdGround = this.spinW < 0.3; // planted while the blade comes down; turning needs steps
        o.pose.copy(this.sidePose(this.spinElev)); o.poseRate = 3; o.poseInHeading = EXP.spinHeading;
        if (!cmd.spin) this.go('spinDown');
        break;
      }

      case 'spinDown': {
        // let the feet brake the spin while the blade comes back upright
        this.spinGrip(o, p, sdir);
        o.moveVel.set(0, 0, 0); o.face = null; o.allowJump = false; o.brace = 0.5;
        this.spinW = Math.max(0, this.spinW - tun.spinAccel * dt);
        o.twist = this.spinSign * this.spinW;
        this.spinCross = Math.max(0, this.spinCross - 0.6 * dt);
        if (this.spinCross === 0) this.spinElev = Math.min(Math.PI / 2, this.spinElev + tun.spinLowerRate * dt);
        o.pose.copy(this.sidePose(this.spinElev)); o.poseRate = 3; o.poseInHeading = EXP.spinHeading;
        if ((this.spinW === 0 && this.spinElev >= Math.PI / 2 - 1e-3 && Math.abs(p.body.angvel().y) < 0.3) || this.t > 5) this.go('lower');
        break;
      }

      case 'recover': {
        // on the floor or just up: relax until he is upright, then re-shoulder the sword
        o.moveVel.set(0, 0, 0); o.face = null; o.allowJump = false;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(p.body.rotation())).y;
        if (!p.fallen && up > 0.95 && this.t > 0.5) this.go(p.holding ? 'carry' : 'approach');
        break;
      }

      default:
        this.go('carry');
    }
    return o;
  }
}
