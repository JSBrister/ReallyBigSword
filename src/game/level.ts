import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/world';
import type { ShieldSide } from '../physics/goblin';

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface RoomDef {
  name: string;
  hint: string;
  rect: Rect;
  ceiling: number;
  spawn: THREE.Vector3;
  spawnHeading: number;
  goblins: { pos: THREE.Vector3; shield: ShieldSide }[];
  /** Door in the north wall that opens when this room is cleared. */
  exit?: { x0: number; x1: number; z: number };
  slick?: Rect[];
}

const W = 0.5; // wall thickness

export const ROOMS: RoomDef[] = [
  {
    name: 'The Training Hall', hint: 'Two goblins. Bring the blade down on them: horizontal swings mostly spin you.',
    rect: { x0: -7, x1: 7, z0: 0, z1: 14 }, ceiling: 7, spawn: new THREE.Vector3(0, 0, 2.5), spawnHeading: 0,
    goblins: [{ pos: new THREE.Vector3(-3, 0, 9), shield: 'none' }, { pos: new THREE.Vector3(3, 0, 10.5), shield: 'none' }],
    exit: { x0: -1.1, x1: 1.1, z: 14 },
  },
  {
    name: 'The Squeeze', hint: 'A corridor narrower than your sword is long. Turning around will be... a project.',
    rect: { x0: -1.1, x1: 1.1, z0: 14, z1: 24 }, ceiling: 3.6, spawn: new THREE.Vector3(0, 0, 15.2), spawnHeading: 0,
    goblins: [{ pos: new THREE.Vector3(0, 0, 21.5), shield: 'none' }],
    exit: { x0: -1.1, x1: 1.1, z: 24 },
  },
  {
    name: 'The Low Vault', hint: 'The ceiling is low. Overhead slams will find it first. One goblin wears its shield as a hat.',
    rect: { x0: -7, x1: 7, z0: 24, z1: 38 }, ceiling: 2.75, spawn: new THREE.Vector3(0, 0, 25.6), spawnHeading: 0,
    goblins: [
      { pos: new THREE.Vector3(-3, 0, 31), shield: 'none' },
      { pos: new THREE.Vector3(2.5, 0, 33), shield: 'top' },
      { pos: new THREE.Vector3(0, 0, 36), shield: 'none' },
    ],
    exit: { x0: -1.6, x1: 1.6, z: 38 },
  },
  {
    name: 'The Slick Cellar', hint: 'Something spilled. Shield goblins turn to face you, so a spin always lands on the same side.',
    rect: { x0: -8, x1: 8, z0: 38, z1: 54 }, ceiling: 7, spawn: new THREE.Vector3(0, 0, 39.6), spawnHeading: 0,
    goblins: [
      { pos: new THREE.Vector3(-3.5, 0, 47), shield: 'left' },
      { pos: new THREE.Vector3(3.5, 0, 48), shield: 'right' },
      { pos: new THREE.Vector3(0, 0, 51.5), shield: 'none' },
      { pos: new THREE.Vector3(-5.5, 0, 52), shield: 'top' },
    ],
    slick: [{ x0: -4, x1: 4, z0: 42, z1: 50 }],
  },
];

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256, repeat = 1): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stoneTexture(base: string, line: string, rows = 4): THREE.Texture {
  return canvasTexture((g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * h;
      for (let x = -h; x < s + h; x += h * 2) {
        const shade = 0.85 + Math.random() * 0.25;
        g.fillStyle = `rgba(${Math.floor(120 * shade)},${Math.floor(112 * shade)},${Math.floor(104 * shade)},0.35)`;
        g.fillRect(x + off + 2, r * h + 2, h * 2 - 4, h - 4);
      }
      g.strokeStyle = line; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, r * h); g.lineTo(s, r * h); g.stroke();
      for (let x = off; x < s; x += h * 2) { g.beginPath(); g.moveTo(x, r * h); g.lineTo(x, r * h + h); g.stroke(); }
    }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  });
}

export class Level {
  readonly group = new THREE.Group();
  readonly doors: { collider: RAPIER.Collider; mesh: THREE.Mesh; open: boolean; t: number }[] = [];
  private floorMat: THREE.MeshStandardMaterial;
  private wallMat: THREE.MeshStandardMaterial;
  private ceilMat: THREE.MeshStandardMaterial;

  constructor(private pw: PhysicsWorld, scene: THREE.Scene) {
    const ft = stoneTexture('#5d5650', '#3a3430', 4);
    this.floorMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9 });
    const wt = stoneTexture('#4a4440', '#2b2622', 6);
    this.wallMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.95 });
    this.ceilMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 1, side: THREE.DoubleSide });
    for (const r of ROOMS) this.buildRoom(r);
    for (const r of ROOMS) if (r.exit) this.buildDoor(r);
    scene.add(this.group);
  }

  private box(center: THREE.Vector3, half: THREE.Vector3, mat: THREE.Material, slick = false, collide = true, texScale = 2): THREE.Mesh {
    if (collide) this.pw.addStaticBox(center, half, { kind: slick ? 'slick' : 'stone' });
    const geo = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
    // scale UVs so the stone pattern keeps its size
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const sx = ax > 0.5 ? half.z : half.x, sy = ay > 0.5 ? half.z : half.y;
      uv.setXY(i, uv.getX(i) * sx * 2 / texScale, uv.getY(i) * sy * 2 / texScale);
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(center);
    m.receiveShadow = true;
    m.castShadow = !slick && half.y > 0.3;
    this.group.add(m);
    return m;
  }

  private buildRoom(r: RoomDef): void {
    const { x0, x1, z0, z1 } = r.rect;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
    // floor (with slick patches cut out of the stone)
    const floorRects = r.slick ? subtract({ x0, x1, z0, z1 }, r.slick[0]) : [{ x0, x1, z0, z1 }];
    for (const f of floorRects) {
      this.box(new THREE.Vector3((f.x0 + f.x1) / 2, -0.5, (f.z0 + f.z1) / 2), new THREE.Vector3((f.x1 - f.x0) / 2, 0.5, (f.z1 - f.z0) / 2), this.floorMat);
    }
    for (const s of r.slick ?? []) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a7fa0, roughness: 0.08, metalness: 0.3 });
      this.box(new THREE.Vector3((s.x0 + s.x1) / 2, -0.5, (s.z0 + s.z1) / 2), new THREE.Vector3((s.x1 - s.x0) / 2, 0.5, (s.z1 - s.z0) / 2), mat, true);
    }
    const h = r.ceiling;
    // side walls
    for (const x of [x0 - W / 2, x1 + W / 2]) this.box(new THREE.Vector3(x, h / 2, cz), new THREE.Vector3(W / 2, h / 2, hz + W), this.wallMat);
    // south & north walls with openings where corridors/doors are
    const prev = ROOMS[ROOMS.indexOf(r) - 1];
    const southGap = prev?.exit && prev.exit.z === z0 ? prev.exit : null;
    const northGap = r.exit ?? null;
    this.wallWithGap(z0 - W / 2, x0 - W, x1 + W, h, southGap);
    this.wallWithGap(z1 + W / 2, x0 - W, x1 + W, h, northGap);
    // ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 2 * W, hz * 2 + 2 * W), this.ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, h, cz);
    this.group.add(ceil);
    this.pw.addStaticBox(new THREE.Vector3(cx, h + 0.25, cz), new THREE.Vector3(hx + W, 0.25, hz + W));
    // torches
    const light = new THREE.PointLight(0xffa860, 30, Math.max(hx, hz) * 2.6, 1.6);
    light.position.set(cx, Math.min(h - 0.3, 4), cz);
    this.group.add(light);
    for (const [tx, tz] of [[x0 + 0.05, cz - hz * 0.5], [x1 - 0.05, cz + hz * 0.5]]) {
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
      flame.position.set(tx, Math.min(2.1, h - 0.4), tz);
      this.group.add(flame);
    }
  }

  private wallWithGap(z: number, xa: number, xb: number, h: number, gap: { x0: number; x1: number } | null): void {
    const seg = (a: number, b: number) => {
      if (b - a < 0.01) return;
      this.box(new THREE.Vector3((a + b) / 2, h / 2, z), new THREE.Vector3((b - a) / 2, h / 2, W / 2), this.wallMat);
    };
    if (!gap) { seg(xa, xb); return; }
    seg(xa, gap.x0); seg(gap.x1, xb);
    // lintel above the opening
    const lh = 3.2;
    if (h > lh) this.box(new THREE.Vector3((gap.x0 + gap.x1) / 2, (h + lh) / 2, z), new THREE.Vector3((gap.x1 - gap.x0) / 2, (h - lh) / 2, W / 2), this.wallMat);
  }

  private buildDoor(r: RoomDef): void {
    const e = r.exit!;
    const hh = 1.6;
    const center = new THREE.Vector3((e.x0 + e.x1) / 2, hh, e.z + W / 2);
    const half = new THREE.Vector3((e.x1 - e.x0) / 2, hh, W / 2 * 0.8);
    const collider = this.pw.addStaticBox(center, half);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), mat);
    mesh.position.copy(center);
    mesh.castShadow = true;
    // iron bands
    for (const y of [-0.9, 0, 0.9]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2 + 0.02, 0.1, half.z * 2 + 0.04), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.4 }));
      band.position.y = y;
      mesh.add(band);
    }
    this.group.add(mesh);
    this.doors.push({ collider, mesh, open: false, t: 0 });
  }

  openDoor(i: number): void {
    const d = this.doors[i];
    if (!d || d.open) return;
    d.open = true;
    this.pw.world.removeCollider(d.collider, true);
  }

  update(dt: number): void {
    for (const d of this.doors) {
      if (!d.open || d.t >= 1) continue;
      d.t = Math.min(1, d.t + dt * 0.8);
      d.mesh.position.y = 1.6 - d.t * 3.4; // sinks into the floor
    }
  }

  /** Index of the room containing a point (rooms are disjoint), or -1. */
  roomAt(p: THREE.Vector3): number {
    return ROOMS.findIndex((r) => p.x >= r.rect.x0 - 0.3 && p.x <= r.rect.x1 + 0.3 && p.z >= r.rect.z0 && p.z < r.rect.z1);
  }
}

function subtract(a: Rect, b: Rect): Rect[] {
  const out: Rect[] = [];
  if (b.z0 > a.z0) out.push({ x0: a.x0, x1: a.x1, z0: a.z0, z1: b.z0 });
  if (b.z1 < a.z1) out.push({ x0: a.x0, x1: a.x1, z0: b.z1, z1: a.z1 });
  if (b.x0 > a.x0) out.push({ x0: a.x0, x1: b.x0, z0: b.z0, z1: b.z1 });
  if (b.x1 < a.x1) out.push({ x0: b.x1, x1: a.x1, z0: b.z0, z1: b.z1 });
  return out;
}
