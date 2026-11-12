import * as THREE from 'three';

/** Third-person orbit camera that follows the warrior's position but never its rotation. */
export class FollowCamera {
  yaw = Math.PI; // camera sits behind a warrior facing +Z, looking along +Z
  pitch = 0.32;
  distance = 7.5;
  readonly target = new THREE.Vector3();
  private initialised = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Heading the camera looks along (0 = +Z): used for camera-relative movement. */
  get lookYaw(): number { return this.yaw + Math.PI; }

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.15, 1.3);
  }

  update(dt: number, follow: THREE.Vector3, ceiling = Infinity): void {
    const goal = follow.clone().add(new THREE.Vector3(0, 1.1, 0));
    if (!this.initialised) { this.target.copy(goal); this.initialised = true; }
    this.target.lerp(goal, 1 - Math.exp(-dt * 6));
    const d = this.distance;
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch) * d,
      Math.sin(this.pitch) * d,
      Math.cos(this.yaw) * Math.cos(this.pitch) * d,
    );
    const pos = this.target.clone().add(off);
    if (pos.y > ceiling - 0.3) pos.y = ceiling - 0.3;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  snap(): void { this.initialised = false; }
}
