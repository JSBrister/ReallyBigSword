/**
 * Runtime half of the force-source rule. Player bodies get their force/impulse/velocity
 * methods wrapped so they throw unless called while a force authority is active.
 * Only actuators.ts and feet.ts open force authority (checked by tests/forceLint.test.ts);
 * player.ts opens teleport authority for respawn, which may only zero/set velocities.
 */
import type RAPIER from '@dimforge/rapier3d-compat';

type Body = RAPIER.RigidBody;
const FORCE_METHODS = [
  'applyImpulse', 'applyImpulseAtPoint', 'addForce', 'addForceAtPoint', 'addTorque', 'applyTorqueImpulse',
] as const;
const VELOCITY_METHODS = ['setLinvel', 'setAngvel'] as const;

let forceDepth = 0;
let teleportDepth = 0;
const owner = new WeakMap<object, string>();

export function withForceAuthority<T>(fn: () => T): T {
  forceDepth++;
  try { return fn(); } finally { forceDepth--; }
}

export function withTeleportAuthority<T>(fn: () => T): T {
  teleportDepth++;
  try { return fn(); } finally { teleportDepth--; }
}

export class ForceSourceViolation extends Error {}

export function guardPlayerBody(body: Body, name: string): void {
  owner.set(body, name);
  const anyBody = body as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of FORCE_METHODS) {
    const orig = anyBody[m].bind(body);
    anyBody[m] = (...args: unknown[]) => {
      if (forceDepth === 0) {
        throw new ForceSourceViolation(`${m}() on player body '${name}' outside actuators.ts/feet.ts`);
      }
      return orig(...args);
    };
  }
  for (const m of VELOCITY_METHODS) {
    const orig = anyBody[m].bind(body);
    anyBody[m] = (...args: unknown[]) => {
      if (teleportDepth === 0) {
        throw new ForceSourceViolation(`${m}() on player body '${name}' outside respawn`);
      }
      return orig(...args);
    };
  }
}

export function isGuarded(body: Body): boolean { return owner.has(body); }
