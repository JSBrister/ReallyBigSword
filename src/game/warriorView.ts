import * as THREE from 'three';
import type { Player } from '../physics/player/player';
import { GEOM } from '../physics/player/geometry';
import { q4, v3 } from '../physics/mathUtil';

const std = (color: number, rough = 0.55, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const MAT = {
  skin: std(0xf2c9a0, 0.7),
  hair: std(0xff6a1a, 0.45),
  armor: std(0x3a4fa8, 0.35, 0.6),
  armorTrim: std(0xe8c050, 0.3, 0.8),
  cloth: std(0x262033, 0.8),
  leather: std(0x6b3d1e, 0.75),
  boot: std(0x2a1d16, 0.6),
  cape: new THREE.MeshStandardMaterial({ color: 0xb01828, roughness: 0.7, side: THREE.DoubleSide }),
  eye: std(0x111111, 0.2),
  eyeWhite: std(0xffffff, 0.3),
  steel: std(0xc9ced8, 0.28, 0.85),
  steelDark: std(0x8a909c, 0.4, 0.8),
  grip: std(0x3b2414, 0.9),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos?: [number, number, number], rot?: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

/** A unit cylinder along +Y (height 1) that we stretch between two points. */
function limb(radiusTop: number, radiusBottom: number, mat: THREE.Material) {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 10);
  g.translate(0, 0.5, 0);
  return mesh(g, mat);
}
const tmpDir = new THREE.Vector3();
function placeLimb(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  m.position.copy(a);
  tmpDir.copy(b).sub(a);
  const len = tmpDir.length();
  m.scale.set(1, Math.max(len, 1e-3), 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpDir.normalize());
}

/** Two-bone IK: returns the middle joint for root->target with given lengths, bending toward pole. */
export function twoBoneIK(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): THREE.Vector3 {
  const d = target.clone().sub(root);
  const dist = THREE.MathUtils.clamp(d.length(), 1e-3, l1 + l2 - 1e-3);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dir, -dir.z);
  bend.normalize();
  return root.clone().addScaledVector(dir, a).addScaledVector(bend, h);
}

/** Build the absurdly plain giant sword. Local +Y along the blade, grip at the origin. */
export function buildSword(length: number): THREE.Group {
  const g = new THREE.Group();
  const bladeLen = length - GEOM.pommel - GEOM.bladeStart;
  const blade = mesh(new THREE.BoxGeometry(GEOM.bladeWidth, bladeLen, GEOM.bladeThickness), MAT.steel,
    [0, GEOM.bladeStart + bladeLen / 2, 0]);
  // a blunt-ish tip: a flattened pyramid
  const tip = mesh(new THREE.ConeGeometry(GEOM.bladeWidth / 2 * 1.41, 0.32, 4, 1), MAT.steel,
    [0, GEOM.bladeStart + bladeLen + 0.16 - 0.001, 0], [0, Math.PI / 4, 0]);
  tip.scale.set(1, 1, GEOM.bladeThickness / GEOM.bladeWidth);
  blade.scale.y = 1 - 0.32 / bladeLen;
  blade.position.y -= 0.16;
  const fuller = mesh(new THREE.BoxGeometry(0.05, bladeLen * 0.8, GEOM.bladeThickness * 1.06), MAT.steelDark,
    [0, GEOM.bladeStart + bladeLen * 0.42, 0]);
  const guard = mesh(new THREE.BoxGeometry(0.72, 0.1, 0.12), MAT.steelDark, [0, GEOM.bladeStart - 0.05, 0]);
  const grip = mesh(new THREE.CylinderGeometry(0.045, 0.05, GEOM.pommel + GEOM.bladeStart - 0.1, 10), MAT.grip,
    [0, (GEOM.bladeStart - GEOM.pommel) / 2 - 0.05, 0]);
  const pommel = mesh(new THREE.SphereGeometry(0.08, 12, 8), MAT.steelDark, [0, -GEOM.pommel, 0]);
  g.add(blade, tip, fuller, guard, grip, pommel);
  return g;
}

/**
 * Generic anime-inspired hero: huge spiky hair, giant pauldrons, pointless belts, a cape and a
 * determined frown. Upper body rides on the physics body; limbs are solved with IK each frame.
 */
export class WarriorView {
  readonly root = new THREE.Group();
  readonly bodyGroup = new THREE.Group();
  readonly swordGroup: THREE.Group;
  private limbs: Record<string, THREE.Mesh> = {};
  private boots: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private cape: { mesh: THREE.Mesh; pts: THREE.Vector3[]; prev: THREE.Vector3[] };
  private flash = 0;

  constructor(swordLength: number) {
    this.buildBody();
    this.swordGroup = buildSword(swordLength);
    this.root.add(this.bodyGroup, this.swordGroup);
    // limbs live in world space
    const L = (name: string, r1: number, r2: number, m: THREE.Material) => {
      const x = limb(r1, r2, m); this.limbs[name] = x; this.root.add(x);
    };
    for (const s of ['L', 'R']) {
      L(s + 'thigh', 0.085, 0.1, MAT.cloth);
      L(s + 'shin', 0.07, 0.085, MAT.armor);
      L(s + 'upper', 0.065, 0.075, MAT.skin);
      L(s + 'fore', 0.06, 0.065, MAT.armor);
      const boot = mesh(new THREE.BoxGeometry(0.15, 0.12, 0.32), MAT.boot);
      this.boots.push(boot); this.root.add(boot);
      const hand = mesh(new THREE.SphereGeometry(0.07, 10, 8), MAT.leather);
      this.hands.push(hand); this.root.add(hand);
    }
    // cape: strip of quads simulated as a verlet chain (visual only)
    const segs = 7;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const capeMesh = new THREE.Mesh(geo, MAT.cape);
    capeMesh.castShadow = true;
    capeMesh.frustumCulled = false;
    this.root.add(capeMesh);
    this.cape = { mesh: capeMesh, pts: [], prev: [] };
  }

  private buildBody(): void {
    const b = this.bodyGroup;
    // hips & pointless belts
    b.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.22, 14), MAT.cloth, [0, 0.02, 0]));
    for (const [y, r, tilt] of [[0.1, 0.215, 0.12], [0.02, 0.21, -0.18], [-0.06, 0.2, 0.25]] as const) {
      const belt = mesh(new THREE.TorusGeometry(r, 0.025, 6, 20), MAT.leather, [0, y, 0], [Math.PI / 2 + tilt, 0, 0]);
      b.add(belt);
      b.add(mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), MAT.armorTrim, [0, y + Math.sin(tilt) * r, r + 0.01]));
    }
    // torso & breastplate
    b.add(mesh(new THREE.CylinderGeometry(0.25, 0.19, 0.5, 14), MAT.cloth, [0, 0.38, 0]));
    const plate = mesh(new THREE.SphereGeometry(0.27, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.armor, [0, 0.42, 0.02], [-Math.PI / 2 + 0.25, 0, 0]);
    plate.scale.set(1, 0.6, 1.05);
    b.add(plate);
    // crossing chest straps (they hold nothing)
    for (const s of [-1, 1]) {
      b.add(mesh(new THREE.BoxGeometry(0.06, 0.62, 0.03), MAT.leather, [0, 0.4, 0.2], [0.18, 0, s * 0.62]));
    }
    // gigantic pauldrons with spikes
    for (const s of [-1, 1]) {
      const p = mesh(new THREE.SphereGeometry(0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.armor, [s * 0.36, 0.62, 0], [0, 0, s * -0.35]);
      p.scale.set(1.25, 0.9, 1.1);
      b.add(p);
      b.add(mesh(new THREE.TorusGeometry(0.29, 0.03, 6, 20), MAT.armorTrim, [s * 0.36, 0.6, 0], [Math.PI / 2, s * 0.35, 0]));
      for (let k = 0; k < 3; k++) {
        b.add(mesh(new THREE.ConeGeometry(0.045, 0.22, 6), MAT.armorTrim,
          [s * (0.36 + 0.13 * k / 2), 0.83 - k * 0.05, -0.08 + 0.08 * k], [0.2, 0, s * (-0.4 - 0.25 * k)]));
      }
    }
    // neck & head
    b.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 10), MAT.skin, [0, 0.72, 0]));
    const head = mesh(new THREE.SphereGeometry(0.15, 18, 14), MAT.skin, [0, 0.88, 0.01]);
    head.scale.set(0.95, 1.05, 1);
    b.add(head);
    // determined face: big eyes, angry brows, flat mouth
    for (const s of [-1, 1]) {
      const white = mesh(new THREE.SphereGeometry(0.038, 10, 8), MAT.eyeWhite, [s * 0.055, 0.895, 0.13]);
      white.scale.set(1, 1.35, 0.4);
      const pupil = mesh(new THREE.SphereGeometry(0.022, 8, 6), MAT.eye, [s * 0.05, 0.89, 0.146]);
      pupil.scale.set(1, 1.4, 0.4);
      const brow = mesh(new THREE.BoxGeometry(0.085, 0.018, 0.02), MAT.eye, [s * 0.055, 0.952, 0.14], [0, 0, s * 0.42]);
      b.add(white, pupil, brow);
    }
    b.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.01), MAT.eye, [0, 0.815, 0.145]));
    // HUGE spiky hair
    const hair = new THREE.Group();
    hair.position.set(0, 0.95, -0.02);
    const rnd = (i: number) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 26; i++) {
      const th = (i / 26) * Math.PI * 2;
      const up = 0.25 + Math.abs(rnd(i)) * 0.9;
      const len = 0.3 + Math.abs(rnd(i + 7)) * 0.35;
      const dir = new THREE.Vector3(Math.sin(th) * 0.9, up, Math.cos(th) * 0.6 - 0.55).normalize();
      if (dir.z > 0.35) dir.z = 0.35; // keep the face visible
      const cone = mesh(new THREE.ConeGeometry(0.07, len, 6), MAT.hair);
      cone.position.copy(dir.clone().multiplyScalar(0.1 + len / 2));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      hair.add(cone);
    }
    hair.add(mesh(new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), MAT.hair, [0, -0.04, -0.01]));
    b.add(hair);
  }

  /** Brief red tint when hurt. */
  hurt(): void { this.flash = 0.25; }

  update(player: Player, dt: number): void {
    const body = player.body;
    const bp = v3(body.translation());
    const bq = q4(body.rotation());
    this.bodyGroup.position.copy(bp);
    this.bodyGroup.quaternion.copy(bq);
    this.swordGroup.position.copy(v3(player.sword.translation()));
    this.swordGroup.quaternion.copy(q4(player.sword.rotation()));
    const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(bq).add(bp);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bq);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(bq);

    // legs: hip -> ankle, knee bends forward
    player.feet.feet.forEach((f, i) => {
      const s = f.side < 0 ? 'L' : 'R';
      const hip = toWorld(f.side * -0.12, -0.05, 0);
      const ankle = f.worldPos.clone().add(new THREE.Vector3(0, 0.09, 0));
      const footFwd = new THREE.Vector3(Math.sin(f.worldYaw), 0, Math.cos(f.worldYaw));
      ankle.addScaledVector(footFwd, 0.0);
      const knee = twoBoneIK(hip, ankle, 0.47, 0.46, fwd.clone().add(footFwd).normalize());
      placeLimb(this.limbs[s + 'thigh'], hip, knee);
      placeLimb(this.limbs[s + 'shin'], knee, ankle);
      const boot = this.boots[i];
      boot.position.copy(ankle).addScaledVector(footFwd, 0.06).add(new THREE.Vector3(0, -0.035, 0));
      boot.rotation.set(0, f.worldYaw, 0);
    });

    // arms: shoulders -> grip (two hands stacked on the handle)
    const grip = v3(player.sword.translation());
    const sdir = new THREE.Vector3(0, 1, 0).applyQuaternion(q4(player.sword.rotation()));
    [-1, 1].forEach((s, i) => {
      const k = s < 0 ? 'L' : 'R';
      const shoulder = toWorld(-s * 0.3, 0.6, 0.02);
      const hand = grip.clone().addScaledVector(sdir, i === 0 ? -0.13 : 0.02);
      const elbow = twoBoneIK(shoulder, hand, 0.33, 0.33,
        right.clone().multiplyScalar(-s).add(new THREE.Vector3(0, -0.6, 0)).normalize());
      placeLimb(this.limbs[k + 'upper'], shoulder, elbow);
      placeLimb(this.limbs[k + 'fore'], elbow, hand);
      this.hands[i].position.copy(hand);
    });

    this.updateCape(toWorld, right, dt);

    if (this.flash > 0) {
      this.flash -= dt;
      MAT.skin.emissive.setRGB(this.flash * 3, 0, 0);
    } else MAT.skin.emissive.setRGB(0, 0, 0);
    void fwd;
  }

  private updateCape(toWorld: (x: number, y: number, z: number) => THREE.Vector3, right: THREE.Vector3, dt: number): void {
    const c = this.cape;
    const n = 8;
    const segLen = 0.17;
    const anchor = toWorld(0, 0.62, -0.2);
    if (c.pts.length === 0) {
      for (let i = 0; i < n; i++) { const p = anchor.clone().add(new THREE.Vector3(0, -i * segLen, 0)); c.pts.push(p); c.prev.push(p.clone()); }
    }
    const h = Math.min(dt, 1 / 30);
    for (let i = 1; i < n; i++) {
      const p = c.pts[i], pr = c.prev[i];
      const v = p.clone().sub(pr).multiplyScalar(0.96);
      pr.copy(p);
      p.add(v).add(new THREE.Vector3(0, -9.8 * h * h, 0));
    }
    c.pts[0].copy(anchor); c.prev[0].copy(anchor);
    const back = toWorld(0, 0.62, -0.5).sub(anchor).normalize();
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        const a = c.pts[i - 1], b = c.pts[i];
        const d = b.clone().sub(a);
        const l = d.length() || 1e-6;
        const corr = d.multiplyScalar((l - segLen) / l);
        if (i === 1) b.sub(corr); else { a.addScaledVector(corr, 0.5); b.addScaledVector(corr, -0.5); }
      }
      // keep the cape behind the body and above the floor
      for (let i = 1; i < n; i++) {
        const rel = c.pts[i].clone().sub(anchor);
        const behind = rel.dot(back);
        if (behind < 0.02 * i) c.pts[i].addScaledVector(back, 0.02 * i - behind);
        if (c.pts[i].y < 0.03) c.pts[i].y = 0.03;
      }
    }
    const pos = c.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const w = 0.26 + i * 0.03;
      const p = c.pts[i];
      pos.setXYZ(i * 2, p.x - right.x * w, p.y - right.y * w, p.z - right.z * w);
      pos.setXYZ(i * 2 + 1, p.x + right.x * w, p.y + right.y * w, p.z + right.z * w);
    }
    pos.needsUpdate = true;
    c.mesh.geometry.computeVertexNormals();
    c.mesh.geometry.computeBoundingSphere();
  }

  resetCape(): void { this.cape.pts = []; this.cape.prev = []; }

  dispose(): void {
    this.root.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
  }
}
