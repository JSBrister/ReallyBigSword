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

  /** Optional: returns the free distance along a ray (for not clipping into walls). */
  collide: ((from: THREE.Vector3, dir: THREE.Vector3, max: number) => number) | null = null;
  private dist = 7.5;

  update(dt: number, follow: THREE.Vector3, ceiling = Infinity): void {
    const goal = follow.clone().add(new THREE.Vector3(0, 1.1, 0));
    if (!this.initialised) { this.target.copy(goal); this.initialised = true; }
    this.target.lerp(goal, 1 - Math.exp(-dt * 6));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let d = this.distance;
    if (this.collide) d = Math.max(1.2, Math.min(d, this.collide(this.target, dir, d + 0.3) - 0.3));
    // pull in fast, ease back out
    this.dist = d < this.dist ? d : this.dist + (d - this.dist) * (1 - Math.exp(-dt * 3));
    const pos = this.target.clone().addScaledVector(dir, this.dist);
    if (pos.y > ceiling - 0.3) pos.y = ceiling - 0.3;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  snap(): void { this.initialised = false; }
}
