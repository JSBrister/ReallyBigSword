import { it } from 'vitest';
import * as THREE from 'three';
import { makeSandbox } from '../../tests/helpers';
it('turn', async () => {
  for (const [name, sd] of [['upright', undefined], ['horizontal', new THREE.Vector3(0, 0.15, 1)]] as const) {
    const sb = await makeSandbox({}, { swordDir: sd as THREE.Vector3 | undefined });
    let fell = false;
    const yaws: string[] = [];
    sb.run(4, (t) => {
      sb.cmd.face = Math.PI * 0.75; sb.cmd.move.set(Math.sin(Math.PI * 0.75), 0, Math.cos(Math.PI * 0.75)).multiplyScalar(0.2);
      if (sb.player.fallen) fell = true;
      if (Math.abs(t % 0.5) < 0.0021) yaws.push(sb.player.feet.frameYaw.toFixed(2));
    });
    console.log(name, 'yaw over time', yaws.join(' '), 'fell', fell);
  }
});
