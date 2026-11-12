import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;
let ready: Promise<Rapier> | null = null;

/** Initialise the WASM module once (the -compat build embeds it as base64). */
export function initRapier(): Promise<Rapier> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}
export { RAPIER };
