import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Rapier } from './rapier';
import type { Tunables } from './tunables';

/** Collision group bits. Interaction groups are (membership << 16) | filter. */
export const GROUP = {
  GROUND: 0x0001,
  PLAYER: 0x0002,
  SWORD: 0x0004,
  ENEMY: 0x0008,
  SHIELD: 0x0010,
  DEBRIS: 0x0020,
  DOOR: 0x0040,
} as const;
export const ALL_GROUPS = 0xffff;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export type MaterialKind = 'stone' | 'slick' | 'shield' | 'flesh' | 'wood';
export interface Material { kind: MaterialKind; muS?: number; muK?: number }

export interface StepHooks {
  pre(dt: number): void;
  post(dt: number): void;
}

/**
 * Thin wrapper around the Rapier world: fixed timestep with substeps, ground materials
 * (looked up by collider handle).
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly materials = new Map<number, Material>();
  readonly events: RAPIER.EventQueue;
  hooks: StepHooks[] = [];
  time = 0;
  private accumulator = 0;
  substepDt: number;

  constructor(readonly R: Rapier, readonly tun: Tunables) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.substepDt = 1 / (60 * tun.substeps);
    this.world.timestep = this.substepDt;
    this.world.integrationParameters.numSolverIterations = 8;
    this.events = new R.EventQueue(true);
  }

  /** Friction coefficients for a ground collider. Stone follows the live tunables. */
  frictionOf(colliderHandle: number): { muS: number; muK: number; kind: MaterialKind } {
    const m = this.materials.get(colliderHandle);
    if (!m || m.kind === 'stone') return { muS: this.tun.muStatic, muK: this.tun.muKinetic, kind: 'stone' };
    if (m.kind === 'slick') return { muS: m.muS ?? 0.12, muK: m.muK ?? 0.06, kind: 'slick' };
    return { muS: m.muS ?? 0.6, muK: m.muK ?? 0.4, kind: m.kind };
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, material: Material = { kind: 'stone' },
    rot?: THREE.Quaternion): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(groups(GROUP.GROUND, ALL_GROUPS))
      .setFriction(material.kind === 'slick' ? 0.05 : 0.6)
      .setRestitution(0.05);
    if (rot) desc.setRotation(rot);
    const c = this.world.createCollider(desc);
    this.materials.set(c.handle, material);
    return c;
  }

  /** Advance one fixed substep. */
  substep(): void {
    const dt = this.substepDt;
    for (const h of this.hooks) h.pre(dt);
    this.world.step(this.events);
    this.time += dt;
    for (const h of this.hooks) h.post(dt);
  }

  /** Advance by real frame time (scaled), running whole 1/60 s frames of substeps. Returns substeps run. */
  advance(frameDt: number): number {
    const target = 1 / (60 * this.tun.substeps);
    if (Math.abs(target - this.substepDt) > 1e-12) { this.substepDt = target; this.world.timestep = target; }
    this.accumulator += Math.min(frameDt, 0.1) * this.tun.timeScale;
    let n = 0;
    while (this.accumulator >= this.substepDt && n < this.tun.substeps * 4) {
      this.substep();
      this.accumulator -= this.substepDt;
      n++;
    }
    if (n >= this.tun.substeps * 4) this.accumulator = 0;
    return n;
  }
}
