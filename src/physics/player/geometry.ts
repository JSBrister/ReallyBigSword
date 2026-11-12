import * as THREE from 'three';

/** Fixed body layout of the warrior (metres, body-local frames, +Z forward, +Y up). */
export const GEOM = {
  /** Pelvis/legs COM to hip joint. The pelvis body includes the legs, so its COM is low. */
  hipOffset: 0.33,
  /** Torso COM above the hip joint. */
  torsoAboveHip: 0.3,
  /** Grip anchor on the torso at zero reach (chest height, in front). */
  grip: new THREE.Vector3(0, 0.15, 0.4),
  reachMin: -0.3,
  reachMax: 0.4,
  reachSpeed: 1.6, // m/s
  /** Heel and toe positions along the foot from the ankle. */
  heel: -0.07,
  toe: 0.19,
  stanceHalfWidth: 0.17,
  /** Sword: pommel below grip, blade starts above grip. */
  pommel: 0.25,
  bladeStart: 0.3,
  bladeWidth: 0.34,
  bladeThickness: 0.05,
  bladeMassFraction: 0.92,
};
