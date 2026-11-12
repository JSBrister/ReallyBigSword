/**
 * FOOT–GROUND CONTACT MODEL. One of exactly two modules allowed to push on player bodies.
 *
 * The legs are massless struts hanging from the hip (the warrior body's origin). They keep an
 * upright stance frame that turns with the body's heading, so the torso can rock on its hips
 * while the feet stay planted. Each foot has a heel and two toe contact points.
 *
 *  - Normal force: per-point spring-damper on how far the sole setpoint has sunk below the
 *    ground found by a downward raycast (leg compression). N >= 0 (feet cannot pull).
 *  - Friction: solved at the velocity level as one load-shared planar wrench over all sticking
 *    points (force + twist), each point clamped to mu_s·N. A saturated point that actually
 *    moves becomes a slipping point with mu_k·N opposing its slip velocity, and re-sticks only
 *    after the slip speed stays below restickSpeed for restickTime (hysteresis, no chatter).
 *    Twisting resistance comes from the points being apart, so it is friction limited too.
 *  - Tilting moment: the ground reaction acts at a centre of pressure (CoP). The balance
 *    controller asks for a hip torque; the CoP is placed to deliver it, but it can never leave
 *    the support polygon of the planted contacts and the torque never exceeds the hip strength.
 *
 * The body receives exactly the resultant of these contact forces: the total force at the hip
 * plus its moment about the hip (CoP lever arm, plus the friction twist). The ground is static
 * world geometry, so these are honest external forces.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world';
import { GROUP, groups } from '../world';
import type { Tunables } from '../tunables';
import { withForceAuthority } from '../forceGuard';
import { v3, q4, convexHullXZ, clampToPolygon, UP } from '../mathUtil';
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

const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpF = new THREE.Vector3();

export class FootSystem {
  readonly feet: [Foot, Foot] = [new Foot(-1), new Foot(1)];
  /** World horizontal velocity the stance legs sweep the body at (leg drive). */
  readonly driveVel = new THREE.Vector3();
  /** Extra leg length (m) commanded by the controller, e.g. jump extension. */
  legExtension = 0;
  legExtensionRate = 0;
  /** Extra total leg thrust (N) this substep, shared by contact points. Used for jumping. */
  thrust = 0;
  /** Hip torque the balance controller asks for (world, horizontal), before CoP/strength limits. */
  readonly hipTorqueTarget = new THREE.Vector3();
  /** Tilting moment actually delivered through the feet this substep (world). */
  readonly hipTorque = new THREE.Vector3();
  /** Centre of pressure (world, on the ground) this substep. */
  readonly cop = new THREE.Vector3();
  /** Stance frame: heading only (the legs stay under the hips whatever the torso does). */
  readonly frameQ = new THREE.Quaternion();
  frameYaw = 0;
  /** Legs cannot get under the body (it is upside down). */
  legsDisabled = false;
  /** True on the substep the legs become usable again (controller re-plants feet). */
  regained = false;
  slipEvents: SlipEvent[] = [];
  totalN = 0;
  private ray: RAPIER.Ray;
  private readonly rayGroups = groups(0xffff, GROUP.GROUND);

  constructor(private pw: PhysicsWorld, private tun: Tunables, private body: RAPIER.RigidBody) {
    this.ray = new pw.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.updateFrame();
  }

  /** Sole setpoint below the hip: the legs stand slightly bent, with legTravel of push left. */
  get soleDepth(): number { return this.tun.legLength + this.tun.legTravel; }

  /** Stance frame (heading only) for this substep; legs are unusable while upside down. */
  updateFrame(): void {
    const q = q4(this.body.rotation());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let hx = fwd.x, hz = fwd.z;
    if (Math.hypot(hx, hz) < 0.25) { hx = up.x * Math.sign(-fwd.y || 1); hz = up.z * Math.sign(-fwd.y || 1); }
    if (Math.hypot(hx, hz) > 1e-6) this.frameYaw = Math.atan2(hx, hz);
    this.frameQ.setFromAxisAngle(UP, this.frameYaw);
    const wasDisabled = this.legsDisabled;
    this.legsDisabled = up.y < -0.3;
    this.regained = wasDisabled && !this.legsDisabled;
    if (this.regained || (!wasDisabled && this.legsDisabled)) {
      for (const f of this.feet) { f.phase = 'air'; f.noContactTime = 0; f.legOffset = 0; for (const p of f.points) p.state = 'air'; }
    }
  }

  /** Stance-frame sole setpoints of a foot. */
  updateLocal(foot: Foot): void {
    const s = Math.sin(foot.yaw), c = Math.cos(foot.yaw);
    // forward = (sin, 0, cos), right = (-cos, 0, sin)
    for (const p of foot.points) {
      p.local.set(foot.center.x + s * p.along - c * p.lat, -this.soleDepth - this.legExtension - foot.legOffset,
        foot.center.y + c * p.along + s * p.lat);
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
    this.hipTorque.set(0, 0, 0);
    this.applyLegs(dt);
  }

  private applyLegs(dt: number): void {
    const tun = this.tun;
    const body = this.body;
    const hip = v3(body.translation(), new THREE.Vector3());
    const q = this.frameQ;
    const qi = q.clone().invert();
    const vHip = v3(body.velocityAtPoint(hip), new THREE.Vector3());
    const wy = body.angvel().y;
    const invM = body.invMass();
    const Iinv = body.effectiveWorldInvInertia();
    const localDrive = this.driveVel.clone().applyQuaternion(qi);

    const contacts: ContactPoint[] = [];
    for (const foot of this.feet) {
      foot.justLanded = false;
      if (foot.phase === 'stance') {
        foot.center.x -= localDrive.x * dt;
        foot.center.y -= localDrive.z * dt;
      }
      this.updateLocal(foot);
      let anyContact = false;
      const footContacts: ContactPoint[] = [];
      for (const cp of foot.points) {
        cp.world.copy(cp.local).applyQuaternion(q).add(hip);
        const r = tmpP.copy(cp.world).sub(hip);
        // points move with the hip, the body's yaw rate and the leg setpoint motion
        cp.vel.set(vHip.x + wy * r.z, vHip.y, vHip.z - wy * r.x); // + (0,wy,0) × r
        if (foot.phase === 'stance') cp.vel.add(tmpV.set(-localDrive.x, 0, -localDrive.z).applyQuaternion(q));
        cp.vel.y -= this.legExtensionRate;
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
        cp.depth = Math.min(depth, this.tun.legTravel + 0.1);
        footContacts.push(cp);
      }
      if (foot.phase === 'stance') {
        foot.noContactTime = anyContact ? 0 : foot.noContactTime + dt;
        // a planted leg that is lifted off the ground straightens to keep pushing
        if (!anyContact && !this.legsDisabled && this.thrust === 0) foot.legOffset = Math.min(0.2, foot.legOffset + 2.5 * dt);
        if (foot.noContactTime > 0.1) foot.phase = 'air';
      } else if (foot.phase === 'air') {
        if (anyContact) {
          foot.phase = 'stance';
          foot.justLanded = true;
          foot.noContactTime = 0;
          // Soft touchdown (knee compliance): shorten this leg so the sole just touches, then let
          // it extend back to full length. Without it a foot landing under a moving or kneeling
          // body would start out centimetres (or decimetres) deep and kick the body away.
          const deepest = Math.max(...footContacts.map((p) => g0(p)));
          const shift = Math.max(0, deepest - 0.004);
          foot.legOffset = Math.max(-0.8, foot.legOffset - shift);
          for (const p of footContacts) {
            const d = (p.groundY - p.world.y) - shift;
            p.world.y += shift;
            p.depth = Math.min(d, 0.05);
            if (d <= 0) p.state = 'air';
          }
        } else {
          foot.noContactTime += dt;
          // reach for the ground: a foot that finished its swing in the air extends its leg
          if (!this.legsDisabled) foot.legOffset = Math.min(0.25, foot.legOffset + 1.5 * dt);
        }
      }
      if (foot.phase === 'stance') {
        // quasi-static re-extension after a soft landing (the legs push the hips back up)
        const d = THREE.MathUtils.clamp(-foot.legOffset, -0.35 * dt, 0.35 * dt);
        foot.legOffset += d;
        foot.legOffsetRate = d / dt;
      } else if (foot.phase === 'swing') { foot.legOffset = 0; foot.legOffsetRate = 0; }
      for (const p of footContacts) if (p.state !== 'air') contacts.push(p);
    }

    // Normal forces: leg compression springs. Gains capped by what the body can absorb.
    const n = Math.max(1, contacts.length);
    const cn = Math.min(tun.footNormalDamping, 0.6 / (invM * dt * n));
    const kn = Math.min(tun.footNormalStiffness, 0.3 / (invM * dt * dt * n));
    for (const cp of contacts) {
      let N = kn * cp.depth - cn * cp.vel.y;
      if (!tun.cheatStickyFeet) N = Math.max(0, N);
      cp.N = N;
    }
    if (this.thrust > 0 && contacts.length > 0) {
      const share = this.thrust / contacts.length;
      for (const cp of contacts) cp.N += share;
    }

    const stance = contacts.filter((cp) => cp.foot.phase === 'stance');
    let Ntot = 0;
    for (const cp of stance) {
      cp.Neff = tun.cheatStickyFeet ? Math.abs(cp.N) + 1e4 : Math.max(cp.N, 0);
      cp.J.set(0, 0, 0);
      Ntot += cp.Neff;
      cp.forceMode = cp.state === 'slip' ? 'slip' : 'stick';
    }
    this.totalN = Ntot;
    if (stance.length === 0 || Ntot <= 0) { this.updateVisual(); return; }

    // --- friction ---
    // Response of the contact points to friction impulses: they move with the hip (whole-body
    // translation) and with the body's yaw (the stance frame turns with the heading).
    const Iyy = Iinv.m22;
    const respond = (js: THREE.Vector3[], pts: ContactPoint[]) => {
      const P = new THREE.Vector3();
      let My = 0;
      for (let i = 0; i < pts.length; i++) {
        P.add(js[i]);
        const r = tmpP.copy(pts[i].world).sub(hip);
        My += r.z * js[i].x - r.x * js[i].z;
      }
      const dv = P.multiplyScalar(invM);
      const dw = Iyy * My;
      return pts.map((cp) => {
        const r = tmpP.copy(cp.world).sub(hip);
        return new THREE.Vector3(dv.x + dw * r.z, 0, dv.z - dw * r.x);
      });
    };
    const curVel = stance.map((cp) => new THREE.Vector3(cp.vel.x, 0, cp.vel.z));
    const addVel = (dvs: THREE.Vector3[], pts: ContactPoint[]) => pts.forEach((cp, i) => curVel[stance.indexOf(cp)].add(dvs[i]));

    // kinetic friction for slipping points
    const slips = stance.filter((cp) => cp.state === 'slip');
    for (const cp of slips) {
      const v = curVel[stance.indexOf(cp)];
      const speed = v.length();
      cp.slipSpeed = speed;
      if (speed > 1e-5) cp.J.copy(v).multiplyScalar(-cp.muK * cp.Neff * dt / speed);
    }
    if (slips.length) addVel(respond(slips.map((c) => c.J), slips), slips);

    // static friction as one block: planar wrench (a: force, b: twist) shared by load
    const sticks = stance.filter((cp) => cp.state === 'stick' && cp.Neff > 0);
    if (sticks.length) {
      const sumN = sticks.reduce((a, cp) => a + cp.Neff, 0);
      const c0 = new THREE.Vector3();
      for (const cp of sticks) c0.addScaledVector(cp.world, cp.Neff / sumN);
      const w = sticks.map((cp) => cp.Neff / sumN);
      const rho = sticks.map((cp) => new THREE.Vector3(cp.world.x - c0.x, 0, cp.world.z - c0.z));
      const tw = rho.map((r) => new THREE.Vector3(-r.z, 0, r.x)); // up × rho
      let rs = 0;
      for (let i = 0; i < sticks.length; i++) rs += w[i] * rho[i].lengthSq();
      rs = Math.max(rs, 1e-4);
      const measure = (vel: THREE.Vector3[], bias: boolean) => {
        const m = new THREE.Vector3();
        for (let i = 0; i < sticks.length; i++) {
          const cp = sticks[i];
          let vx = vel[i].x, vz = vel[i].z;
          if (bias) { vx += (cp.world.x - cp.anchor.x) / tun.stickBiasTime; vz += (cp.world.z - cp.anchor.z) / tun.stickBiasTime; }
          m.x += w[i] * vx; m.y += w[i] * vz;
          m.z += w[i] * (rho[i].x * vz - rho[i].z * vx) / rs;
        }
        return m;
      };
      const impulses = (a: THREE.Vector3) => sticks.map((_, i) =>
        new THREE.Vector3(w[i] * a.x, 0, w[i] * a.y).addScaledVector(tw[i], w[i] * a.z));
      const cols = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
        .map((e) => measure(respond(impulses(e), sticks), false));
      const A = new THREE.Matrix3().set(cols[0].x, cols[1].x, cols[2].x, cols[0].y, cols[1].y, cols[2].y, cols[0].z, cols[1].z, cols[2].z);
      const vNow = sticks.map((cp) => curVel[stance.indexOf(cp)]);
      const a = measure(vNow, true).negate().applyMatrix3(A.invert());
      const js = impulses(a);
      for (let i = 0; i < sticks.length; i++) {
        const cp = sticks[i];
        const lim = cp.muS * cp.Neff * dt;
        cp.clamped = js[i].length() > lim;
        if (cp.clamped) js[i].setLength(lim);
        cp.J.copy(js[i]);
      }
      addVel(respond(js, sticks), sticks);
      for (const cp of sticks) {
        cp.slipSpeed = 0;
        // saturated *and* actually moving: the static cone has been exceeded -> slip
        if (cp.clamped && curVel[stance.indexOf(cp)].length() > tun.restickSpeed * 0.25) { cp.state = 'slip'; cp.slowTime = 0; }
      }
    }

    // --- resultant wrench about the hip ---
    const Ft = new THREE.Vector3();
    let Myaw = 0;
    let groundY = 0;
    for (const cp of stance) {
      Ft.add(cp.J);
      const r = tmpP.copy(cp.world).sub(hip);
      Myaw += r.z * cp.J.x - r.x * cp.J.z;
      groundY += cp.groundY * cp.Neff / Ntot;
    }
    Ft.divideScalar(dt);
    Myaw /= dt;
    const L = hip.y - groundY; // hip height above the contact plane
    // CoP offset d (horizontal, from the hip) so that the moment about the hip equals the request:
    //   M = d × (N·up) + (-L·up) × Ft   =>   d × (N·up) = tau + L·(up × Ft)
    const tau = this.hipTorqueTarget;
    const m = new THREE.Vector3(tau.x, 0, tau.z).add(new THREE.Vector3(Ft.z, 0, -Ft.x).multiplyScalar(L));
    const want = { x: hip.x + m.z / Ntot, z: hip.z - m.x / Ntot };
    const poly = convexHullXZ(stance.map((cp) => ({ x: cp.anchor.x, z: cp.anchor.z })));
    const copXZ = clampToPolygon(want, poly);
    this.cop.set(copXZ.x, groundY, copXZ.z);
    const d = new THREE.Vector3(copXZ.x - hip.x, 0, copXZ.z - hip.z);
    const M = new THREE.Vector3(-d.z * Ntot, 0, d.x * Ntot).add(new THREE.Vector3(-Ft.z, 0, Ft.x).multiplyScalar(L));
    this.hipTorque.copy(M);
    M.y += Myaw;

    withForceAuthority(() => {
      body.applyImpulseAtPoint({ x: Ft.x * dt, y: Ntot * dt, z: Ft.z * dt }, hip, true);
      body.applyTorqueImpulse({ x: M.x * dt, y: M.y * dt, z: M.z * dt }, true);
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
    for (const foot of this.feet) if (foot.phase === 'stance') this.limitWindup(foot);
    this.updateVisual();
  }

  private limitWindup(foot: Foot): void {
    let n = 0;
    const s = new THREE.Vector3();
    for (const cp of foot.points) {
      if (cp.state !== 'stick') continue;
      s.x += cp.world.x - cp.anchor.x; s.z += cp.world.z - cp.anchor.z; n++;
    }
    if (!n) return;
    s.divideScalar(n);
    const len = s.length();
    const max = this.tun.legMaxStretch;
    if (len <= max) return;
    s.multiplyScalar(-(1 - max / len));
    const local = s.applyQuaternion(this.frameQ.clone().invert());
    foot.center.x += local.x;
    foot.center.y += local.z;
  }

  /** Ankle positions for rendering & IK. */
  private updateVisual(): void {
    for (const foot of this.feet) {
      if (foot.phase === 'swing') continue; // controller writes swing visuals
      const a = foot.points[0];
      const bw = tmpF.copy(foot.points[1].world).add(foot.points[2].world).multiplyScalar(0.5);
      const t = -GEOM.heel / (GEOM.toe - GEOM.heel);
      const w = tmpV.copy(a.world).lerp(bw, t);
      const planted = foot.points.filter((p) => p.state !== 'air');
      if (foot.phase === 'stance' && planted.length) {
        const off = new THREE.Vector3();
        for (const p of planted) off.add(p.anchor).sub(p.world);
        off.divideScalar(planted.length);
        const gy = Math.max(...planted.map((p) => p.groundY));
        foot.worldPos.set(w.x + off.x, gy, w.z + off.z);
      } else {
        foot.worldPos.copy(w);
      }
      foot.lift = 0;
      foot.worldYaw = Math.atan2(bw.x - a.world.x, bw.z - a.world.z);
    }
  }
}

/** Depth helper for touchdown. */
function g0(p: ContactPoint): number { return p.groundY - p.world.y; }

