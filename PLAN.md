# Plan: "Competent hero" redesign

Status: **not started**. Tick the phase boxes at the bottom as you go and keep this file up to date.

## 1. What we are making

Same joke: an extremely strong person, a 150 kg sword, and no physics cheats. What changes is who does the fiddly part.

- **The hero is competent.** The player never controls muscles, torques or balance. The player picks *what to do and when* (a few verbs plus a direction). The hero's controller executes it as well as physics allows.
- **Momentum is the resource.** Attacks work by building momentum honestly (running, spinning, gravity) and spending it. Everything has an honest cost: wind-up time, skid distance, recovery.
- **He should rarely fall.** Falling is the result of a bad decision (spinning on oil, charging into a wall), not of normal play. Target: in a 60 s scripted session of normal play on stone, zero falls.
- Stays 3D, real time, keyboard + gamepad.

The decisions already made by the user: direction A+B from the design discussion (momentum game + honest technique moveset), 3D, competent hero. Do not reopen these.

## 2. Rules that must keep holding

1. **Force-source rule.** Forces/torques on the player bodies come only from `src/physics/player/actuators.ts` (internal equal-and-opposite pairs, joint motors, joint anchor moves) and `src/physics/player/feet.ts` (ground contact). `tests/forceLint.test.ts` and the runtime guard enforce it. New technique/controller code must not call force methods; it only sets targets that those two modules act on.
2. **All 8 original test groups keep passing** (`npm test`). Tests may be *updated* when an API changes, never weakened in what they assert about physics (momentum conservation, friction limits, toppling with the sword held out at the hilt, damage threshold, shield blocking).
3. **Report honestly.** If something cannot be made to work, write down the tuning tried in `README.md` rather than adding a hidden assist.
4. Commit and push after every phase to branch `claude/trusting-pascal-6f4m6g` (deploys to GitHub Pages automatically). Use the commit attribution lines given in the session's system reminder. No pull request unless asked.

## 3. Where things are (read these first)

| File | What it is | Touch? |
|---|---|---|
| `src/physics/player/feet.ts` | Foot contact model: massless legs, heading-only stance frame, friction block solve, centre of pressure. Hard-won and fragile. | **Avoid.** Only add small inputs like the existing `twistRate`, `hipStrengthScale`. |
| `src/physics/player/controller.ts` | `GaitController`: leg drive, stepping, hip balance torque, jump, brace. | Small additions only. |
| `src/physics/player/actuators.ts` | `SwordActuator`: `apply()` = hold mode (joint velocity motors toward `qTarget`), `applyFree()` = explicit torque pair. `applyReach()` moves the grip anchor on the body. | Extend here. |
| `src/physics/player/moves.ts` | Old named attacks (slam/sweep/spin scripted effort). | Replace with `technique.ts`, then delete. |
| `src/physics/player/player.ts` | Builds bodies, per-substep pipeline `preStep`. `PlayerCommand` is the input struct. | Rework `preStep` and `PlayerCommand`. |
| `src/game/input.ts` | Keyboard/mouse/gamepad → `PlayerCommand`. | Rework. |
| `src/game/level.ts`, `game.ts`, `hud.ts`, `debug.ts` | Rooms (room 0 = Training Ground), loop, HUD, F1 panel. | Update texts, add meters. |
| `tests/helpers.ts` | `makeSandbox()` headless world + player. | Use everywhere. |
| `tools/experiments/*.exp.ts` | Measurement scripts (not pass/fail). Run: `npm run exp -- tools/experiments/moves.exp.ts`. | Copy `moves.exp.ts` as the template for new measurements. |
| `tools/browser/shot.cjs`, `sim.js` | Headless Chromium screenshot + in-page stepping harness (see §7). | Use for game-level checks. |

Body layout (important numbers): warrior body origin = hip, 0.95 m above the ground, +Z forward, +Y up. Sword-local +Y runs along the blade; local origin is the hilt grip point; pommel at y = −0.25; blade from 0.3 to 2.55; **sword centre of mass at y ≈ 1.34** (read it with `player.sword.localCom()`). Body-side grip anchor `GEOM.grip = (0, 0.45, 0.4)` plus `reach` along Z.

## 4. The physics ideas the design rests on

These are estimates worked out on paper, **not yet tested**. Each phase starts by measuring them.

1. **Why it was QWOP.** Held at the hilt, the sword has ~400 kg·m² about the grip; his torso has ~24. Any sword torque whips him. Held at its balance point the sword has only ~65 kg·m² about the grip and exerts no weight torque at all. So: **where he holds the sword is the main lever.** A competent hero carries it at the balance point and only slides his grip toward the hilt when he wants reach and has momentum to pay for it.
2. **Charge.** 240 kg moving at running speed is a battering ram and needs no swing. Damage is relative normal speed at contact (threshold 6.5 m/s), so the charge needs speed: sprint (friction allows ~8 m/s² of acceleration) plus a **thrust** at the end (slide the sword forward along the body; feet friction ≈ 2100 N can push 150 kg at ~14 m/s², ~4.5 m/s over a 0.8 m stroke).
3. **Spin (hammer throw).** Body and sword orbit their common centre of mass; the body is always 62.5 % of the separation from the axis (150 vs 90 kg). The spin is driven by the *feet* turning the whole rigid pair (sword locked to the body), not by a torque between sword and body. Available foot twist torque ≈ 400 N·m, system yaw inertia ≈ 250 kg·m² at hilt grip → about 1.6 rad/s², i.e. several seconds to wind up. That delay is the game.
4. **Sword height is the balance control during a spin.** At low spin speed the sword's weight tips him toward it, so the tip must drag on the floor (sparks; the floor carries the weight). Above roughly 5–6 rad/s with the sword held low, the outward pull balances the weight and the blade lifts off. Raising the blade tips him toward it; lowering it tips him away. A feedback law on body tilt toward/away from the sword, acting on blade elevation, should keep him up.
5. **Grip position trades reach for foot speed.** In a spin his hips travel at ω × 0.625 × (hip-to-sword-COM distance). At hilt grip and 6 rad/s that is ~6 m/s around a 1 m circle, too fast for the current gait. Gripping further up the blade shrinks the circle and lets ω rise for the same foot speed (the ice-skater effect). Sliding the grip out converts spin into reach and tip speed.

## 5. Player-facing design

**Default state: Carry.** Sword on the shoulder, held at its balance point, blade roughly level along his heading (tip forward). Walks and turns freely, at a faster walk speed than today.

| Verb | Keyboard | Gamepad | What happens |
|---|---|---|---|
| Move / aim | WASD (camera relative) | left stick | Walk; he faces the move direction (existing `face` mechanism). |
| **Charge** | hold J | hold X | Levels the sword forward, sprints in the facing direction. On release, or automatically ~1 m before a target, thrusts. Then skids to a stop (recovery). |
| **Spin** | hold K | hold B | Slides grip to the hilt, drags the tip, legs wind the pair up. Move stick drifts the whole spin across the floor. Release: follow through, then brake. |
| **Drop** (overhead) | press L | press Y | From carry: lets the blade fall forward off the shoulder while stepping in. Gravity does the work. |
| **Reach in / out** (during spin) | Q / E | LB / RB | Slides the grip along the blade: in = tighter and faster, out = longer and harder-hitting. |
| **Plant / brake** | hold Shift | hold RT | Drives the tip into the floor and leans on it: emergency stop, also the stable "rest" pose. |
| Jump | Space | A | As now. |
| Camera | RMB drag | right stick | Right stick is always camera now. |

Remove the raw swing inputs (arrows/IJKL/face-button swings, mouse-drag swing, digits 1–4) from normal play. Keep the old effort control reachable only behind an F1 toggle "manual sword (debug)".

## 6. Phases

Do them in order. Each phase: measure first, implement, add/adjust tests, update README + in-game help, run `npm test` and `npm run build`, commit, push. If a phase's gate cannot be met after the listed fallbacks, stop, write up what was tried in README, and move to the next phase only if it does not depend on it.

### Phase 0 — Baseline and harness (small)
- Run `npm test` (expect 41 passing) and `npm run exp -- tools/experiments/walk2.exp.ts` (expect `fallenT 0.00` on all five patterns). If either is not true, fix that before anything else.
- Write `tools/experiments/session.exp.ts`: a helper `runScript(steps)` on top of `makeSandbox` that plays a list of timed commands and reports: time fallen, number of falls, max hip speed, max tip speed, final position. All later gates use it.

### Phase 1 — Grip slide and the Carry stance
Implementation:
- Add `gripAlong` (metres along the sword from the hilt, 0 … ~1.6) to `Player`. In `actuators.ts` add `applyGripSlide(b, gripAlong)` that calls `gripJoint.setAnchor2({x:0, y:gripAlong, z:0})`. Rate-limit changes of `gripAlong` in `player.ts` (tunable `gripSlideSpeed`, start 1.5 m/s). This is an internal joint-anchor move like the existing reach.
- Everything that assumed "grip = sword body origin" must use a new `player.gripPoint()` (sword pose applied to `(0, gripAlong, 0)`): see `sword.translation()` uses in `player.ts` (the `applyFree` call) and `warriorView.ts` (hand IK target; the sword mesh itself still follows the body origin).
- Generalise the actuator's rest-pose mechanism: replace the fixed `REST` quaternion and `restRate` with `poseTarget: Quaternion | null` and `poseRate` (rad/s). When set, hold mode rotates `qTarget` toward `poseTarget` at `poseRate`. Poses are body-relative orientations of the sword.
- Carry pose: blade level, pointing forward (+Z), body grip anchor at shoulder height (raise the anchor: about `(0.18, 0.62, 0.05)`; make the body anchor a per-stance value instead of the constant `GEOM.grip`), `gripAlong` = sword COM. Spawn in this pose (`SpawnOptions.swordDir` exists; add spawn `gripAlong`).
- Raise `walkSpeed` only after the gate below passes at 1.6; then try 2.2, 2.8.

Gate (write as tests in `tests/carry.test.ts`):
- Stands 10 s, max tilt < 0.05 rad; system COM within 0.12 m (horizontal) of the hip.
- All five `walk2` patterns: zero falls.
- Turn 180° (face command) in < 1.5 s without falling.
- Existing toppling test still passes (it spawns hilt grip, sword horizontal; keep that spawn path working).

Fallbacks if unstable: lower `poseRate`; lower blade angle (tip slightly down); check the visual/hold target is not fighting the grip slide (slide first, then rotate).

### Phase 2 — Technique state machine and new input
- New `src/physics/player/technique.ts` exporting `TechniqueController`. States: `carry`, `charge`, `thrust`, `skid`, `spinUp`, `spin`, `release`, `drop`, `plant`, `recover`. Each substep it reads intents + measured state and outputs **targets only**: sword pose target + rate, `gripAlong` target, reach target, sword mode (hold/free), desired move velocity scale, face yaw, `twistRate`, brace. No force calls (the lint test will catch them).
- `PlayerCommand` becomes: `move`, `charge: boolean`, `spin: boolean`, `drop: boolean (edge)`, `plant: boolean`, `reachIn/reachOut`, `jump`, `face`, plus `manualEffort` for the debug toggle.
- Rewrite `input.ts` mapping per §5. Update `hud.ts` help table and bottom hint line, and the Training Ground signs in `level.ts`.
- Delete `moves.ts` and its uses once `technique.ts` covers them. Update tests that used `cmd.effort`/`cmd.attack` (`tests/damage.test.ts`, `tests/locomotion.test.ts`, `tests/forceLint.test.ts`): for physics tests that need a raw swing, use the existing `player.swordCmdOverride` or the manual-effort path.

Gate: `npm test` passes; in the browser the hero stands in Carry, walks, and each button visibly changes state (states may be stubs that only change pose).

### Phase 3 — Charge and thrust
- `charge`: pose = blade level forward at chest height, grip still at the balance point; gait speed scale up to `sprintSpeed` (tunable, start 4 m/s, try up to 6); face locked to the direction held when the charge started (slow steering only, tunable `chargeTurnRate` ≈ 0.6 rad/s).
- `thrust`: on release, or when a ray from the tip along the heading finds an enemy/shield within ~1.2 m: accelerate `reach` forward. The anchor move is not strength-limited by the joint, so **limit it yourself**: cap reach acceleration at `thrustAccel` (default 12 m/s², chosen so sword mass × accel ≈ friction available) and reach speed at `thrustSpeed`. Extend `GEOM.reachMax` if needed (document it).
- `skid`: after the thrust, stop driving the legs forward (desired velocity 0) and brace; return to `carry` when speed < 0.3 m/s.
- Sprint may need gait tuning. Known knobs: `stepDuration` (shorter when fast), `maxStepLength`, `maxFootSpeed`, `walkAccel`. Change one at a time and re-run `walk2` every time.

Gate (`tests/charge.test.ts` + experiment):
- From 6 m away, charge at a plain goblin: contact normal speed ≥ 7 m/s, damage > 0, hero not fallen 2 s later.
- Charging a left-shield goblin head-on is not blocked; hitting the shield face is.
- Charge into a wall: he bounces/staggers; record whether he falls (acceptable, it is a bad decision).

Fallback if sprint is unstable above ~3.5 m/s: keep sprint at the stable speed and lean on the thrust; if still < 6.5 m/s at contact, report the measured numbers and lower `damageThreshold` only with a note in README (the user must be told).

### Phase 4 — Drag and spin
This is the riskiest phase. Build it in three measured steps.

**4a. Rigid spin by the feet.**
- `spinUp`: slide `gripAlong` to a mid position (start 0.6, tunable `spinGrip`), pose = blade pointing out to his right side, tip angled down so it rests on the floor (free mode with zero effort lets it rest; or hold mode with a downward pose). Then lock the sword to the body (hold mode, zero command) and command `feet.twistRate`, ramping toward `spinRate` (tunable target, start 4 rad/s). `twistRate` already turns the body through foot friction; today it is clamped by `turnRate` in `controller.ts`, so add a separate path for spin.
- Measure in an experiment: yaw rate vs time, foot slip time, tilt, whether he falls, hip speed. Expect ~1–2 rad/s² and feet slipping if the ramp is too steep (that is fine; dust).
- Gait at speed: his hips move in a circle. The leg drive must be told the hip's expected velocity (tangential) so it steps instead of holding. Feed `vDes` = current hip velocity while spinning (do not fight it), and raise `maxFootSpeed`/shorten `stepDuration` in this state only.

**4b. Stay up: blade elevation feedback.**
- Compute `lean` = body tilt component toward the sword (positive = tipping toward it). Elevation target = base − k·lean, clamped between "tip on floor" and ~15° above level. As spin rate rises the equilibrium elevation rises on its own. Tunables: `spinLeanGain`, limits.
- Gate: 8 s spin on stone reaching ≥ 5 rad/s with zero falls; tip speed ≥ 12 m/s; a goblin placed in the tip's path takes damage.

**4c. Player control.**
- Move stick during spin: add a small bias to where the feet are placed (reuse the walk drive: desired velocity = stick × `spinDriftSpeed`, ~0.8 m/s) so the whole spin drifts.
- Reach in/out: change `gripAlong` (and/or `reach`). Check in an experiment that pulling in raises yaw rate (angular momentum conserved minus friction).
- `release`: stop commanding twist, sword to free mode with light damping, let it run down; then `plant` or `recover` to carry (slide grip back to balance point first, then rotate to the carry pose).
- On the oil patch the feet cannot wind up or brake; make sure that is what happens (it is the joke), and note it on the training sign.

Fallbacks: lower `spinRate`; larger `spinGrip` (smaller circle); let the tip drag longer (lower elevation limit); wider stance via brace. If a free-standing spin cannot be kept up at all, ship the **dragging spin** (tip stays on the floor, throwing sparks, lower speed) and report the numbers.

### Phase 5 — Drop
- From carry: step in (short forward drive), slide grip from balance point toward the hilt while letting the blade pitch forward off the shoulder under gravity (free mode, weight support off in the falling direction, as the existing `applyFree` "pushing down relaxes support" logic does). Do **not** drive it down hard; earlier tests showed driven slams tip him.
- End in `plant` (blade resting on the floor, him leaning on it), then a slow `recover`: slide the grip back up to the balance point *before* lifting (lifting from the hilt tips him; lifting at the balance point does not).
- Gate: target at 1.2–1.8 m in front takes damage (contact ≥ 6.5 m/s) in ≥ 4 of 5 start distances; zero falls; top-shield goblin blocks it.

### Phase 6 — Plant/brake, recovery, robustness
- `plant`: tip to the floor in front, hold; the sword contact carries load and resists sliding. Verify it shortens skid distance vs not planting.
- Recovery paths from every state back to `carry` always go: stop → slide grip to balance point → rotate to carry pose.
- Interrupts: goblin club hit during a technique → `recover`. Jump only from `carry`.
- Keep the explicit stand-up rule as the last resort; measure how often it fires in the 60 s session script (target 0 on stone).

Gate: `session.exp.ts` 60 s mixed script (walk, charge ×3, spin ×2, drop ×3) on stone: zero falls, zero stand-ups.

### Phase 7 — Readability and content retune
- HUD: a momentum meter (|L| about the system COM, already computed in `player.state.L`), current technique name, and a faint predicted tip arc on the floor during spin (circle of the current tip radius around the spin axis) and a line during charge.
- Training Ground signs rewritten for the four verbs; keep dummies and the shield row. Place one dummy in a lane for charging and one in open floor for spinning.
- Retune goblins for the new moveset: HP, damage per m/s, attack range, and shield turn rate so that a side-shield goblin beats a constant-direction spin but loses to a charge from its open side, and a top shield beats the drop. Re-check rooms: corridor (charge is the right answer), low vault (drop hits the ceiling? check clearance from the carry pose), slick cellar (spinning is a trap).
- README: replace the controls section and the "what feels wrong" section with the new state; keep the deviations list accurate (grip slide, thrust limit, any threshold change).

## 7. How to test game-level behaviour without a GPU

The headless browser renders at ~10 fps, so do not rely on real-time play. Use the in-page stepping harness:

```bash
npm run build
```

```bash
npx vite preview --port 4173 --strictPort
```

Run the preview in the background, then run `tools/browser/shot.cjs <url> <png> <waitMs> "<js expression>"` with `NODE_PATH=$(npm root -g)`. `tools/browser/sim.js` shows the pattern: pause the game loop, then call `g.pw.advance(1/60)` and `g.gameLogic(1/60)` in a loop while setting fields on `g.cmd`. `window.game` is the `Game` instance. `THREE` is not a page global; use plain numbers.

Prefer vitest experiments with `makeSandbox()` for anything about the hero alone; they are fast and deterministic.

## 8. Lessons already paid for (do not relearn)

- Rapier conserves angular momentum for these bodies. Do not add any integrator "correction".
- The typed spherical-joint motor methods are missing at runtime in rapier3d-compat 0.21; `actuators.ts` talks to `joint.rawSet` directly. Use the existing helpers.
- Joint motors use the force-based model; gains are in N·m units.
- Explicit spring forces far from a light body's COM are unstable; that is why friction is a velocity-level block solve. Do not add spring-damper forces on the body.
- The leg drive must be relative to the hip's actual velocity (push with bounded acceleration). An integrated target velocity makes the feet skate and he falls.
- A split (staggered) stance for bracing made slams worse because it triggers steps at the wrong moment. Leave `braceStagger` at 0.
- Lifting the sword from the floor by the hilt tips him over every time. Always slide the grip to the balance point first.
- Hard, fast sword torques at hilt grip topple him (16:1 inertia). Anything fast must be done either at balance-point grip, by the feet turning the whole pair, by gravity, or by running.
- Carry: the only stable walking stance found is the sword upright, held at the hilt, hands in front of the chest (`CARRY_ANCHOR`). Level/shoulder carries at the balance point run away and fall.
- Round 7 lessons: the chop's pushing torque mostly turns HIM (the upright sword has ~13x his inertia about the hands) — keep `chopNudge` small (300); release on the strike, not earlier (earlier = he was leaning against the blade's pull and falls back) and plant the feet during the chop (`holdGround`); never start a heavy move unless steady (`steady()`); lift with a loose grip and the load hugged close (0.12 m), raise slowly (0.5 rad/s, eased in) with the hands rising so the sword can stand at its balance point.
- Charge-at-speed (running chop, thrust) throws him over. What works: READY = walk up, stop, square up (ray fan), then a gravity-driven chop (`support 0`, small nudge). Driving the chop with torque throws him backward.
- After the blade lands across a target, telling the legs he carries only 15% of the sword is wrong: use `handShare()` (beam statics from the furthest blade contact, `swordRestAlong`).
- While the feet are meant to stay planted, the gait must not take steps for foot error/twist (`holdGround` now only steps on real capture-point loss), or he rocks side to side on one foot.
- Sliding the grip up the blade with the feet planted drags 150 kg back through his hands and pulls him forward; he has to walk toward the sword as the grip slides.
- The hand force on a shallow, leaning sword is ladder-like (≈2 kN horizontal, near the feet's friction limit). This is what makes every grip-held recovery marginal.
- (FIXED in round 7, see README) EMPTY-HANDED HE COULD NOT STAND: with 90 kg on the feet the centre-of-pressure shift gives the hips only ≈200 N·m; the body COM is only 0.11 m above the hip pivot, so its inertia is tiny and `hipDamping` 2500 is at the edge of explicit stability at 480 Hz. After `release()` he leans 10–45° and runs off at up to 5 m/s. Any design where he lets go of the sword needs this fixed first (`tools/experiments/empty.exp.ts`).
- `balanceOnCom` = 1 is wrong when the load hangs near hip height: the hip→COM line is then far from vertical and the hips get asked for 6–8 kN·m.
- Round 8 (spin attempts, 3.4 m sword):
  - A spinning, steep blade is a huge lever (its COM ~2 m up, off-axis): spin fast only once the blade is low.
  - Lowering short of the balance point puts the system COM past the edge of his narrow stance (feet ±0.17 m) almost at once; a fixed torque budget does not work because his lean adds to the overhang. Steer the lowering by the measured COM drift (`balanceDrift()`) instead.
  - Sliding the grip fast (>0.2 m/s) up the blade pitches him; easing the start/stop did not help.
  - Pose targets relative to the torso make the torso's lean swing 150 kg: give heavy-load poses in the heading frame (`poseInHeading`).
  - Sideways balance is his weakest axis; fore-aft (long feet) is much better: lower forward, then turn crosswise.
  - Empty-handed runaway sideways came from `leanFootShift` while moving (faded out by speed now); a stance-locked chop/follow with empty hands also cannot recover (holdGround only while holding).
  - Open: he still rocks and falls while holding the sword overhead during the grip slide. Next idea: widen the stance before the slide (step out), or slide with the sword lowered forward to ~70° first.
- When a change makes several things worse at once, revert it and change one knob at a time, re-running `walk2.exp.ts` and `npm test` after each.

## 9. Progress

- [x] Phase 0 — baseline and session harness (`tools/experiments/session.ts`)
- [x] Phase 1 — grip slide and Carry (upright hilt carry; 0 falls in carry/carry2/carry3/long at carrySpeed 2.0)
- [~] Phase 3 (part) — READY auto-approach + gravity chop works; damaging hits at the 6.5 m/s threshold only at about 2.1 m. Thrust dropped.
- [~] Chop recovery (round 7, option A chosen): let go on the strike, approach, grab at the balance point, deadlift to chest (hands 0.12 m out), raise at 0.5 rad/s eased in while lifting hands 0.4 m, slide to hilt. Completes on some targets; falls remain after the strike / on oblique chops. Earlier attempts: Tried: regrip with planted feet (falls forward), regrip walking up the blade (completes; falls in raise), lean over the system COM (worse), low hands (worse), let go and pick up at the balance point (`release()`/`grab()` + approach/pickup/lift; fails because he cannot stand empty-handed). Needs a design decision; see the round-6 report.
- [~] Phase 2 — technique state machine and input (in the game by default, T toggles; READY + chop-here only)
- [ ] Phase 3 — charge and thrust
- [ ] Phase 4 — drag and spin (4a / 4b / 4c)
- [ ] Phase 5 — drop
- [ ] Phase 6 — plant, recovery, robustness
- [ ] Phase 7 — readability and content retune
