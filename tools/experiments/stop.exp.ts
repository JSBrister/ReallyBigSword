import { it } from 'vitest';
import { runSession } from './session';
it('stop', async () => {
  for (const lever of [0.1, 0.06, 0.03]) for (const dec of [4, 1.5]) {
    let stopAt = -1, zAtRelease = 0;
    const f = await runSession(14, (t, c, sb) => {
      c.move.set(0, 0, t < 5 ? 1 : 0);
      const v = sb.player.body.linvel(); const z = sb.player.body.translation().z;
      if (t < 5) zAtRelease = z;
      if (t > 5 && stopAt < 0 && Math.hypot(v.x, v.z) < 0.2) stopAt = t - 5;
    }, { balanceLever: lever, walkDecel: dec });
    const c = await runSession(8, (t, cm) => cm.move.set(Math.sin(t * 0.8), 0, Math.cos(t * 0.8)), { balanceLever: lever, walkDecel: dec });
    const z = await runSession(8, (t, cm) => cm.move.set(Math.floor(t / 1.5) % 2 ? -0.7 : 0.7, 0, 0.7), { balanceLever: lever, walkDecel: dec });
    console.log('lever', lever, 'decel', dec, '| stop falls', f.falls, 'time', stopAt.toFixed(1), 'dist', (f.pos.z - zAtRelease).toFixed(1), 'maxV', f.maxHipSpeed.toFixed(1), '| circle falls', c.falls, '| zigzag falls', z.falls);
  }
});
