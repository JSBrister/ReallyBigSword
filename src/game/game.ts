import * as THREE from 'three';
import type { Rapier } from '../physics/rapier';
import { PhysicsWorld } from '../physics/world';
import { defaultTunables, type Tunables } from '../physics/tunables';
import { Player, emptyCommand, type PlayerCommand } from '../physics/player/player';
import { v3, q4 } from '../physics/mathUtil';
import { Input } from './input';
import { FollowCamera } from './camera';

/** Milestone-1 sandbox: flat floor, placeholder warrior, live sword actuator. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  readonly cam: FollowCamera;
  readonly tun: Tunables = { ...defaultTunables };
  pw!: PhysicsWorld;
  player!: Player;
  readonly input: Input;
  private cmd: PlayerCommand = emptyCommand();
  private meshes: { body: () => import('@dimforge/rapier3d-compat').RigidBody; mesh: THREE.Object3D }[] = [];
  private last = performance.now();
  paused = false;

  constructor(private R: Rapier, container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.cam = new FollowCamera(this.camera);
    this.input = new Input(this.renderer.domElement);
    this.input.onKey = (c) => {
      if (c === 'KeyR') this.restart();
      if (c === 'Escape') this.paused = !this.paused;
    };
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.buildScene();
    this.restart();
    requestAnimationFrame(() => this.frame());
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private buildScene(): void {
    this.scene.background = new THREE.Color(0x1a1620);
    this.scene.add(new THREE.HemisphereLight(0xbbbbff, 0x332211, 0.9));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.6);
    sun.position.set(6, 12, 4);
    sun.castShadow = true;
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x6b6560 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(100, 100, 0x443f3a, 0x544e48);
    grid.position.y = 0.002;
    this.scene.add(grid);
  }

  restart(): void {
    if (!this.pw) {
      this.pw = new PhysicsWorld(this.R, this.tun);
      this.pw.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(50, 0.5, 50));
      this.player = new Player(this.pw, this.tun, { position: new THREE.Vector3(0, 0, 0) });
      this.pw.hooks.push({ pre: (dt) => this.player.preStep(dt, this.cmd), post: (dt) => this.player.postStep(dt) });
    } else {
      this.player.respawn({ position: new THREE.Vector3(0, 0, 0) });
    }
    for (const m of this.meshes) this.scene.remove(m.mesh);
    this.meshes = [];
    const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.24), mat(0x3355aa));
    pelvis.position.y = 0.15;
    const torso = new THREE.Group();
    const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.3), mat(0xaa3333));
    tm.position.y = 0.04;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16), mat(0xf0c8a0));
    head.position.y = 0.55;
    torso.add(tm, head);
    const sword = new THREE.Group();
    const L = this.tun.swordLength;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, L - 0.55, 0.05), mat(0xc8ccd4));
    blade.position.y = 0.3 + (L - 0.55) / 2;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55), mat(0x442211));
    hilt.position.y = 0.025;
    sword.add(blade, hilt);
    const pg = new THREE.Group(); pg.add(pelvis);
    for (const [o, b] of [[pg, () => this.player.pelvis], [torso, () => this.player.torso], [sword, () => this.player.sword]] as const) {
      o.traverse((c) => { c.castShadow = true; });
      this.scene.add(o);
      this.meshes.push({ body: b, mesh: o });
    }
    this.cam.snap();
  }

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const orbit = this.input.takeOrbit();
    this.cam.orbit(orbit.x, orbit.y);
    if (!this.paused) {
      this.input.command(dt, this.cam.lookYaw, this.tun.reachSpeed, this.cmd);
      this.pw.advance(dt);
    }
    for (const m of this.meshes) {
      const b = m.body();
      m.mesh.position.copy(v3(b.translation()));
      m.mesh.quaternion.copy(q4(b.rotation()));
    }
    this.cam.update(dt, v3(this.player.pelvis.translation()));
    this.renderer.render(this.scene, this.camera);
  }
}
