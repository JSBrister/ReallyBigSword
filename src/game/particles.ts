import * as THREE from 'three';

interface P { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; size: number; drag: number; grav: number; color: THREE.Color }

/** Pooled point-sprite particles (dust and sparks), one draw call per system. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private ps: P[] = [];
  private geom = new THREE.BufferGeometry();
  private posArr: Float32Array;
  private colArr: Float32Array;
  private sizeArr: Float32Array;

  constructor(private max: number, additive: boolean, texture: THREE.Texture) {
    this.posArr = new Float32Array(max * 3);
    this.colArr = new Float32Array(max * 4);
    this.sizeArr = new Float32Array(max);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colArr, 4));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.sizeArr, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, drag = 1.5, grav = 0): void {
    if (this.ps.length >= this.max) this.ps.shift();
    this.ps.push({ pos: pos.clone(), vel: vel.clone(), life, maxLife: life, size, drag, grav, color: color.clone() });
  }

  update(dt: number, fadeGrow = true): void {
    const keep: P[] = [];
    for (const p of this.ps) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.01 && p.grav > 0) { p.pos.y = 0.01; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      keep.push(p);
    }
    this.ps = keep;
    for (let i = 0; i < this.max; i++) {
      const p = this.ps[i];
      if (!p) { this.sizeArr[i] = 0; this.colArr[i * 4 + 3] = 0; continue; }
      const t = p.life / p.maxLife;
      this.posArr.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
      this.colArr.set([p.color.r, p.color.g, p.color.b, fadeGrow ? t * 0.55 : t], i * 4);
      this.sizeArr[i] = fadeGrow ? p.size * (1.8 - t) : p.size * t;
    }
    for (const n of ['position', 'color', 'size']) (this.geom.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function softDotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Dust from slipping feet and sparks from sword impacts. */
export class Effects {
  readonly dust: ParticleSystem;
  readonly sparks: ParticleSystem;
  private dustColor = new THREE.Color(0xb8aa94);
  private slickColor = new THREE.Color(0xc8dcff);
  private dustDebt = 0;

  constructor(scene: THREE.Scene) {
    const tex = softDotTexture();
    this.dust = new ParticleSystem(1500, false, tex);
    this.sparks = new ParticleSystem(600, true, tex);
    scene.add(this.dust.points, this.sparks.points);
  }

  /** Slip at a contact: intensity ~ slip speed x normal force. Always at least one puff. */
  footSlip(pos: THREE.Vector3, speed: number, N: number, dt: number, slick = false): void {
    const intensity = speed * N; // W of frictional power-ish
    this.dustDebt += Math.min(40, 2 + intensity / 120) * dt * 60 / 8;
    let n = Math.floor(this.dustDebt);
    this.dustDebt -= n;
    if (n === 0 && Math.random() < 0.3) n = 1;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * (0.6 + speed * 0.3), (Math.random() - 0.5) * 1.2);
      const size = 0.12 + Math.min(0.5, intensity / 9000) + Math.random() * 0.1;
      this.dust.emit(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.03, (Math.random() - 0.5) * 0.15)),
        v, 0.6 + Math.random() * 0.7, size, slick ? this.slickColor : this.dustColor, 2.2, 0);
    }
  }

  /** Sparks: count and speed scale with impact speed. */
  spark(pos: THREE.Vector3, normal: THREE.Vector3, speed: number, color = 0xffc070): void {
    const n = Math.min(60, 4 + Math.floor(speed * 2.5));
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        .addScaledVector(normal, 1.2).normalize();
      this.sparks.emit(pos, dir.multiplyScalar(2 + Math.random() * speed * 0.5), 0.25 + Math.random() * 0.4,
        0.05 + Math.random() * 0.05, c, 0.8, 9.8);
    }
  }

  update(dt: number): void {
    this.dust.update(dt, true);
    this.sparks.update(dt, false);
  }
}
