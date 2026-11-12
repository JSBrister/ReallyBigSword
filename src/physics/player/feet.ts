/**
 * FOOT–GROUND CONTACT MODEL. One of exactly two modules allowed to push on player bodies.
 *
 * Each foot has a heel and a toe contact point. While a foot is planted its sole points are
 * rigidly attached to the warrior body (a "stool" whose leg length the controller sets),
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
 * All forces are applied as impulses at the contact points on the warrior body. The ground is
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
  depth = 0;
  /** Which friction law produced `force` this substep (state may change right after). */
  forceMode: 'stick' | 'slip' = 'stick';
  /** Normal force used for the friction cone. */
  Neff = 0;
  /** Friction impulse this substep. */
  readonly J = new THREE.Vector3();
  clamped = false;
  constructor(readonly name: string, readonly along: number, readonly lat: number, readonly foot: Foot) {}
}

export class Foot {
  phase: FootPhase = 'air';
  /** Pelvis-local xz of the ankle. */
  readonly center = new THREE.Vector2();
  /** Foot yaw relative to the pelvis (0 = pelvis forward). */
  yaw = 0;
  /** Heel, inner toe, outer toe. */
  readonly points: ContactPoint[];
  /** Per-leg length change (m): negative right after touchdown (soft landing), relaxes to 0. */
  legOffset = 0;
  legOffsetRate = 0;
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
    const hw = GEOM.footHalfWidth;
    this.points = [
      new ContactPoint(s + 'heel', GEOM.heel, 0, this),
      new ContactPoint(s + 'toeI', GEOM.toe, -side * hw, this),
      new ContactPoint(s + 'toeO', GEOM.toe, side * hw, this),
    ];
  }
  get inContact(): boolean { return this.points.some((p) => p.state !== 'air'); }
  get slipping(): boolean { return this.points.some((p) => p.state === 'slip'); }
}

export interface SlipEvent { pos: THREE.Vector3; speed: number; N: number; material: string }

const tmpQ = new THREE.Quaternion();
const tmpQi = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpImp = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class FootSystem {
  readonly feet: [Foot, Foot] = [new Foot(-1), new Foot(1)];
  /** World horizontal velocity the stance legs sweep the body at (leg drive). */
  readonly driveVel = new THREE.Vector3();
  /** Extra leg length (m) commanded by the controller, e.g. jump extension. */
  legExtension = 0;
  legExtensionRate = 0;
  /** Ankle lean target (world horizontal, rad per axis: x = lean toward +x, z = toward +z). */
  readonly ankleLean = new THREE.Vector2();
  /** Same in the body's heading frame (set each substep). */
  private readonly leanLocal = new THREE.Vector2();
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

  get soleDepth(): number { return this.tun.legLength; }

  /** Compute body-local sole setpoints of a foot. */
  updateLocal(foot: Foot): void {
    const s = Math.sin(foot.yaw), c = Math.cos(foot.yaw);
    const tx = Math.tan(this.leanLocal.x), tz = Math.tan(this.leanLocal.y);
    // forward = (sin, 0, cos), right = (-cos, 0, sin)
    for (const p of foot.points) {
      const x = foot.center.x + s * p.along - c * p.lat;
      const z = foot.center.y + c * p.along + s * p.lat;
      // ankle strategy: tilting the sole plane in the body frame makes the planted feet hold the
      // body leaned (loads toes or heels, i.e. moves the centre of pressure). Bounded by the foot.
      p.local.set(x, -this.soleDepth - this.legExtension - foot.legOffset + tx * x + tz * z, z);
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

    // ankle lean into the heading frame
    {
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      // world -> heading-local: rotate by -yaw about +Y
      this.leanLocal.set(cy * this.ankleLean.x - sy * this.ankleLean.y, sy * this.ankleLean.x + cy * this.ankleLean.y);
    }
    // Leg drive in pelvis-local coordinates (horizontal).
    const localDrive = tmpD.copy(this.driveVel).applyQuaternion(tmpQi);

    let contactCount = 0;
    const contactPoints: ContactPoint[] = [];

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
        contactPoints.push(cp);
        cp.depth = Math.min(depth, 0.05);
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
          // Soft touchdown (knee compliance): shorten this leg so the sole just touches, then let
          // it extend back to full length. Without it a foot landing under a moving body would
          // start out centimetres deep and kick the body upward.
          const deepest = Math.max(...foot.points.filter((p) => p.state !== 'air').map((p) => p.depth));
          const shift = Math.max(0, deepest - 0.004);
          foot.legOffset = Math.max(-0.35, foot.legOffset - shift);
          for (const p of foot.points) {
            if (p.state === 'air') continue;
            p.depth -= shift;
            p.world.y += shift;
            if (p.depth <= 0) { p.state = 'air'; contactCount--; contactPoints.splice(contactPoints.indexOf(p), 1); }
          }
        } else {
          foot.noContactTime += dt;
          // reach for the ground: a foot that finished its swing in the air extends its leg
          if (!this.legsDisabled) foot.legOffset = Math.min(0.25, foot.legOffset + 1.5 * dt);
        }
      }
      if (foot.phase === 'stance') {
        // quasi-static re-extension (not fed into the damper, so it does not kick)
        const d = THREE.MathUtils.clamp(-foot.legOffset, -0.3 * dt, 0.3 * dt);
        foot.legOffset += d;
        foot.legOffsetRate = d / dt;
      } else if (foot.phase === 'swing') { foot.legOffset = 0; foot.legOffsetRate = 0; }
    }

    // Explicit spring-dampers acting on a light pelvis 0.6 m above the contact are only stable
    // if their gains stay below what the body can absorb in one substep. Cap each point's gains
    // using the true effective mass of the pelvis at that point (conservative: ignores the
    // torso/sword, which only add mass).
    const n = Math.max(1, contactCount);
    const Iinv = pelvis.effectiveWorldInvInertia();
    const IinvM = new THREE.Matrix3().set(Iinv.m11, Iinv.m12, Iinv.m13, Iinv.m12, Iinv.m22, Iinv.m23, Iinv.m13, Iinv.m23, Iinv.m33);
    const invM = pelvis.invMass();
    const wAt = (r: THREE.Vector3, u: THREE.Vector3) => {
      const c = tmpImp.crossVectors(r, u);
      const ix = Iinv.m11 * c.x + Iinv.m12 * c.y + Iinv.m13 * c.z;
      const iy = Iinv.m12 * c.x + Iinv.m22 * c.y + Iinv.m23 * c.z;
      const iz = Iinv.m13 * c.x + Iinv.m23 * c.y + Iinv.m33 * c.z;
      return invM + c.x * ix + c.y * iy + c.z * iz;
    };
    for (const cp of contactPoints) {
      const r = tmpF.copy(cp.world).sub(pos);
      const wy = wAt(r, AXIS_Y);
      const cn = Math.min(tun.footNormalDamping, 0.6 / (wy * dt * n));
      const kn = Math.min(tun.footNormalStiffness, 0.3 / (wy * dt * dt * n));
      let N = kn * cp.depth - cn * cp.vel.y;
      if (!tun.cheatStickyFeet) N = Math.max(0, N);
      cp.N = N;
    }

    // Jump thrust: the legs push harder against the ground. Still a normal force at a contact.
    if (this.thrust > 0 && contactCount > 0) {
      const share = this.thrust / contactCount;
      for (const foot of this.feet) for (const cp of foot.points) if (cp.state !== 'air') cp.N += share;
    }

    // Normal forces first (impulses change the pelvis velocity immediately).
    withForceAuthority(() => {
      for (const cp of contactPoints) {
        tmpImp.set(0, cp.N * dt, 0);
        pelvis.applyImpulseAtPoint(tmpImp, cp.world, true);
      }
    });

    // Friction. Solved at the velocity level with sequential impulses (like an engine's contact
    // solver) so it is stable for a light pelvis with contacts 0.6 m below its COM:
    //  - stick: impulse that stops the point (plus a small pull back to its anchor), accumulated
    //    over a few Gauss-Seidel passes and clamped to the static cone mu_s·N·dt;
    //  - a stick point that hits its cone *and is actually moving* becomes a slip point;
    //  - slip: impulse mu_k·N·dt opposing the slip velocity; re-sticks only after the slip
    //    speed stays below restickSpeed for restickTime (hysteresis, no chatter).
    const stance = contactPoints.filter((cp) => cp.foot.phase === 'stance');
    const setVels = new Map<ContactPoint, THREE.Vector3>();
    for (const cp of stance) {
      const sv = new THREE.Vector3(-localDrive.x, 0, -localDrive.z).applyQuaternion(q);
      sv.y = 0;
      setVels.set(cp, sv);
      cp.J.set(0, 0, 0);
      cp.Neff = tun.cheatStickyFeet ? Math.abs(cp.N) + 1e4 : Math.max(cp.N, 0);
      this.totalN += cp.Neff;
    }
    const pointVel = (cp: ContactPoint, out: THREE.Vector3) => {
      const bv = pelvis.velocityAtPoint(cp.world);
      const sv = setVels.get(cp)!;
      return out.set(bv.x + sv.x, 0, bv.z + sv.z);
    };

    withForceAuthority(() => {
      for (const cp of stance) cp.forceMode = cp.state === 'slip' ? 'slip' : 'stick';
      // kinetic friction for slipping points
      for (const cp of stance) {
        if (cp.state !== 'slip') continue;
        const v = pointVel(cp, tmpV);
        const speed = v.length();
        cp.slipSpeed = speed;
        const jMax = cp.muK * cp.Neff * dt;
        if (speed > 1e-5) cp.J.copy(v).multiplyScalar(-jMax / speed);
        pelvis.applyImpulseAtPoint(cp.J, cp.world, true);
      }
      // Static friction as one block: a planar wrench (force a, twist b) over all sticking
      // points, shared in proportion to normal load:  j_i = w_i·a + b·w_i·(up × rho_i)
      // with w_i = N_i/ΣN and rho_i the offset from the centre of pressure. Solve the 3x3 system
      // that stops the patch (load-weighted mean velocity and twist rate), then clamp each point
      // to its own static cone. Load-proportional sharing means all points reach mu_s together.
      const sticks = stance.filter((cp) => cp.state === 'stick' && cp.Neff > 0);
      if (sticks.length) {
        const sumN = sticks.reduce((a, cp) => a + cp.Neff, 0);
        const cop = new THREE.Vector3();
        for (const cp of sticks) cop.addScaledVector(cp.world, cp.Neff / sumN);
        const w = sticks.map((cp) => cp.Neff / sumN);
        const rho = sticks.map((cp) => new THREE.Vector3(cp.world.x - cop.x, 0, cp.world.z - cop.z));
        const tw = rho.map((r) => new THREE.Vector3(-r.z, 0, r.x)); // up × rho
        let rhoScale = 0;
        for (let i = 0; i < sticks.length; i++) rhoScale += w[i] * rho[i].lengthSq();
        rhoScale = Math.max(rhoScale, 1e-4);
        // patch measure of a set of point velocities: [mean vx, mean vz, twist rate]
        const measure = (vel: THREE.Vector3[], bias: boolean) => {
          const m = new THREE.Vector3();
          for (let i = 0; i < sticks.length; i++) {
            const cp = sticks[i];
            let vx = vel[i].x, vz = vel[i].z;
            if (bias) { vx += (cp.world.x - cp.anchor.x) / tun.stickBiasTime; vz += (cp.world.z - cp.anchor.z) / tun.stickBiasTime; }
            m.x += w[i] * vx; m.y += w[i] * vz;
            m.z += w[i] * (rho[i].x * vz - rho[i].z * vx) / rhoScale;
          }
          return m;
        };
        // body velocity response to a set of point impulses
        const respond = (js: THREE.Vector3[]) => {
          const P = new THREE.Vector3(), L = new THREE.Vector3();
          for (let i = 0; i < sticks.length; i++) {
            P.add(js[i]);
            L.add(new THREE.Vector3().crossVectors(tmpF.copy(sticks[i].world).sub(pos), js[i]));
          }
          const dv = P.multiplyScalar(invM), dw = L.applyMatrix3(IinvM);
          return sticks.map((cp) => dw.clone().cross(tmpF.copy(cp.world).sub(pos)).add(dv));
        };
        const impulses = (a: THREE.Vector3) => sticks.map((_, i) =>
          new THREE.Vector3(w[i] * a.x, 0, w[i] * a.y).addScaledVector(tw[i], w[i] * a.z));
        const A = new THREE.Matrix3();
        const cols = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
          .map((e) => measure(respond(impulses(e)), false));
        A.set(cols[0].x, cols[1].x, cols[2].x, cols[0].y, cols[1].y, cols[2].y, cols[0].z, cols[1].z, cols[2].z);
        const vNow = sticks.map((cp) => pointVel(cp, new THREE.Vector3()));
        const need = measure(vNow, true).negate();
        const a = need.applyMatrix3(A.invert());
        const js = impulses(a);
        for (let i = 0; i < sticks.length; i++) {
          const cp = sticks[i];
          const lim = cp.muS * cp.Neff * dt;
          cp.clamped = js[i].length() > lim;
          if (cp.clamped) js[i].setLength(lim);
          cp.J.copy(js[i]);
          pelvis.applyImpulseAtPoint(js[i], cp.world, true);
        }
        for (const cp of sticks) {
          const v = pointVel(cp, tmpV);
          cp.slipSpeed = 0;
          // saturated *and* actually moving: the static cone has been exceeded -> slip
          if (cp.clamped && v.length() > tun.restickSpeed * 0.25) { cp.state = 'slip'; cp.slowTime = 0; }
        }
      }
    });

    for (const cp of stance) {
      cp.force.copy(cp.J).divideScalar(dt);
      const lim = (cp.forceMode === 'stick' ? cp.muS : cp.muK) * cp.Neff;
      cp.usage = lim > 0 ? cp.force.length() / lim : 0;
      if (cp.state === 'slip') {
        cp.anchor.set(cp.world.x, cp.groundY, cp.world.z);
        this.slipEvents.push({ pos: cp.world.clone().setY(cp.groundY), speed: cp.slipSpeed, N: cp.Neff, material: cp.material });
        if (cp.slipSpeed < tun.restickSpeed) {
          cp.slowTime += dt;
          if (cp.slowTime >= tun.restickTime) cp.state = 'stick';
        } else cp.slowTime = 0;
      }
    }
    // Leg strength: the drive may not wind a planted leg further than legMaxStretch.
    for (const foot of this.feet) if (foot.phase === 'stance') this.limitWindup(foot, q);
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
      const a = foot.points[0];
      const bw = tmpD.copy(foot.points[1].world).add(foot.points[2].world).multiplyScalar(0.5);
      const t = -GEOM.heel / (GEOM.toe - GEOM.heel);
      const w = tmpP.copy(a.world).lerp(bw, t);
      const planted = foot.points.filter((p) => p.state !== 'air');
      if (foot.phase === 'stance' && planted.length) {
        // planted foot is drawn where its contacts are anchored (offset from the sole setpoint)
        const off = new THREE.Vector3();
        for (const p of planted) off.add(p.anchor).sub(p.world);
        off.divideScalar(planted.length);
        const gy = Math.max(...planted.map((p) => p.groundY));
        foot.worldPos.set(w.x + off.x, gy, w.z + off.z);
      } else {
        foot.worldPos.copy(w);
      }
      foot.lift = 0;
      const dir = tmpF.copy(bw).sub(a.world);
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
