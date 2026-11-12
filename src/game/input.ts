import * as THREE from 'three';
import type { PlayerCommand } from '../physics/player/player';

/** Raw input state → PlayerCommand (camera relative). */
export class Input {
  readonly keys = new Set<string>();
  private dragging = false;
  private orbiting = false;
  private dragAccum = new THREE.Vector2();
  private dragVel = new THREE.Vector2(); // smoothed px/s
  private pendingReach = 0;
  private jumpPressed = false;
  orbitDelta = new THREE.Vector2();
  onKey: (code: string) => void = () => {};
  swingSensitivity = 0.014; // rad per pixel
  keySwingRate = 6; // rad/s

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space') this.jumpPressed = true;
        this.onKey(e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.dragging = false; this.orbiting = false; });
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

  get isDragging(): boolean { return this.dragging; }

  /** Build this frame's command. cameraYaw: heading the camera looks along (0 = +Z). */
  command(dt: number, cameraYaw: number, reachSpeed: number, out: PlayerCommand): PlayerCommand {
    const k = this.keys;
    const fwd = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const right = new THREE.Vector3(-Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
    out.move.set(0, 0, 0);
    if (k.has('KeyW')) out.move.add(fwd);
    if (k.has('KeyS')) out.move.sub(fwd);
    if (k.has('KeyD')) out.move.add(right);
    if (k.has('KeyA')) out.move.sub(right);
    if (out.move.lengthSq() > 1) out.move.normalize();
    // while walking, the legs try to turn him to face where the camera looks
    out.face = out.move.lengthSq() > 0.01 ? cameraYaw : null;

    // drag velocity (px/s), lightly smoothed so a held mouse means "hold"
    const inst = this.dragAccum.clone().divideScalar(Math.max(dt, 1e-3));
    this.dragAccum.set(0, 0);
    if (!this.dragging) inst.set(0, 0);
    this.dragVel.lerp(inst, 1 - Math.exp(-dt / 0.06));
    // drag right = sword moves right on screen = clockwise seen from above (negative yaw)
    let yaw = -this.dragVel.x * this.swingSensitivity;
    let pitch = -this.dragVel.y * this.swingSensitivity;
    if (k.has('ArrowLeft')) yaw += this.keySwingRate;
    if (k.has('ArrowRight')) yaw -= this.keySwingRate;
    if (k.has('ArrowUp')) pitch += this.keySwingRate;
    if (k.has('ArrowDown')) pitch -= this.keySwingRate;
    out.swingYaw = yaw;
    out.swingPitch = pitch;

    const rate = THREE.MathUtils.clamp(this.pendingReach / Math.max(dt, 1e-3), -reachSpeed, reachSpeed);
    out.reach = rate;
    this.pendingReach -= rate * dt;
    if (Math.abs(this.pendingReach) < 1e-4) this.pendingReach = 0;

    out.jump = out.jump || this.jumpPressed;
    this.jumpPressed = false;
    return out;
  }

  takeOrbit(): THREE.Vector2 {
    const d = this.orbitDelta.clone();
    this.orbitDelta.set(0, 0);
    return d;
  }
}
