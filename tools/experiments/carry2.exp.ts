import { it } from 'vitest';
import { runSession, fmt } from './session';
it('carry2', async () => {
  const noFace = (sb: any) => { const t = sb.player.tech; const u = t.update.bind(t); t.update = (dt: number, c: any, p: any) => { const o = u(dt, c, p); if (process.env.NOFACE) o.face = null; return o; }; };
  const log = async (name: string, T: number, prog: Parameters<typeof runSession>[1]) => console.log(name.padEnd(12), fmt(await runSession(T, prog, {}, {}, noFace)));
  await log('circle', 8, (t, c) => c.move.set(Math.sin(t * 0.8), 0, Math.cos(t * 0.8)));
  await log('reverse', 8, (t, c) => c.move.set(0, 0, Math.floor(t / 1.5) % 2 ? -1 : 1));
  await log('zigzag', 8, (t, c) => c.move.set(Math.floor(t) % 2 ? -1 : 1, 0, 1).normalize());
  await log('fwd', 6, (_t, c) => c.move.set(0, 0, 1));
});
