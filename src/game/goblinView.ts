import * as THREE from 'three';
import type { Goblin, ShieldSide } from '../physics/goblin';
import { q4, v3 } from '../physics/mathUtil';

const skin = new THREE.MeshStandardMaterial({ color: 0x5fae3a, roughness: 0.7 });
const skinDark = new THREE.MeshStandardMaterial({ color: 0x3f7f25, roughness: 0.8 });
const rag = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.95 });
const wood = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.85 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffee55 });
export const SHIELD_COLOR: Record<ShieldSide, number> = { none: 0, left: 0x22c4c4, right: 0xff8a1e, top: 0xb04cff };

function m(geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r?: [number, number, number]) {
  const x = new THREE.Mesh(geo, mat);
  x.position.set(...p);
  if (r) x.rotation.set(...r);
  x.castShadow = true;
  return x;
}

export class GoblinView {
  readonly root = new THREE.Group();
  readonly shield: THREE.Group | null = null;
  private arm: THREE.Group;
  private mats: THREE.MeshStandardMaterial[] = [];
  private hpBar: THREE.Mesh;
  private hpBack: THREE.Mesh;

  constructor(readonly goblin: Goblin) {
    const r = this.root;
    const body = skin.clone();
    this.mats.push(body);
    r.add(m(new THREE.CapsuleGeometry(0.26, 0.3, 4, 10), rag, [0, -0.05, 0]));
    r.add(m(new THREE.SphereGeometry(0.2, 12, 10), body, [0, 0.12, 0.03]));
    const head = m(new THREE.SphereGeometry(0.22, 14, 10), body, [0, 0.62, 0.03]);
    head.scale.set(1.1, 0.95, 1);
    r.add(head);
    for (const s of [-1, 1]) {
      r.add(m(new THREE.ConeGeometry(0.07, 0.34, 6), body, [s * 0.27, 0.7, 0], [0, 0, s * -1.25]));
      r.add(m(new THREE.SphereGeometry(0.045, 8, 6), eyeMat, [s * 0.08, 0.67, 0.21]));
      r.add(m(new THREE.CapsuleGeometry(0.06, 0.25, 4, 6), skinDark, [s * 0.12, -0.48, 0.02]));
    }
    r.add(m(new THREE.ConeGeometry(0.05, 0.16, 6), skinDark, [0, 0.6, 0.27], [Math.PI / 2, 0, 0]));
    // weapon arm (right hand), crude club
    this.arm = new THREE.Group();
    this.arm.position.set(-0.28, 0.2, 0.05);
    this.arm.add(m(new THREE.CapsuleGeometry(0.05, 0.28, 4, 6), body, [0, -0.15, 0]));
    const club = new THREE.Group();
    club.position.set(0, -0.3, 0.05);
    club.add(m(new THREE.CylinderGeometry(0.03, 0.05, 0.55, 6), wood, [0, 0, 0.27], [Math.PI / 2, 0, 0]));
    club.add(m(new THREE.SphereGeometry(0.1, 7, 5), wood, [0, 0, 0.55]));
    this.arm.add(club);
    r.add(this.arm);
    if (goblin.shield !== 'none') {
      const sh = new THREE.Group();
      const col = new THREE.MeshStandardMaterial({ color: SHIELD_COLOR[goblin.shield], roughness: 0.5, metalness: 0.4, emissive: SHIELD_COLOR[goblin.shield], emissiveIntensity: 0.15 });
      const rim = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.3 });
      if (goblin.shield === 'top') {
        // a round lid worn like a hat
        sh.add(m(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 20), col, [0, 0, 0]));
        sh.add(m(new THREE.TorusGeometry(0.6, 0.03, 6, 24), rim, [0, 0, 0], [Math.PI / 2, 0, 0]));
        sh.add(m(new THREE.ConeGeometry(0.12, 0.2, 8), rim, [0, 0.14, 0]));
      } else {
        // a tall tower shield on one side
        sh.add(m(new THREE.BoxGeometry(0.1, 1.2, 1.0), col, [0, 0, 0]));
        const boss = m(new THREE.SphereGeometry(0.14, 10, 8), rim, [goblin.shield === 'left' ? 0.06 : -0.06, 0.05, 0]);
        boss.scale.set(0.5, 1, 1);
        sh.add(boss);
        sh.add(m(new THREE.BoxGeometry(0.12, 1.22, 0.06), rim, [0, 0, 0.47]));
        sh.add(m(new THREE.BoxGeometry(0.12, 1.22, 0.06), rim, [0, 0, -0.47]));
      }
      (this as { shield: THREE.Group | null }).shield = sh;
    }
    this.hpBack = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.06), new THREE.MeshBasicMaterial({ color: 0x220000, depthTest: false }));
    this.hpBar = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.06), new THREE.MeshBasicMaterial({ color: 0xe03030, depthTest: false }));
    this.hpBack.renderOrder = 10; this.hpBar.renderOrder = 11;
    this.root.traverse((o) => { o.castShadow = true; });
  }

  attach(scene: THREE.Scene): void {
    scene.add(this.root, this.hpBack, this.hpBar);
    if (this.shield) scene.add(this.shield);
  }

  detach(scene: THREE.Scene): void {
    scene.remove(this.root, this.hpBack, this.hpBar);
    if (this.shield) scene.remove(this.shield);
  }

  update(dt: number, camera: THREE.Camera): void {
    const g = this.goblin;
    this.root.position.copy(v3(g.body.translation()));
    this.root.quaternion.copy(q4(g.body.rotation()));
    if (this.shield && g.shieldBody) {
      this.shield.position.copy(v3(g.shieldBody.translation()));
      this.shield.quaternion.copy(q4(g.shieldBody.rotation()));
    }
    // club animation
    const target = g.state === 'windup' ? -2.2 : g.state === 'lunge' ? 0.9 : g.state === 'chase' ? -0.3 + Math.sin(performance.now() / 120) * 0.3 : -0.2;
    this.arm.rotation.x += (target - this.arm.rotation.x) * Math.min(1, dt * (g.state === 'lunge' ? 30 : 10));
    for (const mat of this.mats) mat.emissive.setRGB(g.flash * 4, g.flash * 2, g.flash * 2);
    const hpVisible = g.alive && g.hp < g.maxHp;
    this.hpBar.visible = this.hpBack.visible = hpVisible;
    if (hpVisible) {
      const p = this.root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      this.hpBack.position.copy(p); this.hpBar.position.copy(p);
      this.hpBack.quaternion.copy(camera.quaternion); this.hpBar.quaternion.copy(camera.quaternion);
      const f = Math.max(0, g.hp / g.maxHp);
      this.hpBar.scale.x = Math.max(0.001, f);
      this.hpBar.position.add(new THREE.Vector3(-(1 - f) * 0.3, 0, 0).applyQuaternion(camera.quaternion));
    }
    if (g.state === 'dead' && g.deadTime > 5) {
      const s = Math.max(0.01, 1 - (g.deadTime - 5) / 3);
      this.root.scale.setScalar(s);
      if (this.shield) this.shield.scale.setScalar(s);
    }
  }
}
