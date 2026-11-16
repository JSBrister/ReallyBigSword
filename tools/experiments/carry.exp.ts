import { it } from 'vitest';
import { runSession, fmt } from './session';
it('carry', async () => {
  const log = async (name: string, T: number, prog: Parameters<typeof runSession>[1]) => console.log(name.padEnd(12), fmt(await runSession(T, prog)));
  await log('stand', 10, () => {});
  await log('circle', 8, (t, c) => c.move.set(Math.sin(t * 0.8), 0, Math.cos(t * 0.8)));
  await log('reverse', 8, (t, c) => c.move.set(0, 0, Math.floor(t / 1.5) % 2 ? -1 : 1));
  await log('zigzag', 8, (t, c) => c.move.set(Math.floor(t) % 2 ? -1 : 1, 0, 1).normalize());
  await log('back', 8, (_t, c) => c.move.set(0, 0, -1));
  await log('stopgo', 8, (t, c) => c.move.set(0, 0, Math.floor(t / 0.7) % 2 ? 0 : 1));
  await log('turn180', 3, (t, c) => c.move.set(0, 0, t < 1.5 ? -0.3 : 0));
});
