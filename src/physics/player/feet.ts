/**
 * FOOT–GROUND CONTACT MODEL. One of exactly two modules allowed to push on player bodies.
 *
 * Each foot has a heel and a toe contact point. While a foot is planted its sole points are
 * rigidly attached to the pelvis/legs body (a "stool" whose leg length the controller sets),
 * except that the stepping controller can sweep the planted foot backwards (the leg drive).
 *
 *  - Normal force: per-point spring-damper on how far the body-attached sole point has sunk
 *    below the ground found by a downward raycast. N >= 0 always (feet cannot pull).
 *  - Friction: per-point anchor. While sticking, a stiff tangential spring-damper between the
 *    body point and its world anchor supplies whatever is needed, up to mu_s·N. Beyond that the
 *    point slips: friction becomes mu_k·N opposing the slip velocity, and the anchor is dragged
 *    along. It only re-sticks after the slip speed has stayed below restickSpeed for restickTime
 *    (hysteresis), so it does not chatter.
 *  - Twisting resistance is not modelled separately: it comes from heel/toe/left/right points
 *    being apart, so it is friction limited too.
 *
 * All forces are applied as impulses at the contact points on the pelvis body. The ground is
 * static world geometry, so these are honest external forces.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world';
import { GROUP, groups } from '../world';
import type { Tunables } from '../tunables';
import { withForceAuthority } from '../forceGuard';
import { q4, v3 } from '../mathUtil';
import { GEOM } from './geometry';

export type ContactState = 'air' | 'stick' | 'slip';
export type FootPhase = 'stance' | 'swing' | 'air';

export class ContactPoint {
  /** Pelvis-local sole setpoint. */
  readonly local = new THREE.Vector3();
  readonly world = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly anchor = new THREE.Vector3();
  readonly force = new THREE.Vector3(); // horizontal friction actually applied (world)
  state: ContactState = 'air';
  N = 0;
  muS = 0.9;
  muK = 0.5;
  material = 'stone';
  groundY = -Infinity;
  slowTime = 0;
  slipSpeed = 0;
  /** |F| / limit where limit is mu_s·N when sticking and mu_k·N when slipping. */
  usage = 0;
  /** Largest |F|/(mu·N) ratio observed for the state it was in (tests). */
  constructor(readonly name: string, readonly along: number) {}
}

export class Foot {
  phase: FootPhase = 'air';
  /** Pelvis-local xz of the ankle. */
  readonly center = new THREE.Vector2();
  /** Foot yaw relative to the pelvis (0 = pelvis forward). */
  yaw = 0;
  readonly points: [ContactPoint, ContactPoint];
  // swing state (world frame), driven by the controller
  readonly swingFrom = new THREE.Vector3();
  readonly swingTo = new THREE.Vector3();
  swingYawFrom = 0;
  swingYawTo = 0;
  swingT = 0;
  swingDur = 0.3;
  /** World ankle position for rendering/IK (ground level when planted). */
  readonly worldPos = new THREE.Vector3();
  worldYaw = 0;
  lift = 0;
  noContactTime = 0;
  justLanded = false;
  constructor(readonly side: -1 | 1) {
    const s = side < 0 ? 'L' : 'R';
    this.points = [new ContactPoint(s + 'heel', GEOM.heel), new ContactPoint(s + 'toe', GEOM.toe)];
  }
  get inContact(): boolean { return this.points.some((p) => p.state !== 'air'); }
  get slipping(): boolean { return this.points.some((p) => p.state === 'slip'); }
}

export interface SlipEvent { pos: THREE.Vector3; speed: number; N: number }

const tmpQ = new THREE.Quaternion();
const tmpQi = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpImp = new THREE.Vector3();

export class FootSystem {
  readonly feet: [Foot, Foot] = [new Foot(-1), new Foot(1)];
  /** World horizontal velocity the stance legs sweep the body at (leg drive). */
  readonly driveVel = new THREE.Vector3();
  /** Extra leg length (m) commanded by the controller, e.g. jump extension. */
  legExtension = 0;
  legExtensionRate = 0;
  /** Extra total leg thrust (N) this substep, shared by contact points. Used for jumping. */
  thrust = 0;
  /** True when the pelvis is too tilted for the legs to reach the ground (toppled). */
  legsDisabled = false;
  slipEvents: SlipEvent[] = [];
  totalN = 0;
  private ray: RAPIER.Ray;
  private readonly rayGroups = groups(0xffff, GROUP.GROUND);

  constructor(private pw: PhysicsWorld, private tun: Tunables, private pelvis: RAPIER.RigidBody) {
    this.ray = new pw.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  get soleDepth(): number { return this.tun.legLength - GEOM.hipOffset; }

  /** Compute pelvis-local sole setpoints of a foot. */
  updateLocal(foot: Foot): void {
    const s = Math.sin(foot.yaw), c = Math.cos(foot.yaw);
    for (const p of foot.points) {
      p.local.set(foot.center.x + s * p.along, -this.soleDepth - this.legExtension, foot.center.y + c * p.along);
    }
  }

  /** Raycast the ground under a world point. Returns ground y (or -Infinity) and collider. */
  probe(p: THREE.Vector3, from = 0.7, len = 1.6): { y: number; collider: RAPIER.Collider | null } {
    this.ray.origin = { x: p.x, y: p.y + from, z: p.z };
    const hit = this.pw.world.castRay(this.ray, len, true, undefined, this.rayGroups);
    if (!hit) return { y: -Infinity, collider: null };
    return { y: p.y + from - hit.timeOfImpact, collider: hit.collider };
  }

  apply(dt: number): void {
    this.slipEvents.length = 0;
    this.totalN = 0;
    const tun = this.tun;
    const pelvis = this.pelvis;
    const pos = v3(pelvis.translation(), new THREE.Vector3());
    const q = q4(pelvis.rotation(), tmpQ);
    tmpQi.copy(q).invert();
    const up = tmpV.set(0, 1, 0).applyQuaternion(q);
    // Legs only reach the ground while the pelvis is reasonably upright.
    this.legsDisabled = up.y < Math.cos(THREE.MathUtils.degToRad(55));

    // Leg drive in pelvis-local coordinates (horizontal).
    const localDrive = tmpD.copy(this.driveVel).applyQuaternion(tmpQi);

    let contactCount = 0;

    for (const foot of this.feet) {
      foot.justLanded = false;
      if (foot.phase === 'stance') {
        foot.center.x -= localDrive.x * dt;
        foot.center.y -= localDrive.z * dt;
      }
      this.updateLocal(foot);
      let anyContact = false;
      for (const cp of foot.points) {
        cp.world.copy(cp.local).applyQuaternion(q).add(pos);
        const bv = pelvis.velocityAtPoint(cp.world);
        // velocity of the setpoint: body point velocity + setpoint motion relative to body
        const setVel = tmpP.set(
          foot.phase === 'stance' ? -localDrive.x : 0,
          -this.legExtensionRate,
          foot.phase === 'stance' ? -localDrive.z : 0,
        ).applyQuaternion(q);
        cp.vel.set(bv.x, bv.y, bv.z).add(setVel);
        cp.force.set(0, 0, 0);
        cp.N = 0; cp.usage = 0;

        if (foot.phase === 'swing' || this.legsDisabled) { cp.state = 'air'; continue; }
        const g = this.probe(cp.world);
        cp.groundY = g.y;
        const depth = g.y - cp.world.y;
        if (depth <= 0 || !g.collider) { cp.state = 'air'; continue; }
        const mat = this.pw.frictionOf(g.collider.handle);
        cp.material = mat.kind;
        cp.muS = mat.muS; cp.muK = mat.muK;
        if (tun.cheatInfiniteFriction || tun.cheatStickyFeet) { cp.muS = 1e9; cp.muK = 1e9; }
        if (cp.state === 'air') {
          cp.state = 'stick';
          cp.anchor.set(cp.world.x, g.y, cp.world.z);
          cp.slowTime = 0;
        }
        anyContact = true;
        let N = tun.footNormalStiffness * Math.min(depth, 0.2) - tun.footNormalDamping * cp.vel.y;
        if (!tun.cheatStickyFeet) N = Math.max(0, N);
        cp.N = N;
        contactCount++;
      }
      if (foot.phase === 'stance') {
        foot.noContactTime = anyContact ? 0 : foot.noContactTime + dt;
        if (foot.noContactTime > 0.06) foot.phase = 'air';
      } else if (foot.phase === 'air') {
        if (anyContact) {
          foot.phase = 'stance';
          foot.justLanded = true;
          foot.noContactTime = 0;
        } else foot.noContactTime += dt;
      }
    }

    // Jump thrust: the legs push harder against the ground. Still a normal force at a contact.
    if (this.thrust > 0 && contactCount > 0) {
      const share = this.thrust / contactCount;
      for (const foot of this.feet) for (const cp of foot.points) if (cp.state !== 'air') cp.N += share;
    }

    // Friction, point by point.
    for (const foot of this.feet) {
      if (foot.phase !== 'stance') continue;
      for (const cp of foot.points) {
        if (cp.state === 'air') continue;
        // sticky-feet cheat: glue, so the friction cone never closes even if N < 0
        const N = tun.cheatStickyFeet ? Math.abs(cp.N) + 1e4 : Math.max(cp.N, 0);
        this.totalN += N;
        const vh = tmpV.set(cp.vel.x, 0, cp.vel.z);
        const d = tmpD.set(cp.world.x - cp.anchor.x, 0, cp.world.z - cp.anchor.z);
        const fReq = tmpF.copy(d).multiplyScalar(-tun.footTangentStiffness).addScaledVector(vh, -tun.footTangentDamping);
        const sLimit = cp.muS * N;
        if (cp.state === 'stick') {
          if (fReq.length() <= sLimit) {
            cp.force.copy(fReq);
            cp.usage = sLimit > 0 ? fReq.length() / sLimit : 0;
          } else {
            cp.state = 'slip';
            cp.slowTime = 0;
          }
        }
        if (cp.state === 'slip') {
          const kLimit = cp.muK * N;
          const speed = vh.length();
          cp.slipSpeed = speed;
          if (speed > 1e-4) cp.force.copy(vh).multiplyScalar(-kLimit / speed);
          else if (fReq.lengthSq() > 0) cp.force.copy(fReq).setLength(kLimit);
          else cp.force.set(0, 0, 0);
          // drag the anchor so the spring agrees with the kinetic force
          cp.anchor.set(cp.world.x + cp.force.x / tun.footTangentStiffness, cp.groundY,
            cp.world.z + cp.force.z / tun.footTangentStiffness);
          cp.usage = kLimit > 0 ? cp.force.length() / kLimit : 0;
          this.slipEvents.push({ pos: cp.world.clone().setY(cp.groundY), speed, N });
          if (speed < tun.restickSpeed) {
            cp.slowTime += dt;
            if (cp.slowTime >= tun.restickTime) {
              // re-evaluate as stick with the dragged anchor; must fit inside the static cone
              tmpImp.set(cp.world.x - cp.anchor.x, 0, cp.world.z - cp.anchor.z)
                .multiplyScalar(-tun.footTangentStiffness).addScaledVector(vh, -tun.footTangentDamping);
              if (tmpImp.length() <= sLimit) cp.state = 'stick';
            }
          } else cp.slowTime = 0;
        } else {
          cp.slipSpeed = 0;
        }
      }
      // Leg strength: the drive may not wind a planted leg's spring further than legMaxStretch.
      this.limitWindup(foot, q);
    }

    // Apply: N up + friction, at each contact point, on the pelvis body.
    withForceAuthority(() => {
      for (const foot of this.feet) {
        for (const cp of foot.points) {
          if (cp.state === 'air') continue;
          tmpImp.set(cp.force.x * dt, cp.N * dt, cp.force.z * dt);
          pelvis.applyImpulseAtPoint(tmpImp, cp.world, true);
        }
      }
    });
    this.updateVisual(q, pos);
  }

  private limitWindup(foot: Foot, q: THREE.Quaternion): void {
    let n = 0;
    const s = tmpD.set(0, 0, 0);
    for (const cp of foot.points) {
      if (cp.state !== 'stick') continue;
      s.x += cp.world.x - cp.anchor.x; s.z += cp.world.z - cp.anchor.z; n++;
    }
    if (!n) return;
    s.divideScalar(n);
    const len = s.length();
    const max = this.tun.legMaxStretch;
    if (len <= max) return;
    // move the setpoint back toward the anchor (in pelvis-local coordinates)
    s.multiplyScalar(-(1 - max / len));
    const local = s.applyQuaternion(tmpQi.copy(q).invert());
    foot.center.x += local.x;
    foot.center.y += local.z;
  }

  /** Ankle positions for rendering & IK. */
  private updateVisual(q: THREE.Quaternion, pos: THREE.Vector3): void {
    for (const foot of this.feet) {
      if (foot.phase === 'swing') continue; // controller writes swing visuals
      const a = foot.points[0], b = foot.points[1];
      const t = -GEOM.heel / (GEOM.toe - GEOM.heel);
      const w = tmpP.copy(a.world).lerp(b.world, t);
      if (foot.phase === 'stance') {
        // planted foot is drawn at its anchors (where the ground actually is)
        const ax = a.anchor.x + (b.anchor.x - a.anchor.x) * t;
        const az = a.anchor.z + (b.anchor.z - a.anchor.z) * t;
        const gy = Math.max(a.groundY, b.groundY);
        foot.worldPos.set(a.state !== 'air' || b.state !== 'air' ? ax : w.x, gy > -1e6 ? gy : w.y,
          a.state !== 'air' || b.state !== 'air' ? az : w.z);
        foot.lift = 0;
      } else {
        foot.worldPos.copy(w);
        foot.lift = 0;
      }
      const dir = tmpF.copy(b.world).sub(a.world);
      foot.worldYaw = Math.atan2(dir.x, dir.z);
      void q; void pos;
    }
  }

  /** Total friction usage summary for the debug overlay. */
  usageSummary(): string[] {
    const out: string[] = [];
    for (const foot of this.feet) for (const cp of foot.points) {
      out.push(`${cp.name.padEnd(6)} ${cp.state.padEnd(5)} N=${cp.N.toFixed(0).padStart(5)} F/μN=${cp.usage.toFixed(2)} ${cp.material}`);
    }
    return out;
  }
}
