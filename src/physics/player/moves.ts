/**
 * Swing intent → what the actuators and legs are asked to do this substep.
 *
 * Applies no forces. It turns the player's input (a swing effort direction, grip, and optionally a
 * named attack) into an effort for the sword actuator plus a brace request for the legs. Bracing
 * happens for every swing: the legs crouch, widen and stagger the stance along the expected
 * reaction, and the hips stiffen. All of that still goes through the honest foot contact model.
 */
import * as THREE from 'three';

export type AttackName = 'slam' | 'sweepLeft' | 'sweepRight' | 'spin';

export interface MoveInput {
  /** x: + = swing right (clockwise seen from above), y: + = tip up. |effort| <= 1. */
  effort: THREE.Vector2;
  grip: boolean;
  /** Named attack requested this frame (edge), or null. */
  attack: AttackName | null;
  /** The spin attack lasts while this is held. */
  spinHeld: boolean;
}

export interface MoveOutput {
  effort: THREE.Vector2;
  grip: boolean;
  /** 0..1 how braced the legs should be. */
  brace: number;
  /** 'pitch': stagger the feet along the blade (slams). 'yaw': wide stance (sweeps, spins). */
  braceKind: 'pitch' | 'yaw';
}

interface Phase { name: string; until: (t: number, s: SwordState) => boolean; effort?: (s: SwordState) => [number, number]; grip?: boolean }
export interface SwordState {
  elevation: number; tipHeight: number; spinHeld: boolean;
  /** relative swing speed, rad/s */ relSpeed: number;
  /** highest relSpeed so far in the current phase (filled in by MoveController) */ peak: number;
  /** both feet planted, no step in progress */ planted: boolean;
  /** the blade is in contact with something */ touching: boolean;
}

const level = (s: SwordState): [number, number] =>
  s.elevation > 0.25 ? [0, -0.7] : s.elevation < -0.25 ? [0, 0.7] : [0, 0];

const ATTACKS: Record<AttackName, { kind: 'pitch' | 'yaw'; phases: Phase[] }> = {
  slam: {
    kind: 'pitch',
    phases: [
      { name: 'raise', effort: () => [0, 1], until: (t, s) => s.elevation > 1.2 || t > 0.8 },
      { name: 'set', grip: true, until: (t, s) => (t > 0.3 && s.planted) || t > 1.2 },
      // ends at the floor, on a stall (it hit something), or after 0.8 s
      { name: 'strike', effort: () => [0, -1], until: (t, s) => s.tipHeight < 0.45 || (t > 0.1 && s.touching) || t > 1.2 },
      // leave the blade where it landed (usually resting on the floor) and lean on it
      { name: 'plant', grip: true, until: (t) => t > 0.4 },
    ],
  },
  sweepLeft: {
    kind: 'yaw',
    phases: [
      { name: 'level', effort: level, until: (t, s) => Math.abs(s.elevation) < 0.25 || t > 0.7 },
      { name: 'set', grip: true, until: (t, s) => (t > 0.2 && s.planted) || t > 1.0 },
      { name: 'sweep', effort: () => [-1, 0], until: (t, s) => (t > 0.15 && s.touching) || t > 1.0 },
      { name: 'follow', until: (t) => t > 0.35 },
    ],
  },
  sweepRight: {
    kind: 'yaw',
    phases: [
      { name: 'level', effort: level, until: (t, s) => Math.abs(s.elevation) < 0.25 || t > 0.7 },
      { name: 'set', grip: true, until: (t, s) => (t > 0.2 && s.planted) || t > 1.0 },
      { name: 'sweep', effort: () => [1, 0], until: (t, s) => (t > 0.15 && s.touching) || t > 1.0 },
      { name: 'follow', until: (t) => t > 0.35 },
    ],
  },
  spin: {
    kind: 'yaw',
    phases: [
      { name: 'level', effort: level, until: (t, s) => Math.abs(s.elevation) < 0.25 || t > 0.7 },
      { name: 'spin', effort: () => [1, 0], until: (_t, s) => !s.spinHeld },
      { name: 'follow', until: (t) => t > 0.3 },
    ],
  },
};

export class MoveController {
  attack: AttackName | null = null;
  phase = 0;
  t = 0;
  private peak = 0;
  /** Seconds since the last swing effort (brace lingers a little). */
  private sinceEffort = 99;
  private braceKind: 'pitch' | 'yaw' = 'yaw';
  readonly out: MoveOutput = { effort: new THREE.Vector2(), grip: false, brace: 0, braceKind: 'yaw' };

  get phaseName(): string { return this.attack ? ATTACKS[this.attack].phases[this.phase]?.name ?? '' : ''; }

  update(dt: number, input: MoveInput, sword: SwordState, enabled: boolean): MoveOutput {
    const out = this.out;
    if (!enabled) { this.attack = null; out.effort.set(0, 0); out.grip = false; out.brace = 0; return out; }
    if (input.attack && !this.attack) { this.attack = input.attack; this.phase = 0; this.t = 0; this.peak = 0; }
    if (this.attack && input.grip) this.attack = null; // grip cancels a named attack
    if (this.attack) {
      const def = ATTACKS[this.attack];
      this.t += dt;
      this.peak = Math.max(this.peak, sword.relSpeed);
      sword.peak = this.peak;
      let ph = def.phases[this.phase];
      if (ph.until(this.t, sword)) {
        this.phase++; this.t = 0; this.peak = 0;
        ph = def.phases[this.phase];
      }
      if (!ph) { this.attack = null; } else {
        const e = ph.effort ? ph.effort(sword) : [0, 0];
        out.effort.set(e[0], e[1]);
        out.grip = !!ph.grip;
        out.brace = 1;
        out.braceKind = def.kind;
        this.braceKind = def.kind;
        this.sinceEffort = 0;
        return out;
      }
    }
    out.effort.copy(input.effort);
    if (out.effort.length() > 1) out.effort.normalize();
    out.grip = input.grip;
    const mag = out.effort.length();
    if (mag > 0.15) {
      this.sinceEffort = 0;
      this.braceKind = Math.abs(out.effort.y) > Math.abs(out.effort.x) ? 'pitch' : 'yaw';
    } else this.sinceEffort += dt;
    // brace for every swing, and for a moment after it
    out.brace = this.sinceEffort < 0.5 ? Math.max(mag, 0.6) : 0;
    out.braceKind = this.braceKind;
    return out;
  }
}
