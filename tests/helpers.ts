import * as THREE from 'three';
import { initRapier } from '../src/physics/rapier';
import { PhysicsWorld } from '../src/physics/world';
import { makeTunables, type Tunables } from '../src/physics/tunables';
import { Player, emptyCommand, type PlayerCommand, type SpawnOptions } from '../src/physics/player/player';

export async function makeSandbox(over: Partial<Tunables> = {}, spawn: Partial<SpawnOptions> = {}) {
  const R = await initRapier();
  const tun = makeTunables(over);
  const pw = new PhysicsWorld(R, tun);
  pw.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(50, 0.5, 50));
  const player = new Player(pw, tun, { position: new THREE.Vector3(0, 0, 0), ...spawn });
  const cmd: PlayerCommand = emptyCommand();
  pw.hooks.push({ pre: (dt) => player.preStep(dt, cmd), post: (dt) => player.postStep(dt) });
  const run = (seconds: number, each?: (t: number) => void) => {
    const n = Math.round(seconds / pw.substepDt);
    for (let i = 0; i < n; i++) { pw.substep(); each?.(pw.time); }
  };
  return { R, tun, pw, player, cmd, run };
}
