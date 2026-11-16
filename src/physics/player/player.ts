/**
 * The warrior: two rigid bodies (warrior body, sword) joined at the grip by a ball joint.
 * This file builds them and runs the per-substep pipeline. It never applies a force itself:
 * forces come only from actuators.ts (internal pairs) and feet.ts (ground contact).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world';
import { GROUP, groups } from '../world';
import type { Tunables } from '../tunables';
import { guardPlayerBody, withTeleportAuthority } from '../forceGuard';
import { q4, v3, UP } from '../mathUtil';
import { GEOM } from './geometry';
import { FootSystem } from './feet';
import { GaitController } from './controller';
import { SwordActuator, applyReach, applyGripSlide, applyAirControlCheat, type ActuatedBodies } from './actuators';
import { TechniqueController, CARRY_ANCHOR, CARRY } from './technique';
import { systemState, type SystemState } from './metrics';
import { MoveController, type AttackName } from './moves';

export interface PlayerCommand {
  /** World-space horizontal move direction, |move| <= 1. */
  move: THREE.Vector3;
  /** Swing effort: x + = swing right (clockwise seen from above), y + = tip up. |effort| <= 1. */
  effort: THREE.Vector2;
  /** Hold the sword where it is (otherwise it follows through on its own momentum). */
  grip: boolean;
  /** Named attack requested this frame (edge). */
  attack: AttackName | null;
  /** Spin attack continues while held. */
  spinHeld: boolean;
  /** Grip reach rate, m/s (+ = push sword away from body). */
  reach: number;
  jump: boolean;
  /** Heading for the legs to turn toward (rad), or null. */
  face: number | null;
  // --- technique mode (competent hero) ---
  charge: boolean;
  spin: boolean;
  /** Which way to spin: +1 turns him to his left (counterclockwise from above), -1 to his right. */
  spinDir: number;
  /** Edge: overhead drop. */
  drop: boolean;
  plant: boolean;
  /** -1 pull in, +1 let out (during a spin). */
  reachDir: number;
}

export const emptyCommand = (): PlayerCommand => ({
  move: new THREE.Vector3(), effort: new THREE.Vector2(), grip: false, attack: null, spinHeld: false,
  reach: 0, jump: false, face: null, charge: false, spin: false, spinDir: 1, drop: false, plant: false, reachDir: 0,
});

export interface SpawnOptions {
  /** Ground point under the warrior. */
  position: THREE.Vector3;
  heading?: number;
  /** Initial sword direction in torso frame (default: upright). */
  swordDir?: THREE.Vector3;
  /** Spawn with feet planted on the ground below (default true). */
  grounded?: boolean;
  /** Extra rotation of the whole warrior + sword about the spawn point (tests: start lying down). */
  tiltRotation?: THREE.Quaternion;
  /** Spawn in the Carry stance with the technique controller in charge (the real game). */
  carry?: boolean;
}

export class Player implements ActuatedBodies {
  /** Legs + torso + head: one rigid body. */
  body!: RAPIER.RigidBody;
  sword!: RAPIER.RigidBody;
  gripJoint!: RAPIER.ImpulseJoint;
  swordBlade!: RAPIER.Collider;
  feet!: FootSystem;
  gait!: GaitController;
  readonly swordAct: SwordActuator;
  readonly moves = new MoveController();
  /** Technique controller (competent hero). Null = manual sword mode (tests, debug). */
  tech: TechniqueController | null = null;
  /** Where the hand is along the sword, metres from the hilt. */
  gripAlong = 0;
  /** Sword centre of mass along the blade from the hilt (the balance point). */
  balancePoint = 1.34;
  /** Distance from the hips to an enemy straight ahead (Infinity if none within 6 m). */
  targetAhead = Infinity;
  /** World heading toward that enemy. */
  targetBearing = 0;
  /** Balance governor multiplier on swing effort (1 when the governor is off). */
  governorScale = 1;
  /** Balance-reflex multiplier on swing effort. */
  reflexScale = 1;
  /** The sword has come to rest after a swing and is being carried (hold mode). */
  settled = true;
  private slowTime = 0;
  readonly state: SystemState = { mass: 0, com: new THREE.Vector3(), vcom: new THREE.Vector3(), P: new THREE.Vector3(), L: new THREE.Vector3() };
  private readonly effState: SystemState = { mass: 0, com: new THREE.Vector3(), vcom: new THREE.Vector3(), P: new THREE.Vector3(), L: new THREE.Vector3() };
  reach = 0;
  readonly gripLocal = new THREE.Vector3();
  readonly gripWorld = new THREE.Vector3();
  readonly swingCmd = new THREE.Vector3();
  /** Seconds the warrior has been toppled (legs out of reach of the ground). */
  fallenTime = 0;
  private uprightTime = 0;
  /** Seconds since he was last on the floor (the grip returns the sword to rest meanwhile). */
  private sinceUp = 99;
  /** Set by tests to bypass input mapping and command the sword in world frame directly. */
  swordCmdOverride: THREE.Vector3 | null = null;
  /** Use the explicit stand-up rule (tests that study toppling switch it off). */
  autoStandUp = true;
  /** How many times the stand-up rule has fired (HUD message). */
  stoodUp = 0;
  health = 100;
  readonly maxHealth = 100;
  private pendingJump = false;

  constructor(private pw: PhysicsWorld, private tun: Tunables, spawn: SpawnOptions) {
    this.swordAct = new SwordActuator(tun);
    this.build(spawn);
  }

  get bodies(): RAPIER.RigidBody[] { return [this.body, this.sword]; }
  /** Aliases: the body is both the thing the legs hang from and the thing the grip is on. */
  get pelvis(): RAPIER.RigidBody { return this.body; }
  get torso(): RAPIER.RigidBody { return this.body; }
  get swordLength(): number { return this.tun.swordLength; }
  get swordTip(): THREE.Vector3 {
    return new THREE.Vector3(0, this.tun.swordLength - GEOM.pommel, 0)
      .applyQuaternion(q4(this.sword.rotation())).add(v3(this.sword.translation()));
  }
  /** Toppled: torso tilted more than 60° (the legs may still be pushing to get him back up). */
  get fallen(): boolean {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(q4(this.body.rotation())).y < 0.5 || this.feet.legsDisabled;
  }

  private build(spawn: SpawnOptions): void {
    const R = this.pw.R, world = this.pw.world, tun = this.tun;
    const heading = spawn.heading ?? 0;
    const qh = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    if (spawn.tiltRotation) qh.premultiply(spawn.tiltRotation);
    const ground = spawn.position;
    const bodyPos = new THREE.Vector3(ground.x, ground.y + tun.legLength + 0.01, ground.z);
    const playerGroups = groups(GROUP.PLAYER, GROUP.GROUND | GROUP.ENEMY | GROUP.SHIELD | GROUP.DEBRIS | GROUP.DOOR);
    const swordGroups = groups(GROUP.SWORD, GROUP.GROUND | GROUP.ENEMY | GROUP.SHIELD | GROUP.DEBRIS | GROUP.DOOR);

    // --- warrior body (legs + torso + arms + head as one rigid body; see README "deviations") ---
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(bodyPos.x, bodyPos.y, bodyPos.z).setRotation(qh).setCanSleep(false));
    // legs collider stops at the knees: below that the foot contact model owns the ground
    world.createCollider(R.ColliderDesc.capsule(0.16, 0.17).setTranslation(0, -0.2, 0).setDensity(0)
      .setFriction(0).setCollisionGroups(playerGroups), this.body);
    world.createCollider(R.ColliderDesc.capsule(0.17, 0.22).setTranslation(0, 0.38, 0).setDensity(0)
      .setFriction(0.5).setCollisionGroups(playerGroups), this.body);
    world.createCollider(R.ColliderDesc.ball(0.16).setTranslation(0, 0.88, 0).setDensity(0)
      .setFriction(0.5).setCollisionGroups(playerGroups), this.body);
    const m = tun.warriorMass;
    // a 1.9 m person with outsized pauldrons: tall (pitch/roll) but slim about the vertical
    this.body.setAdditionalMassProperties(m, { x: 0, y: 0.1, z: 0 }, { x: m * 0.26, y: m * 0.045, z: m * 0.26 },
      { x: 0, y: 0, z: 0, w: 1 }, true);
    const torsoPos = bodyPos;

    // --- sword ---
    const L = tun.swordLength;
    const bladeLen = L - GEOM.pommel - GEOM.bladeStart;
    const bladeMid = GEOM.bladeStart + bladeLen / 2;
    const ms = tun.swordMass, fb = GEOM.bladeMassFraction;
    const mb = ms * fb, mh = ms * (1 - fb);
    const yh = 0.0;
    const com = (mb * bladeMid + mh * yh) / ms;
    this.balancePoint = com;
    this.reach = 0;
    this.tech = spawn.carry ? new TechniqueController(tun, com) : null;
    this.gripAlong = spawn.carry ? (CARRY.grip ?? com) : 0;
    this.gripLocal.copy(spawn.carry ? CARRY_ANCHOR : GEOM.grip);
    const gripWorld = this.gripLocal.clone().applyQuaternion(qh).add(torsoPos);
    const dirLocal = (spawn.swordDir ?? (spawn.carry ? new THREE.Vector3(0, 1, 0).applyQuaternion(CARRY.pose ?? new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0, 0, 1))) : new THREE.Vector3(0, 1, 0))).clone().normalize();
    const qs = qh.clone().multiply(new THREE.Quaternion().setFromUnitVectors(UP, dirLocal));
    const swordOrigin = gripWorld.clone().sub(new THREE.Vector3(0, this.gripAlong, 0).applyQuaternion(qs));
    this.sword = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(swordOrigin.x, swordOrigin.y, swordOrigin.z).setRotation(qs)
      .setCcdEnabled(true).setCanSleep(false));
    this.swordBlade = world.createCollider(R.ColliderDesc.cuboid(GEOM.bladeWidth / 2, bladeLen / 2, GEOM.bladeThickness / 2)
      .setTranslation(0, bladeMid, 0).setDensity(0).setFriction(0.5).setRestitution(0.15)
      .setCollisionGroups(swordGroups)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.DYNAMIC_KINEMATIC), this.sword);
    world.createCollider(R.ColliderDesc.cuboid(0.36, 0.05, 0.07).setTranslation(0, GEOM.bladeStart - 0.05, 0)
      .setDensity(0).setFriction(0.5).setCollisionGroups(swordGroups), this.sword);
    world.createCollider(R.ColliderDesc.capsule((GEOM.pommel + GEOM.bladeStart) / 2 - 0.05, 0.05)
      .setTranslation(0, (GEOM.bladeStart - GEOM.pommel) / 2 - 0.05, 0).setDensity(0).setFriction(0.5)
      .setCollisionGroups(swordGroups), this.sword);
    const Ixx = mb * (bladeLen * bladeLen + GEOM.bladeThickness ** 2) / 12 + mb * (bladeMid - com) ** 2
      + mh * (0.55 ** 2) / 12 + mh * (yh - com) ** 2;
    const Iyy = mb * (GEOM.bladeWidth ** 2 + GEOM.bladeThickness ** 2) / 12 + mh * 0.01;
    const Izz = mb * (bladeLen * bladeLen + GEOM.bladeWidth ** 2) / 12 + mb * (bladeMid - com) ** 2
      + mh * (0.55 ** 2) / 12 + mh * (yh - com) ** 2;
    this.sword.setAdditionalMassProperties(ms, { x: 0, y: com, z: 0 }, { x: Ixx, y: Iyy, z: Izz }, { x: 0, y: 0, z: 0, w: 1 }, true);

    this.gripJoint = world.createImpulseJoint(
      R.JointData.spherical({ x: this.gripLocal.x, y: this.gripLocal.y, z: this.gripLocal.z }, { x: 0, y: this.gripAlong, z: 0 }),
      this.torso, this.sword, true);
    this.gripJoint.setContactsEnabled(false);

    for (const [b, n] of [[this.body, 'body'], [this.sword, 'sword']] as const) {
      b.recomputeMassPropertiesFromColliders(); // make mass()/worldCom() valid before the first step
      guardPlayerBody(b, n);
    }

    this.feet = new FootSystem(this.pw, tun, this.body);
    this.gait = new GaitController(tun, this.feet);
    this.swordAct.reset(this);
    systemState(this.bodies, this.state);
    if (spawn.grounded !== false) this.gait.plantAt(this.state, bodyPos, qh);
  }

  /** World position of the hand on the sword. */
  gripPoint(): THREE.Vector3 {
    return new THREE.Vector3(0, this.gripAlong, 0).applyQuaternion(q4(this.sword.rotation())).add(v3(this.sword.translation()));
  }

  /** Remove all bodies and rebuild at a new spawn (also picks up changed mass/length tunables). */
  /** Put him back on his feet at his current spot (keeps health). */
  standUpInPlace(): void {
    const p = v3(this.body.translation());
    const ground = this.feet.probe(p, 0.5, 4).y;
    const hp = this.health;
    this.respawn({ position: new THREE.Vector3(p.x, ground > -1e6 ? ground : 0, p.z), heading: this.feet.frameYaw, carry: !!this.tech });
    this.health = hp;
    this.stoodUp++;
  }

  /** Is he holding the sword at all? (False after letting go of it; the joint is removed.) */
  holding = true;

  /** Let go of the sword: the grip joint is removed. No force is involved. */
  release(): void {
    if (!this.holding) return;
    this.pw.world.removeImpulseJoint(this.gripJoint, true);
    this.holding = false;
  }

  /**
   * Take hold of the sword where his hands are: `hand` in the body frame, `along` the point on
   * the sword axis (local y). The joint is created at the pose the two bodies already have, so
   * gripping applies no impulse beyond matching the (small) relative velocity at the hands,
   * which is internal and equal and opposite.
   */
  grab(hand: THREE.Vector3, along: number): void {
    if (this.holding) return;
    this.gripLocal.copy(hand);
    this.gripAlong = along;
    this.gripJoint = this.pw.world.createImpulseJoint(
      this.pw.R.JointData.spherical({ x: hand.x, y: hand.y, z: hand.z }, { x: 0, y: along, z: 0 }), this.torso, this.sword, true);
    this.gripJoint.setContactsEnabled(false);
    this.holding = true;
    this.swordAct.newJoint(this);
  }

  /** How far (m, horizontally) the balanced system's centre of mass is from the middle of his
   *  feet's support: 0 is centred. */
  balanceDrift(): number {
    const c = this.gait.supportCenter, e = this.effState.com;
    if (!this.gait.support.length) return 0;
    return Math.hypot(e.x - c.x, e.z - c.z);
  }

  /** The sword's balance point in world space. */
  balanceWorld(): THREE.Vector3 {
    return new THREE.Vector3(0, this.balancePoint, 0).applyQuaternion(q4(this.sword.rotation())).add(v3(this.sword.translation()));
  }

  /** The sword's orientation relative to the body. */
  swordRelPose(): THREE.Quaternion {
    return q4(this.body.rotation()).invert().multiply(q4(this.sword.rotation()));
  }

  /** A point on the sword (local y) expressed in the body frame. */
  swordPointInBody(along: number): THREE.Vector3 {
    const w = new THREE.Vector3(0, along, 0).applyQuaternion(q4(this.sword.rotation())).add(v3(this.sword.translation()));
    return w.sub(v3(this.body.translation())).applyQuaternion(q4(this.body.rotation()).invert());
  }

  respawn(spawn: SpawnOptions): void {
    const world = this.pw.world;
    if (this.holding) world.removeImpulseJoint(this.gripJoint, true);
    this.holding = true;
    for (const b of this.bodies) world.removeRigidBody(b);
    this.health = this.maxHealth;
    this.fallenTime = 0;
    this.build(spawn);
  }

  /** Teleport-free velocity reset (debug). */
  freeze(): void {
    withTeleportAuthority(() => {
      for (const b of this.bodies) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    });
  }

  /** Map a command onto actuator/gait targets and apply this substep's forces. */
  preStep(dt: number, cmd: PlayerCommand): void {
    const tun = this.tun;
    if (cmd.jump) { this.pendingJump = true; cmd.jump = false; }
    systemState(this.bodies, this.state);
    const pelvisPos = v3(this.pelvis.translation());
    const pelvisQ = q4(this.pelvis.rotation());

    if (this.tech) { this.preStepTechnique(dt, cmd, pelvisPos, pelvisQ); return; }

    // swing intent: named attacks, effort, grip and how braced the legs should be
    const sq = q4(this.sword.rotation());
    const sdir = new THREE.Vector3(0, 1, 0).applyQuaternion(sq);
    const mv = this.moves.update(dt, { effort: cmd.effort, grip: cmd.grip, attack: cmd.attack, spinHeld: cmd.spinHeld },
      {
        elevation: Math.asin(THREE.MathUtils.clamp(sdir.y, -1, 1)), tipHeight: this.swordTip.y - (this.feet.cop.y || 0),
        spinHeld: cmd.spinHeld, relSpeed: v3(this.sword.angvel()).sub(v3(this.body.angvel())).length(), peak: 0,
        planted: this.feet.feet.every((f) => f.phase === 'stance' && f.inContact) && this.gait.timeSinceLand > 0.1,
        touching: this.swordTouching,
      },
      !this.fallen && !this.swordCmdOverride);
    cmd.attack = null;
    const horiz = new THREE.Vector3(sdir.x, 0, sdir.z);
    if (horiz.lengthSq() < 0.01) horiz.set(0, 0, 1).applyQuaternion(pelvisQ).setY(0);
    this.gait.setBrace(mv.brace, mv.braceKind === 'pitch' ? horiz.normalize() : null, dt);

    this.feet.updateFrame();
    this.gait.update(dt, { move: cmd.move, jump: this.pendingJump, faceYaw: cmd.face }, this.state, pelvisPos, this.feet.frameQ,
      pelvisQ, v3(this.body.angvel()), v3(this.body.linvel()));
    this.pendingJump = false;

    const tilt = Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(pelvisQ).y, -1, 1));
    // balance reflex (part of bracing): ease off the swing as he starts to go over. Only ever
    // weakens the internal actuator.
    this.reflexScale = tun.balanceReflex ? 1 - THREE.MathUtils.clamp((tilt - 0.3) / 0.4, 0, 1) : 1;
    // optional balance governor: weaken the swing while the feet cannot hold the reaction
    if (tun.governor) {
      const trouble = this.feet.torqueDeficit > 800 || tilt > 0.45;
      this.governorScale = THREE.MathUtils.clamp(this.governorScale + (trouble ? -4 : 3) * dt, 0.25, 1);
    } else this.governorScale = 1;

    // while toppled the warrior relaxes his grip (a choice, not a cheat: less internal torque)
    this.swordAct.strength = this.fallen ? 0.05 : Math.min(1, this.swordAct.strength + dt * 0.5);
    this.sinceUp = this.fallen ? 0 : this.sinceUp + dt;
    this.swordAct.restRate = this.sinceUp < 2.5 ? 1.2 : 0;
    const restoring = this.swordAct.restRate > 0 && mv.effort.lengthSq() < 1e-4 && !mv.grip && !this.fallen;
    // follow-through, then settle: after a swing the sword coasts on its own momentum; once it has
    // (nearly) stopped relative to him he settles his grip and carries it there
    const relSpeed = v3(this.sword.angvel()).sub(v3(this.body.angvel())).length();
    if (mv.effort.lengthSq() > 0.0025 || this.fallen) { this.settled = false; this.slowTime = 0; }
    else if (!this.settled) {
      this.slowTime = relSpeed < 0.5 ? this.slowTime + dt : 0;
      if (this.slowTime > 0.2) this.settled = true;
    }

    if (this.swordCmdOverride) {
      // tests: drive the relative angular velocity directly (hold mode)
      this.swordAct.apply(this, this.swingCmd.copy(this.swordCmdOverride), dt);
    } else if (mv.grip || restoring || this.settled) {
      this.swordAct.apply(this, this.swingCmd.set(0, 0, 0), dt);
    } else {
      // effort: about world up for left/right, about the horizontal axis across the blade for up/down
      let pitchAxis = new THREE.Vector3().crossVectors(sdir, UP);
      if (pitchAxis.lengthSq() < 0.04) {
        pitchAxis = new THREE.Vector3(-1, 0, 0).applyQuaternion(pelvisQ);
        if (sdir.y < 0) pitchAxis.negate();
      }
      pitchAxis.normalize();
      const effortW = new THREE.Vector3(0, -mv.effort.x, 0).addScaledVector(pitchAxis, mv.effort.y)
        .multiplyScalar(tun.swordEffort * this.governorScale * this.reflexScale);
      this.swordAct.resting = this.swordTouching;
      this.swordAct.support = 1;
      this.swordAct.applyFree(this, effortW, this.gripPoint(), dt);
    }

    // reach
    if (cmd.reach !== 0) {
      this.reach = THREE.MathUtils.clamp(this.reach + cmd.reach * dt, GEOM.reachMin, GEOM.reachMax);
    }
    this.gripLocal.set(GEOM.grip.x, GEOM.grip.y, GEOM.grip.z + this.reach);
    applyReach(this, this.gripLocal);

    this.sword.setGravityScale(tun.cheatWeightlessSword ? 0 : 1, false);

    this.feet.apply(dt);

    if (tun.cheatAirControl && this.gait.airborne) applyAirControlCheat(this.bodies, cmd.move, dt);
  }

  /** Technique mode: the controller chooses targets; actuators and feet deliver them. */
  private preStepTechnique(dt: number, cmd: PlayerCommand, hipPos: THREE.Vector3, bodyQ: THREE.Quaternion): void {
    const tun = this.tun;
    // is there an enemy straight ahead? (read-only ray from the chest along his heading)
    const yaw = this.feet.frameYaw;
    const from = hipPos.clone().add(new THREE.Vector3(0, -0.25, 0));
    // a fan of rays: what he can see in front of him
    this.targetAhead = Infinity; this.targetBearing = 0;
    for (let i = -4; i <= 4; i++) {
      const a = yaw + i * 0.09;
      const hit = this.pw.world.castRay(new this.pw.R.Ray(from, { x: Math.sin(a), y: 0, z: Math.cos(a) }), 6, true, undefined,
        groups(0xffff, GROUP.ENEMY | GROUP.SHIELD));
      if (hit && hit.timeOfImpact < this.targetAhead - 0.05) { this.targetAhead = hit.timeOfImpact; this.targetBearing = a; }
    }
    const tilt = Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQ).y, -1, 1));
    this.reflexScale = tun.balanceReflex ? 1 - THREE.MathUtils.clamp((tilt - 0.3) / 0.4, 0, 1) : 1;

    const out = this.tech!.update(dt, cmd, this);
    cmd.drop = false;
    this.gait.setBrace(out.brace, null, dt);
    this.feet.updateFrame();
    this.gait.twistOverride = out.twist;
    this.gait.holdGround = out.holdGround;
    this.gait.balanceOnCom = out.balanceOnCom;
    // with the sword in hand its mass dominates and the plain capture-point placement works
    this.gait.leanShiftScale = this.holding ? 0 : 1;
    // unladen legs swing quicker
    this.gait.stepDuration = this.holding ? null : tun.stepDurationEmpty;
    const move = out.moveVel.clone().divideScalar(tun.walkSpeed);
    // What the legs have to balance: his own body plus the share of the sword he is actually
    // carrying (a sword in free fall or resting on the floor is not his to hold up).
    const eff = this.effState;
    const load = out.swordLoad;
    const mb = this.body.mass(), ms = this.sword.mass() * load;
    eff.mass = mb + ms;
    // carried as a rigid load: it counts where its own centre of mass is. Hanging loose from
    // his hands (falling, or tip on the floor): it only pulls at the grip.
    const at = out.loadAtGrip ? this.gripPoint() : v3(this.sword.worldCom());
    const atVel = out.loadAtGrip ? v3(this.body.velocityAtPoint(at)) : v3(this.sword.linvel());
    eff.com.copy(v3(this.body.worldCom())).multiplyScalar(mb).addScaledVector(at, ms).divideScalar(eff.mass);
    eff.vcom.copy(v3(this.body.linvel())).multiplyScalar(mb).addScaledVector(atVel, ms).divideScalar(eff.mass);
    // The leg drive follows a point a little above the hips, so a pitching torso makes the legs
    // hurry under it (balance). How far above sets how strongly: too high and he cannot brake.
    const ref = hipPos.clone().add(new THREE.Vector3(0, tun.balanceLever, 0).applyQuaternion(bodyQ));
    this.gait.update(dt, { move, jump: this.pendingJump && out.allowJump, faceYaw: out.face }, eff, hipPos, this.feet.frameQ,
      bodyQ, v3(this.body.angvel()), v3(this.body.velocityAtPoint(ref)));
    this.pendingJump = false;

    this.swordAct.strength = this.fallen ? 0.05 : Math.min(1, this.swordAct.strength + dt * 0.7);
    if (!this.holding) {
      // empty hands: they just go where he wants them (nothing to push against)
      const da = out.anchor.clone().sub(this.gripLocal);
      if (da.length() > out.anchorSpeed * dt) da.setLength(out.anchorSpeed * dt);
      this.gripLocal.add(da);
      this.sword.setGravityScale(tun.cheatWeightlessSword ? 0 : 1, false);
      this.feet.apply(dt);
      return;
    }
    // hands: slide along the sword and move relative to the body, both rate limited
    const dg = THREE.MathUtils.clamp(out.gripAlong - this.gripAlong, -out.slideSpeed * dt, out.slideSpeed * dt);
    this.gripAlong += dg;
    const da = out.anchor.clone().sub(this.gripLocal);
    const maxA = out.anchorSpeed * dt;
    if (da.length() > maxA) da.setLength(maxA);
    this.gripLocal.add(da);
    applyGripSlide(this, this.gripAlong);
    applyReach(this, this.gripLocal);

    if (out.free) {
      this.swordAct.resting = this.swordTouching;
      this.swordAct.support = out.support;
      this.swordAct.applyFree(this, out.effort, this.gripPoint(), dt);
    } else {
      // a pose given in the heading frame is held steady in the world: the arms take up the
      // torso's lean instead of swinging the sword with it
      const pose = out.poseInHeading ? bodyQ.clone().invert().multiply(this.feet.frameQ).multiply(out.pose) : out.pose;
      this.swordAct.poseTarget = this.fallen ? null : pose;
      this.swordAct.poseRate = out.poseRate;
      this.swordAct.apply(this, this.swingCmd.set(0, 0, 0), dt);
    }
    this.sword.setGravityScale(tun.cheatWeightlessSword ? 0 : 1, false);
    this.feet.apply(dt);
    if (tun.cheatAirControl && this.gait.airborne) applyAirControlCheat(this.bodies, cmd.move, dt);
  }

  /** Is the blade touching anything (ground, wall, goblin)? Read from the narrow phase. */
  swordTouching = false;

  /** Furthest point along the sword (local y from the hilt) where something holds the blade up, or NaN. */
  swordRestAlong = NaN;

  /**
   * Share of the sword's weight his hands carry, by statics: a beam held at the grip and resting
   * on its furthest contact. Free (nothing touching) the hands carry all of it.
   */
  handShare(): number {
    const c = this.swordRestAlong, com = this.balancePoint, g = this.gripAlong;
    if (!Number.isFinite(c)) return 1;
    if (c < com + 0.05) return 1; // resting behind its balance point: it just pivots on that
    return THREE.MathUtils.clamp((c - com) / Math.max(c - g, 0.05), 0, 1);
  }

  postStep(dt: number): void {
    let touching = false, rest = NaN;
    const sq = q4(this.sword.rotation()).invert(), sp = v3(this.sword.translation());
    this.pw.world.contactPairsWith(this.swordBlade, (other) => {
      this.pw.world.contactPair(this.swordBlade, other, (m) => {
        for (let i = 0; i < m.numSolverContacts(); i++) {
          touching = true;
          const cp = m.solverContactPoint(i); if (!cp) continue;
          const y = v3(cp).sub(sp).applyQuaternion(sq).y;
          if (!(y <= rest)) rest = y;
        }
      });
    });
    this.swordTouching = touching;
    this.swordRestAlong = rest;
    this.gripWorld.copy(this.gripLocal).applyQuaternion(q4(this.torso.rotation())).add(v3(this.torso.translation()));
    this.swordAct.measure(this, this.gripWorld, dt);
    // (hysteresis: rolling about on the floor near the 60° line must not keep resetting it)
    // (and tumbling through upright for a moment does not count as being up)
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(this.body.rotation())).y;
    this.uprightTime = upY > 0.8 && !this.fallen ? this.uprightTime + dt : 0;
    if (this.fallen || (this.fallenTime > 0 && this.uprightTime < 0.5)) this.fallenTime += dt;
    else this.fallenTime = 0;
    // Explicit, visible game rule (not a force): if the legs have not got him up after a while,
    // he is put back on his feet where he lies. Reported in the README as a deviation.
    if (this.autoStandUp && this.fallenTime > this.tun.standUpDelay) this.standUpInPlace();
  }
}
