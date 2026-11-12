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
import { SwordActuator, applyReach, applyAirControlCheat, type ActuatedBodies } from './actuators';
import { systemState, type SystemState } from './metrics';

export interface PlayerCommand {
  /** World-space horizontal move direction, |move| <= 1. */
  move: THREE.Vector3;
  /** Sword swing about the vertical axis, rad/s (+ = counter-clockwise seen from above). */
  swingYaw: number;
  /** Sword swing up/down, rad/s (+ = tip up). */
  swingPitch: number;
  /** Grip reach rate, m/s (+ = push sword away from body). */
  reach: number;
  jump: boolean;
}

export const emptyCommand = (): PlayerCommand => ({ move: new THREE.Vector3(), swingYaw: 0, swingPitch: 0, reach: 0, jump: false });

export interface SpawnOptions {
  /** Ground point under the warrior. */
  position: THREE.Vector3;
  heading?: number;
  /** Initial sword direction in torso frame (default: upright). */
  swordDir?: THREE.Vector3;
  /** Spawn with feet planted on the ground below (default true). */
  grounded?: boolean;
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
  readonly state: SystemState = { mass: 0, com: new THREE.Vector3(), vcom: new THREE.Vector3(), P: new THREE.Vector3(), L: new THREE.Vector3() };
  reach = 0;
  readonly gripLocal = new THREE.Vector3();
  readonly gripWorld = new THREE.Vector3();
  readonly swingCmd = new THREE.Vector3();
  /** Seconds the warrior has been toppled (legs out of reach of the ground). */
  fallenTime = 0;
  /** Set by tests to bypass input mapping and command the sword in world frame directly. */
  swordCmdOverride: THREE.Vector3 | null = null;
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
  get fallen(): boolean { return this.feet.legsDisabled; }

  private build(spawn: SpawnOptions): void {
    const R = this.pw.R, world = this.pw.world, tun = this.tun;
    const heading = spawn.heading ?? 0;
    const qh = new THREE.Quaternion().setFromAxisAngle(UP, heading);
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
    this.reach = 0;
    this.gripLocal.copy(GEOM.grip);
    const gripWorld = this.gripLocal.clone().applyQuaternion(qh).add(torsoPos);
    const dirLocal = (spawn.swordDir ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
    const qs = qh.clone().multiply(new THREE.Quaternion().setFromUnitVectors(UP, dirLocal));
    this.sword = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(gripWorld.x, gripWorld.y, gripWorld.z).setRotation(qs)
      .setCcdEnabled(true).setCanSleep(false));
    const L = tun.swordLength;
    const bladeLen = L - GEOM.pommel - GEOM.bladeStart;
    const bladeMid = GEOM.bladeStart + bladeLen / 2;
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
    const ms = tun.swordMass, fb = GEOM.bladeMassFraction;
    const mb = ms * fb, mh = ms * (1 - fb);
    const yh = 0.0;
    const com = (mb * bladeMid + mh * yh) / ms;
    const Ixx = mb * (bladeLen * bladeLen + GEOM.bladeThickness ** 2) / 12 + mb * (bladeMid - com) ** 2
      + mh * (0.55 ** 2) / 12 + mh * (yh - com) ** 2;
    const Iyy = mb * (GEOM.bladeWidth ** 2 + GEOM.bladeThickness ** 2) / 12 + mh * 0.01;
    const Izz = mb * (bladeLen * bladeLen + GEOM.bladeWidth ** 2) / 12 + mb * (bladeMid - com) ** 2
      + mh * (0.55 ** 2) / 12 + mh * (yh - com) ** 2;
    this.sword.setAdditionalMassProperties(ms, { x: 0, y: com, z: 0 }, { x: Ixx, y: Iyy, z: Izz }, { x: 0, y: 0, z: 0, w: 1 }, true);

    this.gripJoint = world.createImpulseJoint(
      R.JointData.spherical({ x: this.gripLocal.x, y: this.gripLocal.y, z: this.gripLocal.z }, { x: 0, y: 0, z: 0 }),
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

  /** Remove all bodies and rebuild at a new spawn (also picks up changed mass/length tunables). */
  respawn(spawn: SpawnOptions): void {
    const world = this.pw.world;
    world.removeImpulseJoint(this.gripJoint, true);
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

    this.gait.update(dt, { move: cmd.move, jump: this.pendingJump }, this.state, pelvisPos, pelvisQ);
    this.pendingJump = false;

    // sword command: yaw about world up, pitch about the horizontal axis across the blade
    const cmdW = this.swingCmd;
    if (this.swordCmdOverride) cmdW.copy(this.swordCmdOverride);
    else {
      const sdir = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(this.sword.rotation()));
      let pitchAxis = new THREE.Vector3().crossVectors(sdir, UP);
      if (pitchAxis.lengthSq() < 0.04) {
        // blade near vertical: pitch about the torso's right axis instead
        const tq = q4(this.torso.rotation());
        pitchAxis = new THREE.Vector3(-1, 0, 0).applyQuaternion(tq);
        if (sdir.y < 0) pitchAxis.negate();
      }
      pitchAxis.normalize();
      cmdW.set(0, cmd.swingYaw, 0).addScaledVector(pitchAxis, cmd.swingPitch);
    }
    this.swordAct.apply(this, cmdW, dt);

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

  postStep(dt: number): void {
    this.gripWorld.copy(this.gripLocal).applyQuaternion(q4(this.torso.rotation())).add(v3(this.torso.translation()));
    this.swordAct.measure(this, this.gripWorld, dt);
    this.fallenTime = this.feet.legsDisabled ? this.fallenTime + dt : 0;
  }
}
