import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { makeSandbox } from './helpers';
import { ForceSourceViolation } from '../src/physics/forceGuard';

const ROOT = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The only modules allowed to push on player bodies. */
const PLAYER_FORCE_MODULES = ['physics/player/actuators.ts', 'physics/player/feet.ts'];
/** Modules that may apply forces, but only to non-player bodies (enemies, debris). */
const NON_PLAYER_FORCE_MODULES = ['physics/goblin.ts', 'game/debris.ts'];
const FORCE_CALL = /\.(applyImpulse|applyImpulseAtPoint|addForce|addForceAtPoint|addTorque|applyTorqueImpulse)\s*\(/;
const MOTOR_CALL = /(jointConfigureMotor\w*|jointSetMotorMaxForce|configureMotor\w*|setMotorMaxForce)\s*\(/;

describe('force-source lint', () => {
  const all = files(ROOT);

  it('force/impulse/torque calls appear only in the allowed modules', () => {
    const bad: string[] = [];
    for (const f of all) {
      const src = stripComments(readFileSync(f, 'utf8'));
      src.split('\n').forEach((line, i) => {
        if (FORCE_CALL.test(line) && ![...PLAYER_FORCE_MODULES, ...NON_PLAYER_FORCE_MODULES].includes(rel(f))) {
          bad.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it('joint motors (internal actuators) are configured only in actuators.ts', () => {
    const bad = all.filter((f) => rel(f) !== 'physics/player/actuators.ts' && MOTOR_CALL.test(stripComments(readFileSync(f, 'utf8'))));
    expect(bad.map(rel)).toEqual([]);
  });

  it('force authority is opened only by actuators.ts and feet.ts', () => {
    const bad = all.filter((f) => rel(f) !== 'physics/forceGuard.ts' && !PLAYER_FORCE_MODULES.includes(rel(f))
      && /withForceAuthority\s*\(/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(bad.map(rel)).toEqual([]);
  });

  it('non-player force modules never reference the player', () => {
    for (const m of NON_PLAYER_FORCE_MODULES) {
      let src = '';
      try { src = stripComments(readFileSync(join(ROOT, m), 'utf8')); } catch { continue; }
      expect(/\bplayer\.(pelvis|torso|sword)\b/.test(src), m).toBe(false);
    }
  });

  it('runtime guard: pushing a player body from outside the allowed modules throws', async () => {
    const { player } = await makeSandbox();
    expect(() => player.pelvis.applyImpulse(new THREE.Vector3(100, 0, 0), true)).toThrow(ForceSourceViolation);
    expect(() => player.sword.addTorque(new THREE.Vector3(0, 100, 0), true)).toThrow(ForceSourceViolation);
    expect(() => player.torso.setLinvel(new THREE.Vector3(0, 9, 0), true)).toThrow(ForceSourceViolation);
  });

  it('runtime guard: a full simulated second of play never trips the guard', async () => {
    const { player, run, cmd } = await makeSandbox();
    cmd.move.set(0, 0, 1);
    cmd.swingYaw = 6;
    expect(() => run(1)).not.toThrow();
    expect(player.bodies.length).toBe(2);
  });
});
