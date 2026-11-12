/**
 * Every physical constant that shapes how the warrior feels lives here.
 * The debug GUI edits this object live; values marked (rebuild) take effect on restart (R).
 */
export interface Tunables {
  // --- masses & geometry (rebuild) ---
  warriorMass: number; // kg, whole warrior (one rigid body)
  swordMass: number; // kg, must stay > warriorMass
  swordLength: number; // m, pommel to tip
  legLength: number; // m, hip (body origin) to sole at rest

  // --- feet / friction ---
  muStatic: number; // default stone static coefficient
  muKinetic: number; // default stone kinetic coefficient
  legTravel: number; // m, how much further the standing legs can extend while still pushing
  footNormalStiffness: number; // N/m per contact point
  footNormalDamping: number; // N·s/m per contact point
  stickBiasTime: number; // s, how fast a sticking point is pulled back onto its anchor
  restickSpeed: number; // m/s, slip speed below which a foot may re-stick
  restickTime: number; // s, how long the slip must stay slow before re-sticking
  legMaxStretch: number; // m, how far the leg drive may wind its spring (leg strength)

  // --- actuators ---
  swordMaxTorque: number; // N·m
  swordHoldGain: number; // 1/s, pose error -> corrective relative angular velocity
  swordMotorFactor: number; // N·m·s/rad, joint motor velocity gain (solved implicitly)
  swordMaxLead: number; // rad, how far the commanded pose may run ahead of the real pose
  swordMaxRate: number; // rad/s, cap on commanded relative angular velocity
  swordEffort: number; // N·m, torque of a full-strength swing input
  swordFreeDamping: number; // N·m·s/rad, internal damping of the relative swing when not gripping
  reachSpeed: number; // m/s grip slide speed

  // --- locomotion ---
  walkSpeed: number; // m/s commanded
  walkAccel: number; // m/s^2, how fast the commanded leg sweep may change
  standUpDelay: number; // s on the floor before he is put back on his feet (explicit rule)
  turnRate: number; // rad/s, how fast the legs try to turn the body while walking
  driveMaxLag: number; // m/s, how far the leg sweep may run ahead of the hips before it re-syncs
  walkPlacementLag: number; // s, how far behind the capture point steps land while walking
  stepDuration: number; // s
  maxStepLength: number; // m, from hip
  maxFootSpeed: number; // m/s swing foot speed limit
  hipMaxTorque: number; // N·m, strongest tilting torque the hips/legs can put on the torso
  hipStiffness: number; // N·m/rad, keeping the torso upright on the legs
  hipDamping: number; // N·m·s/rad
  jumpForce: number; // N total extra leg thrust during push
  jumpPushTime: number; // s

  // --- combat ---
  damageThreshold: number; // m/s relative normal speed
  damagePerMps: number; // hp per m/s above threshold

  // --- sim ---
  timeScale: number;
  substeps: number; // per 1/60 s frame

  // --- physics cheats (all off by default; they exist to demonstrate the joke) ---
  /** Optional assist: scale swing effort down while the feet cannot hold the reaction. */
  governor: boolean;
  /** Brace strength: how much crouch / stance change / hip stiffening bracing applies (0..1). */
  braceAmount: number;
  braceCrouch: number; // m the hips drop when fully braced
  braceStagger: number; // m each foot moves along the blade for a pitch swing
  braceWiden: number; // m extra stance half-width when braced
  balanceReflex: boolean; // ease off a swing as he starts to go over
  cheatStickyFeet: boolean;
  cheatInfiniteFriction: boolean;
  cheatWeightlessSword: boolean;
  cheatAirControl: boolean;
}

export const defaultTunables: Tunables = {
  warriorMass: 90,
  swordMass: 150,
  swordLength: 2.8,
  legLength: 0.95,

  muStatic: 0.9,
  muKinetic: 0.5,
  legTravel: 0,
  footNormalStiffness: 150000,
  footNormalDamping: 4000,
  stickBiasTime: 0.06,
  restickSpeed: 0.08,
  restickTime: 0.05,
  legMaxStretch: 0.12,

  swordMaxTorque: 20000,
  swordHoldGain: 25,
  swordMotorFactor: 60000,
  swordMaxLead: 0.6,
  swordMaxRate: 10,
  swordEffort: 2000,
  swordFreeDamping: 250,
  reachSpeed: 1.6,

  walkSpeed: 1.6,
  walkAccel: 4,
  turnRate: 2.5,
  standUpDelay: 2.5,
  driveMaxLag: 0.5,
  walkPlacementLag: 0.12,
  stepDuration: 0.3,
  maxStepLength: 0.85,
  maxFootSpeed: 6,
  hipMaxTorque: 4000,
  hipStiffness: 20000,
  hipDamping: 2500,
  jumpForce: 14000,
  jumpPushTime: 0.16,

  damageThreshold: 6.5,
  damagePerMps: 6,

  timeScale: 1,
  substeps: 8,

  governor: false,
  braceAmount: 1,
  braceCrouch: 0.14,
  braceStagger: 0,
  braceWiden: 0.1,
  balanceReflex: true,
  cheatStickyFeet: false,
  cheatInfiniteFriction: false,
  cheatWeightlessSword: false,
  cheatAirControl: false,
};

export function makeTunables(overrides: Partial<Tunables> = {}): Tunables {
  return { ...defaultTunables, ...overrides };
}
