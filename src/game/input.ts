import * as THREE from 'three';
import type { PlayerCommand } from '../physics/player/player';
import type { AttackName } from '../physics/player/moves';

/**
 * Raw input → PlayerCommand. Keyboard, mouse and gamepad all produce the same thing: a camera-
 * relative move direction, a swing EFFORT direction (a torque, not a target pose), grip, reach,
 * jump and named attacks.
 *
 * Gamepad (standard mapping): left stick move · right stick swing (or camera, see stickMode) ·
 * face buttons swing up/down/left/right · RT grip · RB jump · LT + face button = named attack ·
 * D-pad up/down reach, left/right camera · Start pause · Back restart room · L3 debug overlay.
 */
export class Input {
  readonly keys = new Set<string>();
  private dragging = false;
  private orbiting = false;
  private dragAccum = new THREE.Vector2();
  private dragVel = new THREE.Vector2(); // smoothed px/s
  private pendingReach = 0;
  private jumpPressed = false;
  private attackPressed: AttackName | null = null;
  private padPrev: boolean[] = [];
  orbitDelta = new THREE.Vector2();
  onKey: (code: string) => void = () => {};
  /** Pixels per second of mouse drag that count as a full-strength swing. */
  dragFullSpeed = 700;
  /** What the right stick does: swing the sword, or orbit the camera. */
  stickMode: 'sword' | 'camera' = 'sword';
  padConnected = false;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Tab', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space') this.jumpPressed = true;
        const atk: Record<string, AttackName> = { Digit1: 'slam', Digit2: 'sweepLeft', Digit3: 'sweepRight', Digit4: 'spin' };
        if (atk[e.code]) this.attackPressed = atk[e.code];
        this.onKey(e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.dragging = false; this.orbiting = false; });
    window.addEventListener('gamepadconnected', () => { this.padConnected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.dragging = true;
      if (e.button === 2) this.orbiting = true;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.dragging = false;
      if (e.button === 2) this.orbiting = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) this.dragAccum.add(new THREE.Vector2(e.movementX, e.movementY));
      if (this.orbiting) this.orbitDelta.add(new THREE.Vector2(e.movementX, e.movementY));
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.pendingReach += -Math.sign(e.deltaY) * 0.1;
    }, { passive: false });
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Build this frame's command. cameraYaw: heading the camera looks along (0 = +Z). */
  command(dt: number, cameraYaw: number, reachSpeed: number, out: PlayerCommand): PlayerCommand {
    const k = this.keys;
    const fwd = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const right = new THREE.Vector3(-Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
    const move = new THREE.Vector2(0, 0); // x right, y forward
    const effort = new THREE.Vector2(0, 0); // x right, y up
    let grip = k.has('ShiftLeft') || k.has('ShiftRight');
    let spinHeld = k.has('Digit4');
    let reachKey = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);

    if (k.has('KeyW')) move.y += 1;
    if (k.has('KeyS')) move.y -= 1;
    if (k.has('KeyD')) move.x += 1;
    if (k.has('KeyA')) move.x -= 1;
    if (k.has('ArrowUp') || k.has('KeyI')) effort.y += 1;
    if (k.has('ArrowDown') || k.has('KeyK')) effort.y -= 1;
    if (k.has('ArrowRight') || k.has('KeyL')) effort.x += 1;
    if (k.has('ArrowLeft') || k.has('KeyJ')) effort.x -= 1;

    // mouse drag: drag speed sets swing effort (full effort at dragFullSpeed px/s)
    const inst = this.dragAccum.clone().divideScalar(Math.max(dt, 1e-3));
    this.dragAccum.set(0, 0);
    if (!this.dragging) inst.set(0, 0);
    this.dragVel.lerp(inst, 1 - Math.exp(-dt / 0.06));
    effort.x += this.dragVel.x / this.dragFullSpeed;
    effort.y -= this.dragVel.y / this.dragFullSpeed;

    // gamepad
    const p = this.pad();
    this.padConnected = !!p;
    if (p) {
      const b = (i: number) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      const edge = (i: number) => b(i) && !this.padPrev[i];
      const stick = (ax: number, ay: number) => {
        const v = new THREE.Vector2(p.axes[ax] ?? 0, p.axes[ay] ?? 0);
        const l = v.length();
        return l < 0.18 ? v.set(0, 0) : v.multiplyScalar(Math.min(1, (l - 0.18) / 0.82) / l);
      };
      const ls = stick(0, 1);
      move.x += ls.x; move.y -= ls.y;
      const rs = stick(2, 3);
      if (this.stickMode === 'sword') { effort.x += rs.x; effort.y -= rs.y; }
      else this.orbitDelta.add(new THREE.Vector2(rs.x, rs.y).multiplyScalar(600 * dt));
      const modifier = b(6); // LT: face buttons become named attacks
      if (modifier) {
        if (edge(3)) this.attackPressed = 'slam';
        if (edge(2)) this.attackPressed = 'sweepLeft';
        if (edge(1)) this.attackPressed = 'sweepRight';
        if (edge(0)) this.attackPressed = 'spin';
        spinHeld = spinHeld || b(0);
      } else {
        if (b(3)) effort.y += 1;
        if (b(0)) effort.y -= 1;
        if (b(1)) effort.x += 1;
        if (b(2)) effort.x -= 1;
      }
      grip = grip || b(7);
      if (edge(5)) this.jumpPressed = true;
      reachKey += (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
      if (b(14)) this.orbitDelta.x -= 500 * dt;
      if (b(15)) this.orbitDelta.x += 500 * dt;
      if (edge(9)) this.onKey('Escape');
      if (edge(8)) this.onKey('KeyR');
      if (edge(10)) this.onKey('F1');
      this.padPrev = p.buttons.map((_, i) => b(i));
    }

    out.move.set(0, 0, 0).addScaledVector(right, move.x).addScaledVector(fwd, move.y);
    if (out.move.lengthSq() > 1) out.move.normalize();
    // while walking, the legs try to turn him to face where the camera looks
    out.face = out.move.lengthSq() > 0.01 ? cameraYaw : null;

    if (effort.length() > 1) effort.normalize();
    out.effort.copy(effort);
    out.grip = grip;
    out.spinHeld = spinHeld;

    this.pendingReach += reachKey * reachSpeed * dt;
    const rate = THREE.MathUtils.clamp(this.pendingReach / Math.max(dt, 1e-3), -reachSpeed, reachSpeed);
    out.reach = rate;
    this.pendingReach -= rate * dt;
    if (Math.abs(this.pendingReach) < 1e-4) this.pendingReach = 0;

    out.jump = out.jump || this.jumpPressed;
    this.jumpPressed = false;
    if (this.attackPressed) { out.attack = this.attackPressed; this.attackPressed = null; }
    return out;
  }

  /** While paused only Start (resume) is read from the gamepad. */
  pollPaused(): void {
    const p = this.pad();
    if (!p) return;
    const start = !!p.buttons[9]?.pressed;
    if (start && !this.padPrev[9]) this.onKey('Escape');
    this.padPrev[9] = start;
  }

  takeOrbit(): THREE.Vector2 {
    const d = this.orbitDelta.clone();
    this.orbitDelta.set(0, 0);
    return d;
  }
}
