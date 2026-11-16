import { it } from 'vitest';
import { runSession } from './session';
import { EXP } from '../../src/physics/player/technique';
import { withTeleportAuthority } from '../../src/physics/forceGuard';
// Empty-handed push recovery: let go of the sword, then a sideways / forward / backward shove.
it('push', async () => {
  EXP.emptyWalk = true;
  let line = '';
  for (const [vx, vz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [1.2, 0], [0.6, 0.6]]) {
    const r = await runSession(5, (t, c, sb) => {
      if (t < 0.01) sb.player.release();
      if (Math.abs(t - 1) < 0.001) withTeleportAuthority(() => sb.player.body.setLinvel({ x: vx, y: 0, z: vz }, true));
      c.move.set(0, 0, 0);
    });
    line += ` | ${vx},${vz}: falls ${r.falls} tilt ${r.maxTilt.toFixed(2)}`;
  }
  console.log('push' + line);
});
