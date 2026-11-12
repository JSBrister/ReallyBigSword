import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { v3, worldInertia } from '../mathUtil';

export interface SystemState {
  mass: number;
  com: THREE.Vector3;
  vcom: THREE.Vector3;
  /** Linear momentum. */
  P: THREE.Vector3;
  /** Angular momentum about the system centre of mass. */
  L: THREE.Vector3;
}

const tmpI = new THREE.Matrix3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** Centre of mass, momentum and angular momentum (about the COM) of a set of bodies. */
export function systemState(bodies: RAPIER.RigidBody[], out?: SystemState): SystemState {
  const s = out ?? { mass: 0, com: new THREE.Vector3(), vcom: new THREE.Vector3(), P: new THREE.Vector3(), L: new THREE.Vector3() };
  s.mass = 0; s.com.set(0, 0, 0); s.P.set(0, 0, 0); s.L.set(0, 0, 0);
  for (const b of bodies) {
    const m = b.mass();
    s.mass += m;
    s.com.addScaledVector(v3(b.worldCom(), tmpA), m);
    s.P.addScaledVector(v3(b.linvel(), tmpA), m);
  }
  s.com.divideScalar(s.mass);
  s.vcom.copy(s.P).divideScalar(s.mass);
  for (const b of bodies) {
    const m = b.mass();
    const r = v3(b.worldCom(), tmpA).sub(s.com);
    const v = v3(b.linvel(), tmpB).sub(s.vcom);
    s.L.add(tmpC.crossVectors(r, v).multiplyScalar(m));
    s.L.add(v3(b.angvel(), tmpC).applyMatrix3(worldInertia(b, tmpI)));
  }
  return s;
}
