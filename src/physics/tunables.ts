/**
 * Every physical constant that shapes how the warrior feels lives here.
 * The debug GUI edits this object live; values marked (rebuild) take effect on restart (R).
 */
export interface Tunables {
  // --- masses & geometry (rebuild) ---
  pelvisMass: number; // pelvis + legs lump, kg
  torsoMass: number; // torso + arms + head, kg
  swordMass: number; // kg, must stay > pelvisMass + torsoMass
  swordLength: number; // m, pommel to tip
  legLength: number; // m, pelvis COM to sole at rest

  // --- feet / friction ---
  muStatic: number; // default stone static coefficient
  muKinetic: number; // default stone kinetic coefficient
  footNormalStiffness: number; // N/m per contact point
  footNormalDamping: number; // N·s/m per contact point
  footTangentStiffness: number; // N/m per contact point
  footTangentDamping: number; // N·s/m per contact point
  restickSpeed: number; // m/s, slip speed below which a foot may re-stick
  restickTime: number; // s, how long the slip must stay slow before re-sticking
  legMaxStretch: number; // m, how far the leg drive may wind its spring (leg strength)

  // --- actuators ---
  swordMaxTorque: number; // N·m
  swordHoldGain: number; // 1/s, pose error -> corrective relative angular velocity
  swordMotorFactor: number; // N·m·s/rad, joint motor velocity gain (solved implicitly)
  swordMaxLead: number; // rad, how far the commanded pose may run ahead of the real pose
  swordMaxRate: number; // rad/s, cap on commanded relative angular velocity
  reachSpeed: number; // m/s grip slide speed
  balanceMaxTorque: number; // N·m, torso<->pelvis pitch/roll
  balanceGain: number; // 1/s
  balanceMotorFactor: number; // N·m·s/rad
  twistMaxTorque: number; // N·m, torso<->pelvis yaw
  twistGain: number; // 1/s

  // --- locomotion ---
  walkSpeed: number; // m/s commanded
  stepDuration: number; // s
  maxStepLength: number; // m, from hip
  maxFootSpeed: number; // m/s swing foot speed limit
  jumpForce: number; // N total extra leg thrust during push
  jumpPushTime: number; // s
  leanGain: number; // rad per metre of COM offset
  maxLean: number; // rad

  // --- combat ---
  damageThreshold: number; // m/s relative normal speed
  damagePerMps: number; // hp per m/s above threshold

  // --- sim ---
  timeScale: number;
  substeps: number; // per 1/60 s frame

  // --- physics cheats (all off by default; they exist to demonstrate the joke) ---
  cheatStickyFeet: boolean;
  cheatInfiniteFriction: boolean;
  cheatWeightlessSword: boolean;
  cheatAirControl: boolean;
}

export const defaultTunables: Tunables = {
  pelvisMass: 40,
  torsoMass: 50,
  swordMass: 150,
  swordLength: 2.8,
  legLength: 0.92,

  muStatic: 0.9,
  muKinetic: 0.5,
  footNormalStiffness: 40000,
  footNormalDamping: 2500,
  footTangentStiffness: 40000,
  footTangentDamping: 1500,
  restickSpeed: 0.08,
  restickTime: 0.05,
  legMaxStretch: 0.12,

  swordMaxTorque: 20000,
  swordHoldGain: 25,
  swordMotorFactor: 60000,
  swordMaxLead: 0.6,
  swordMaxRate: 14,
  reachSpeed: 1.6,
  balanceMaxTorque: 2500,
  balanceGain: 15,
  balanceMotorFactor: 2500,
  twistMaxTorque: 6000,
  twistGain: 20,

  walkSpeed: 2.6,
  stepDuration: 0.3,
  maxStepLength: 0.75,
  maxFootSpeed: 6,
  jumpForce: 14000,
  jumpPushTime: 0.16,
  leanGain: 0.9,
  maxLean: 0.35,

  damageThreshold: 8,
  damagePerMps: 6,

  timeScale: 1,
  substeps: 8,

  cheatStickyFeet: false,
  cheatInfiniteFriction: false,
  cheatWeightlessSword: false,
  cheatAirControl: false,
};

export function makeTunables(overrides: Partial<Tunables> = {}): Tunables {
  return { ...defaultTunables, ...overrides };
}
