/**
 * GOBLINS. They come from a "normal" game and cheat shamelessly: while upright they have sticky
 * feet, cannot tip over and are moved by setting their velocity and heading directly. When the
 * sword hits them hard enough they stop cheating and become plain dynamic rigid bodies, launched
 * by the real collision. Nothing in this file touches a player body.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './world';
import { GROUP, groups, ALL_GROUPS } from './world';
import type { Tunables } from './tunables';
import type { Impact } from './impacts';
import { q4, v3 } from './mathUtil';

export type ShieldSide = 'none' | 'left' | 'right' | 'top';
export type GoblinState = 'idle' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stagger' | 'ragdoll' | 'dead';

export const GOBLIN = {
  radius: 0.28,
  halfHeight: 0.28,
  /** Body origin height above the feet. */
  originHeight: 0.6,
  mass: 35,
  speed: 2.3,
  plainTurnRate: 8,
  shieldTurnRate: 1.6,
  attackRange: 1.35,
  windup: 0.45,
  lunge: 0.18,
  lungeSpeed: 4.5,
  recover: 1.0,
  attackDamage: 8,
  hpPlain: 30,
  hpShielded: 45,
};

export interface HitResult { goblin: Goblin; damage: number; blocked: boolean; impact: Impact }

export class Goblin {
  state: GoblinState = 'idle';
  hp: number;
  readonly maxHp: number;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[] = [];
  shieldBody: RAPIER.RigidBody | null = null;
  shieldCollider: RAPIER.Collider | null = null;
  yaw = 0;
  timer = 0;
  hitPlayerThisAttack = false;
  downTime = 0;
  deadTime = 0;
  /** Seconds since last sword contact (any speed). */
  sinceTouched = 99;
  flash = 0;

  /** Training dummy: never moves or attacks, stands back up at home after being knocked down. */
  dummy = false;
  readonly home = new THREE.Vector3();
  homeYaw = 0;

  constructor(private pw: PhysicsWorld, readonly id: number, pos: THREE.Vector3, readonly shield: ShieldSide, yaw = 0) {
    this.home.copy(pos);
    this.homeYaw = yaw;
    const R = pw.R, world = pw.world;
    this.maxHp = this.hp = shield === 'none' ? GOBLIN.hpPlain : GOBLIN.hpShielded;
    this.yaw = yaw;
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + GOBLIN.originHeight, pos.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))
      .enabledRotations(false, false, false)
      .setCcdEnabled(true));
    const g = groups(GROUP.ENEMY, ALL_GROUPS);
    this.colliders.push(world.createCollider(R.ColliderDesc.capsule(GOBLIN.halfHeight, GOBLIN.radius)
      .setDensity(0).setFriction(0.6).setRestitution(0.2).setCollisionGroups(g), this.body));
    this.colliders.push(world.createCollider(R.ColliderDesc.ball(0.24).setTranslation(0, 0.62, 0.02)
      .setDensity(0).setFriction(0.6).setRestitution(0.2).setCollisionGroups(g), this.body));
    this.body.setAdditionalMassProperties(GOBLIN.mass, { x: 0, y: 0.05, z: 0 }, { x: 1.6, y: 0.9, z: 1.6 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    for (const c of this.colliders) pw.materials.set(c.handle, { kind: 'flesh' });

    if (shield !== 'none') {
      // The shield is its own kinematic body glued to the goblin each step: infinitely stiff while
      // the goblin is braced, so a blocked sword genuinely bounces and the warrior recoils.
      this.shieldBody = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 1, pos.z));
      const half = shield === 'top' ? new THREE.Vector3(0.55, 0.05, 0.5) : new THREE.Vector3(0.05, 0.6, 0.5);
      this.shieldCollider = world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setFriction(0.4).setRestitution(0.35)
        .setCollisionGroups(groups(GROUP.SHIELD, GROUP.SWORD | GROUP.PLAYER | GROUP.DEBRIS)), this.shieldBody);
      pw.materials.set(this.shieldCollider.handle, { kind: 'shield' });
      this.syncShield(0);
    }
  }

  get position(): THREE.Vector3 { return v3(this.body.translation()); }
  get alive(): boolean { return this.state !== 'dead'; }
  get upright(): boolean { return this.state !== 'ragdoll' && this.state !== 'dead'; }

  /** Shield pose in goblin-local coordinates. */
  static shieldOffset(side: ShieldSide): THREE.Vector3 {
    if (side === 'left') return new THREE.Vector3(0.48, 0.1, 0.15); // goblin's left = +x when facing +z
    if (side === 'right') return new THREE.Vector3(-0.48, 0.1, 0.15);
    return new THREE.Vector3(0, 0.98, 0.05);
  }

  syncShield(dt: number): void {
    if (!this.shieldBody) return;
    const q = q4(this.body.rotation());
    const p = Goblin.shieldOffset(this.shield).applyQuaternion(q).add(v3(this.body.translation()));
    if (dt === 0) { this.shieldBody.setTranslation(p, true); this.shieldBody.setRotation(q, true); }
    else { this.shieldBody.setNextKinematicTranslation(p); this.shieldBody.setNextKinematicRotation(q); }
  }

  /** Dummy reset: back home, upright, full health, shield re-attached. */
  resetHome(): void {
    const b = this.body;
    this.yaw = this.homeYaw;
    b.setTranslation({ x: this.home.x, y: this.home.y + GOBLIN.originHeight + 0.02, z: this.home.z }, true);
    b.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw), true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.setEnabledRotations(false, false, false, true);
    this.hp = this.maxHp;
    this.state = 'idle';
    this.downTime = 0; this.deadTime = 0;
    if (this.shieldBody && !this.shieldBody.isKinematic()) {
      this.shieldBody.setBodyType(this.pw.R.RigidBodyType.KinematicPositionBased, true);
      this.shieldCollider!.setCollisionGroups(groups(GROUP.SHIELD, GROUP.SWORD | GROUP.PLAYER | GROUP.DEBRIS));
    }
    this.syncShield(0);
  }

  /** Knocked loose: the shield becomes a free dynamic piece of debris. */
  dropShield(): void {
    if (!this.shieldBody) return;
    this.shieldBody.setBodyType(this.pw.R.RigidBodyType.Dynamic, true);
    this.shieldCollider!.setMass(6);
    this.shieldCollider!.setCollisionGroups(groups(GROUP.DEBRIS, ALL_GROUPS));
  }

  /**
   * Is a hit arriving from the shielded side? relVel is the sword-point velocity relative to the
   * goblin. A side shield protects against blows travelling toward the goblin's other side; a
   * top shield against blows coming down.
   */
  blocksDirection(relVel: THREE.Vector3): boolean {
    if (this.shield === 'none' || !this.upright) return false;
    const local = relVel.clone().applyQuaternion(q4(this.body.rotation()).invert());
    const sp = local.length();
    if (sp < 1e-6) return false;
    if (this.shield === 'top') return -local.y > 0.55 * sp;
    // left shield sits at +x: a blow from the left travels toward -x
    if (this.shield === 'left') return -local.x > 0.45 * sp;
    return local.x > 0.45 * sp;
  }
}

export class GoblinManager {
  readonly goblins: Goblin[] = [];
  private nextId = 1;
  onPlayerHit: (g: Goblin, damage: number) => void = () => {};

  constructor(private pw: PhysicsWorld, private tun: Tunables) {}

  spawn(pos: THREE.Vector3, shield: ShieldSide = 'none', yaw = 0, dummy = false): Goblin {
    const g = new Goblin(this.pw, this.nextId++, pos, shield, yaw);
    g.dummy = dummy;
    this.goblins.push(g);
    return g;
  }

  remove(g: Goblin): void {
    const w = this.pw.world;
    if (g.shieldBody) w.removeRigidBody(g.shieldBody);
    w.removeRigidBody(g.body);
    this.goblins.splice(this.goblins.indexOf(g), 1);
  }

  clear(): void { for (const g of [...this.goblins]) this.remove(g); }

  owner(collider: RAPIER.Collider): { goblin: Goblin; part: 'body' | 'shield' } | null {
    for (const g of this.goblins) {
      if (g.shieldCollider && g.shieldCollider.handle === collider.handle) return { goblin: g, part: 'shield' };
      if (g.colliders.some((c) => c.handle === collider.handle)) return { goblin: g, part: 'body' };
    }
    return null;
  }

  /**
   * Resolve sword impacts. Damage only from relative *normal* speed above the threshold, scaled
   * above it. Shield hits and blows from the shielded side do no damage.
   */
  applyImpacts(impacts: Impact[]): HitResult[] {
    const out: HitResult[] = [];
    for (const imp of impacts) {
      const o = this.owner(imp.other);
      if (!o) continue;
      const g = o.goblin;
      g.sinceTouched = 0;
      if (!g.alive) continue;
      const blocked = o.part === 'shield' || g.blocksDirection(imp.relVel);
      const over = imp.normalSpeed - this.tun.damageThreshold;
      const damage = !blocked && over > 0 ? Math.round(over * this.tun.damagePerMps + 5) : 0;
      if (damage > 0) {
        g.hp -= damage;
        g.flash = 0.2;
        this.knockLoose(g, g.hp <= 0);
      } else if (o.part === 'body' && g.state !== 'ragdoll') {
        // a slow push: stop cheating for a moment so the shove is real
        g.state = 'stagger';
        g.timer = 0.45;
      }
      out.push({ goblin: g, damage, blocked, impact: imp });
    }
    return out;
  }

  private knockLoose(g: Goblin, dead: boolean): void {
    g.state = dead ? 'dead' : 'ragdoll';
    g.downTime = 0;
    g.body.setEnabledRotations(true, true, true, true);
    if (dead && !g.dummy) g.dropShield();
  }

  /** AI + cheating locomotion, before the physics step. */
  pre(dt: number, playerPos: THREE.Vector3, active: (g: Goblin) => boolean): void {
    for (const g of this.goblins) {
      g.sinceTouched += dt;
      g.flash = Math.max(0, g.flash - dt);
      const p = g.position;
      const toP = new THREE.Vector3(playerPos.x - p.x, 0, playerPos.z - p.z);
      const dist = toP.length();
      if (g.dummy && (g.state === 'ragdoll' || g.state === 'dead')) {
        g.downTime += dt;
        if (g.shieldBody) g.syncShield(dt);
        if (g.downTime > 3.5) g.resetHome();
        continue;
      }
      if (g.state === 'dead') { g.deadTime += dt; continue; }
      if (g.state === 'ragdoll') {
        g.downTime += dt;
        if (g.shieldBody) g.syncShield(dt);
        const v = g.body.linvel();
        if (g.downTime > 2.2 && Math.hypot(v.x, v.y, v.z) < 0.6) this.standUp(g);
        continue;
      }
      const isActive = !g.dummy && active(g);
      // turn toward the player (shielded goblins only slowly); shielded dummies turn too
      if ((isActive || (g.dummy && g.shield !== 'none' && dist < 9)) && dist > 0.05) {
        const want = Math.atan2(toP.x, toP.z);
        let d = want - g.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const rate = g.shield === 'none' ? GOBLIN.plainTurnRate : GOBLIN.shieldTurnRate;
        if (g.state !== 'lunge') g.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
      }
      const fwd = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw));
      let vx = 0, vz = 0;
      g.timer -= dt;
      switch (g.state) {
        case 'idle':
          if (isActive) g.state = 'chase';
          break;
        case 'chase':
          if (!isActive) { g.state = 'idle'; break; }
          if (dist < GOBLIN.attackRange) { g.state = 'windup'; g.timer = GOBLIN.windup; g.hitPlayerThisAttack = false; break; }
          vx = toP.x / dist * GOBLIN.speed; vz = toP.z / dist * GOBLIN.speed;
          break;
        case 'windup':
          if (g.timer <= 0) {
            g.state = 'lunge'; g.timer = GOBLIN.lunge;
            // launched once: the knockback is whatever a 35 kg goblin's momentum can do
            g.body.setLinvel({ x: fwd.x * GOBLIN.lungeSpeed, y: 0.5, z: fwd.z * GOBLIN.lungeSpeed }, true);
          }
          break;
        case 'lunge':
          if (!g.hitPlayerThisAttack && dist < 1.1 && fwd.dot(toP.clone().normalize()) > 0.5) {
            g.hitPlayerThisAttack = true;
            this.onPlayerHit(g, GOBLIN.attackDamage);
          }
          if (g.timer <= 0) { g.state = 'recover'; g.timer = GOBLIN.recover; }
          break;
        case 'recover':
          if (g.timer <= 0) g.state = 'chase';
          break;
        case 'stagger':
          if (g.timer <= 0) g.state = g.dummy ? 'idle' : 'chase';
          break;
      }
      if (g.state === 'lunge') {
        g.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw), true);
      } else if (g.state !== 'stagger') {
        // the cheat: velocity and heading are simply set
        const v = g.body.linvel();
        g.body.setLinvel({ x: vx, y: Math.min(v.y, 2), z: vz }, true);
        g.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw), true);
        g.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      g.syncShield(dt);
    }
  }

  private standUp(g: Goblin): void {
    // goblins get up the way videogame goblins do: by snapping upright
    const p = g.position;
    g.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw), true);
    g.body.setTranslation({ x: p.x, y: Math.max(p.y, GOBLIN.originHeight + 0.05), z: p.z }, true);
    g.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    g.body.setEnabledRotations(false, false, false, true);
    g.state = 'chase';
  }

  /** Remove dead goblins that have lain around long enough. */
  cleanup(maxDeadTime = 8): Goblin[] {
    const gone = this.goblins.filter((g) => !g.dummy && g.state === 'dead' && g.deadTime > maxDeadTime);
    for (const g of gone) this.remove(g);
    return gone;
  }
}
