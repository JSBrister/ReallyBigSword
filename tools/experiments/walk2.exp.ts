import { it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from '../../tests/helpers';
async function trial(name: string, prog: (t: number) => THREE.Vector3, T = 8) {
  const sb = await makeSandbox(JSON.parse(process.env.OVER ?? '{}'));
  let fallenT = 0, firstFall = -1;
  sb.run(T, (t) => { sb.cmd.move.copy(prog(t)); if (sb.player.fallen) { fallenT += sb.pw.substepDt; if (firstFall < 0) firstFall = t; } });
  const p = sb.player.body.translation();
  console.log(name.padEnd(16), 'fallenT', fallenT.toFixed(2), 'firstFall', firstFall.toFixed(2), 'pos', p.x.toFixed(1), p.z.toFixed(1), 'steps', sb.player.gait.stepCount);
}
it('walk2', async () => {
  await trial('circle', (t) => new THREE.Vector3(Math.sin(t * 0.8), 0, Math.cos(t * 0.8)));
  await trial('reverse', (t) => new THREE.Vector3(0, 0, Math.floor(t / 1.5) % 2 ? -1 : 1));
  await trial('zigzag', (t) => new THREE.Vector3(Math.floor(t / 1) % 2 ? -1 : 1, 0, 1).normalize());
  await trial('back', () => new THREE.Vector3(0, 0, -1));
  await trial('stopgo', (t) => new THREE.Vector3(0, 0, Math.floor(t / 0.7) % 2 ? 0 : 1));
});
