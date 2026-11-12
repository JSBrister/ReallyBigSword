# Really Big Sword

A physics-honest heavy-sword dungeon brawler for the browser (Three.js + Rapier, Vite + TypeScript).

Your sword weighs 150 kg and you weigh 90. Momentum and angular momentum are conserved. Your feet grip only as well as friction allows. Nothing pushes on you from nowhere.

## Play

```bash
npm install
```

```bash
npm run dev
```

| | Keyboard / mouse | Gamepad (standard mapping) |
|---|---|---|
| Walk | WASD (camera relative; you also turn toward the camera while walking) | left stick |
| Swing | arrows or IJKL · or hold LMB + drag | face buttons (Y up, A down, X left, B right) · or right stick |
| Grip (hold still) | Shift | RT |
| Named attacks | 1 slam · 2 sweep left · 3 sweep right · 4 spin (hold) | LT + Y / X / B / A |
| Reach | Q / E or mouse wheel | D-pad up / down |
| Jump | Space | RB |
| Camera | RMB drag | D-pad left / right (or the right stick; set in F1 → Controls) |
| Menu | R restart room · Esc pause · F1 debug + tunables · M mute | Back restart · Start pause · L3 debug |

**How swinging works.**
- A swing input applies a *torque* in that direction, up to `swordEffort` (2 kN·m), to the sword and, equal and opposite, to you. It does not set a target pose.
- Let go and the blade keeps going on its own momentum until it slows to a stop or hits something. Then you settle your grip and carry it there. Grip stops it immediately.
- Every swing braces your legs: a slight crouch, a wider stance and stiffer hips. A balance reflex eases off the swing if you start to go over.
- Named attacks are short scripted sequences. The slam is raise → brace and wait for both feet → strike → plant. The sweeps are level the blade → brace → sweep → follow through. The spin is level the blade → keep pushing while held → follow through.

You start in the **Training Ground**: a big open room with dummies that never move or fight back, and stand back up a few seconds after being knocked down. It has a row of left, right and top shielded dummies, a stone pillar, an oil patch and signposts, and shows a physics readout in the corner. The door north leads to the real goblins.

Tips:
- Slams work best close in (about 1.4 m), standing still and lined up: as the blade goes forward you get pushed back about a metre.
- Big horizontal swings mostly spin *you*.
- Holding the sword straight out will tip you over.

## The one rule

No force or torque acts on the warrior or the sword from nowhere. The only sources are:

1. **Sword actuator** (`src/physics/player/actuators.ts`). These are Rapier spherical-joint angular velocity motors between body and sword. The solver applies them as exact equal-and-opposite impulse pairs, clamped to `swordMaxTorque` (20 kN·m).
2. **Foot–ground contact** (`src/physics/player/feet.ts`). This covers normal force (N ≥ 0) and friction (≤ μs·N sticking, μk·N slipping, with hysteresis). The resulting wrench acts at a centre of pressure that never leaves the support polygon.
3. **Gravity and ordinary engine collisions.**

Enforcement:

- **Statically:** `tests/forceLint.test.ts` fails if `applyImpulse`/`addForce`/`addTorque`/... or joint-motor calls appear anywhere else, or if anything else opens force authority.
- **At runtime:** player bodies are wrapped (`src/physics/forceGuard.ts`), so calling a force method on them from anywhere else throws.

The "physics cheats" in the F1 panel (Sticky Feet, Infinite Friction, Weightless Sword, Air Control) are off by default and exist to demonstrate the joke.

## Tests

```bash
npm test
```

The suites cover the following (all passing):

1. **Airborne angular momentum** about the system COM, while swinging hard, is constant to under 1% of the moving momentum.
2. **Airborne COM** follows the gravity parabola to within 1.5 mm.
3. **Friction limits:** friction never exceeds μs·N while sticking or μk·N while slipping. A sustained overload slips without stick/slip chatter.
4. **Static vs kinetic:** a push between μk·N and μs·N does not start a slide; after a shove, the same push keeps it sliding.
5. **Toppling:** holding the sword upright does not topple him; holding it horizontally out front does.
6. **Spin:** a sustained horizontal swing slips the feet and spins the body the other way (about −8 rad/s).
7. **Damage:**
   - below the threshold there is no damage, but the goblin is shoved;
   - above it the goblin is damaged and launched, and damage scales with speed;
   - a shield face blocks and the sword bounces back;
   - the same blow from the unshielded side hurts;
   - a top shield stops slams;
   - a real slam from the warrior hurts.
8. **Force-source lint**, plus runtime guard checks.

There are also walking and jumping checks.

## Deploying

`.github/workflows/deploy.yml` runs the tests, builds and deploys to GitHub Pages on every push. **GitHub Pages must be enabled once** in the repository settings (Settings → Pages → Source: *GitHub Actions*). The workflow token is not allowed to enable it itself, so until then the deploy job fails after the tests and build succeed. Vite's `base` is `/ReallyBigSword/`.

## Physics model and deviations from the brief

- **Warrior = one rigid body (90 kg) + sword (150 kg, 2.8 m, COM 1.45 m from the grip), joined by a ball joint at the grip.** The suggested pelvis + torso pair was tried first. The light pelvis between the stiff foot contacts and the heavy torso/sword was a floppy, near-singular mode that tipped over at the slightest step. Merging them fixed standing.
- **Legs are massless struts under a strength-limited hip.** They keep a heading-only stance frame, so the torso rocks on its hips while the feet stay planted. A balance controller asks for a hip torque. That torque is delivered by placing the centre of pressure, which is clamped to the support polygon, and is also limited by `hipMaxTorque`. This replaces the suggested torso balance actuator. Walking, turning and getting up all became stable with it.
- **Friction is solved at the velocity level.** It uses one load-shared planar wrench (force + twist) over the sticking contacts, rather than per-point springs. Explicit springs 0.6–1 m below a light body were unstable at any reasonable substep.
- **Leg drive.** Planted feet sweep backwards at "hip velocity + bounded acceleration". When standing, they hold position. An integrated sweep velocity that ignored what the hips were doing made the feet skate.
- **Reach** slides the grip anchor along the body's forward axis at a limited speed. The joint constraint supplies the (internal, equal-and-opposite) forces, so reach isn't strength-limited.
- **Turning:** while walking, the stance legs twist the hips toward the camera direction through foot friction (friction-limited).
- **Free-swing actuator.** With no grip, the sword actuator is an explicit equal-and-opposite torque pair: your effort, plus support for the sword's weight about the grip, plus light damping. Weight support relaxes while you push the blade down, so gravity helps a slam. It also relaxes while the blade rests on something. The weight support still reacts on your body, so holding the sword out still tips you. Grip, and carrying after a swing has settled, use the joint motors as before.
- **Bracing** is real physics with a little tolerance:
  - the hips drop up to `braceCrouch` (0.14 m);
  - the stance widens by up to `braceWiden` (0.1 m);
  - the hip strength cap doubles;
  - the **balance reflex** fades swing effort out between about 17° and 40° of body tilt (it only ever weakens the internal actuator).
  - A split stance along the blade (`braceStagger`) is implemented but defaults to 0, because the extra steps it triggers made slams *worse* in tests.
- **Balance governor (optional, off by default).** Scales swing effort down to 25% while the feet can't deliver the balance torque they're asked for, or while you're tilting. In tests it prevents slam falls but roughly halves slam speed, which puts hits below the damage threshold.
- **Damage threshold default is 6.5 m/s** (the brief said ~8, tunable). An honest slam that doesn't topple you lands at 7–7.5 m/s.
- **Getting up (explicit rule, not a force).** After a topple, the legs plant under the hips and the hip torque tries to bring the torso up; the sword grip goes limp meanwhile. This usually works, but with the sword lying on the floor it sometimes stalls kneeling. **If he is still down after `standUpDelay` (2.5 s), he is placed back on his feet where he lies**, with an on-screen "Heave!". This is a visible teleport-style game rule, chosen over a hidden righting force.
- **Rapier conserves angular momentum** for these bodies, so no integrator correction is applied (an early check suggesting otherwise was wrong).
- **Goblins cheat as specified.** They set their own velocity and heading, and lunge as a one-off launch, so the knockback is just a 35 kg goblin's momentum. Hits above the threshold make them free rigid bodies. Shields are separate kinematic bodies glued to the goblin each step, so blocked swords genuinely bounce off and the warrior recoils.

## What works

- Standing, walking in any direction (including circles, reversing and backwards) at 1.6 m/s.
- Turning, jumping (~0.6 m), the friction-limited spin with dust plumes, and the toppling demo.
- Dust (scaled by slip speed × N), sparks and placeholder clang/thud audio scaled by impact speed.
- IK legs and arms, cape, HUD.
- F1 overlay: COM and its ground projection, support polygon, capture point, per-contact stick/slip and F/μN, angular momentum, actuator %. Tunables panel included.
- Dungeon: a 14 m hall, a corridor narrower than the sword, a low vault with a 2.75 m ceiling, and a cellar with an oil slick. Doors open when a room is cleared; respawn at the room start; R restarts the room.

## What feels wrong / open problems

**Update (controls rework):** with effort-based controls at 2 kN·m, the balance reflex, and bracing without the split stance, a standing slam on a target about 1.4 m away lands at 7–7.5 m/s and he stays up. A slam that misses and hits the floor, a sweep, or a long spin still usually topples him. The automatic stand-up then puts him back on his feet. The original analysis below still describes why.

**Overhead slams usually topple the warrior.** A vertical swing transfers most of the relative rotation to the body: torso pitch inertia is ~24 kg·m² against ~400 kg·m² for the sword about the grip. The ground can return only about weight × half a foot ≈ 350 N·m. In headless bot playtests of room 1, slams at 5–14 rad/s knocked him over about half the time, and few hits cleared the 8 m/s threshold. This is the joke working, but it makes the early rooms very hard.

Tuning tried for slams:

| Variable | Values tried |
|---|---|
| `swordMaxTorque` | 4 000 / 6 000 / 8 000 / 10 000 / 20 000 N·m |
| swing rate | 4 / 6 / 8 / 14 / 30 rad/s (default cap now 10) |
| hip | `hipStiffness` 6 000 → 20 000, `hipDamping` 900 → 2 500, `hipMaxTorque` 4 000 |
| feet | 26 → 42 cm long, stance half-width 0.17 → 0.20 m |
| leg springs | 4 kN/m with 12 cm travel vs 150 kN/m stiff |
| legs | a "rigid legs that tip about the heel/toe edge" model vs massless legs (helped slams, broke walking) |

None of these made slams reliably survivable without breaking walking.

The most effective honest technique found:

- Building a spin over a few seconds reaches 10–20 m/s at the tip, but usually ends in a topple.
- A slam at ~1.6 m range lands 8–10 m/s.

Other known issues:

- The kneeling get-up sometimes stalls, which is why the explicit stand-up rule exists.
- Goblin ragdolls are single rigid bodies, not articulated.
- The sword actuator % readout spikes during impacts, because it is inferred from the sword's own dynamics.

## Layout

```
src/physics/       rapier init, world, tunables, force guard, impacts, goblins
src/physics/player player (bodies), feet (contact model), actuators, controller (gait/balance), metrics
src/game/          game loop, input, camera, warrior/goblin views, particles, audio, HUD, debug, level
tests/             vitest suites (headless Rapier)
```
