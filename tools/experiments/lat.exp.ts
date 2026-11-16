import { it } from 'vitest';
import { runSession } from './session';
import { EXP } from '../../src/physics/player/technique';
import { withTeleportAuthority } from '../../src/physics/forceGuard';
it('lat', async () => {
  EXP.emptyWalk = true; let k = 0;
  await runSession(3.2, (t, c, sb) => {
    const pl = sb.player; const fe = pl.feet as any;
    if (t < 0.01) pl.release();
    if (Math.abs(t - 1) < 0.001) withTeleportAuthority(() => pl.body.setLinvel({ x: Number(process.env.VX ?? 1.2), y: 0, z: 0 }, true));
    c.move.set(0, 0, 0);
    if (t > 0.98 && k++ % 6 === 0) {
      const h = pl.body.translation();
      console.log(t.toFixed(3), 'vx', pl.body.linvel().x.toFixed(2), 'drv', fe.driveVel.x.toFixed(2), 'Ft', fe.lastFt.x.toFixed(0), 'cap-h', ((pl.gait as any).capture.x - h.x).toFixed(2),
        'feet', fe.feet.map((f: any) => (f.side > 0 ? 'R' : 'L') + f.phase[0] + f.phase[1] + (f.worldPos.x - h.x).toFixed(2) + ':' + f.points.map((q: any) => q.state[1]).join('')).join(' '), 'upx', (2 * (pl.body.rotation().x * pl.body.rotation().y + pl.body.rotation().w * pl.body.rotation().z) * -1).toFixed(2));
    }
  }, JSON.parse(process.env.OV ?? '{}'));
});
