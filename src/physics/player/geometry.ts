import * as THREE from 'three';

/** Fixed body layout of the warrior (metres, body-local frames, +Z forward, +Y up). */
export const GEOM = {
  /** Grip anchor on the body at zero reach (chest height, in front). Body origin = hip height. */
  grip: new THREE.Vector3(0, 0.45, 0.4),
  reachMin: -0.3,
  reachMax: 0.4,
  reachSpeed: 1.6, // m/s
  /** Heel and toe positions along the foot from the ankle. */
  heel: -0.07,
  toe: 0.19,
  /** Half width of the sole at the toes (inner/outer toe contact points). */
  footHalfWidth: 0.055,
  stanceHalfWidth: 0.17,
  /** Sword: pommel below grip, blade starts above grip. */
  pommel: 0.25,
  bladeStart: 0.3,
  bladeWidth: 0.34,
  bladeThickness: 0.05,
  bladeMassFraction: 0.92,
};
