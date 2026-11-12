/**
 * Detects sword impacts and measures them honestly: the relative *normal* speed of the sword and
 * the thing it hit at the contact point, using velocities from before the solver resolved the
 * collision. Reads contacts only; applies no forces.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './world';
import { v3 } from './mathUtil';

export interface Impact {
  point: THREE.Vector3;
  /** Unit normal pointing from the sword into the other collider. */
  normal: THREE.Vector3;
  /** Relative approach speed along the normal (m/s, >0 = closing). */
  normalSpeed: number;
  /** Full relative speed at the contact point. */
  relSpeed: number;
  /** Velocity of the sword point relative to the other body (world). */
  relVel: THREE.Vector3;
  other: RAPIER.Collider;
  otherBody: RAPIER.RigidBody | null;
}

interface Snap { lin: THREE.Vector3; ang: THREE.Vector3; com: THREE.Vector3 }

function snap(b: RAPIER.RigidBody, out?: Snap): Snap {
  const s = out ?? { lin: new THREE.Vector3(), ang: new THREE.Vector3(), com: new THREE.Vector3() };
  v3(b.linvel(), s.lin); v3(b.angvel(), s.ang); v3(b.worldCom(), s.com);
  return s;
}
const velAt = (s: Snap, p: THREE.Vector3) => s.ang.clone().cross(p.clone().sub(s.com)).add(s.lin);

export class ImpactDetector {
  impacts: Impact[] = [];
  private prevPairs = new Set<string>();
  private swordSnap: Snap | null = null;
  private snaps = new Map<number, Snap>();
  private tracked = new Set<RAPIER.RigidBody>();

  constructor(private pw: PhysicsWorld, private sword: () => RAPIER.RigidBody, private swordColliders: () => RAPIER.Collider[]) {}

  /** Bodies whose pre-step velocity should be remembered (enemies, debris). */
  track(b: RAPIER.RigidBody): void { this.tracked.add(b); }
  untrack(b: RAPIER.RigidBody): void { this.tracked.delete(b); this.snaps.delete(b.handle); }

  pre(): void {
    this.swordSnap = snap(this.sword(), this.swordSnap ?? undefined);
    for (const b of this.tracked) {
      if (!b.isValid()) { this.tracked.delete(b); continue; }
      this.snaps.set(b.handle, snap(b, this.snaps.get(b.handle)));
    }
  }

  post(): void {
    this.impacts = [];
    const world = this.pw.world;
    const pairs = new Set<string>();
    for (const sc of this.swordColliders()) {
      world.contactPairsWith(sc, (other) => {
        world.contactPair(sc, other, (m, flipped) => {
          const nc = m.numSolverContacts();
          if (nc === 0) return;
          const key = `${sc.handle}:${other.handle}`;
          pairs.add(key);
          if (this.prevPairs.has(key)) return; // only the moment of impact
          const point = new THREE.Vector3();
          for (let i = 0; i < nc; i++) point.add(v3(m.solverContactPoint(i)!));
          point.divideScalar(nc);
          const normal = v3(m.normal());
          if (flipped) normal.negate(); // make it sword -> other
          const otherBody = other.parent();
          const vs = velAt(this.swordSnap!, point);
          const os = otherBody ? this.snaps.get(otherBody.handle) : undefined;
          const vo = os ? velAt(os, point) : otherBody && otherBody.isDynamic() ? new THREE.Vector3().copy(v3(otherBody.linvel())) : new THREE.Vector3();
          const relVel = vs.sub(vo);
          this.impacts.push({
            point, normal, normalSpeed: relVel.dot(normal), relSpeed: relVel.length(), relVel,
            other, otherBody,
          });
        });
      });
    }
    this.prevPairs = pairs;
  }
}
