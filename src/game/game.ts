import * as THREE from 'three';
import type { Rapier } from '../physics/rapier';
import { PhysicsWorld, GROUP, groups } from '../physics/world';
import { defaultTunables, type Tunables } from '../physics/tunables';
import { Player, emptyCommand, type PlayerCommand } from '../physics/player/player';
import { ImpactDetector } from '../physics/impacts';
import { GoblinManager, type Goblin } from '../physics/goblin';
import { v3 } from '../physics/mathUtil';
import { Input } from './input';
import { FollowCamera } from './camera';
import { Effects } from './particles';
import { WarriorView } from './warriorView';
import { GoblinView } from './goblinView';
import { DebugOverlay } from './debug';
import { Hud } from './hud';
import { Sfx } from './audio';
import { Level, ROOMS } from './level';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  readonly cam: FollowCamera;
  readonly tun: Tunables = { ...defaultTunables };
  readonly pw: PhysicsWorld;
  readonly level: Level;
  player!: Player;
  readonly goblins: GoblinManager;
  readonly input: Input;
  readonly effects: Effects;
  readonly hud: Hud;
  readonly sfx = new Sfx();
  readonly debug: DebugOverlay;
  private impacts!: ImpactDetector;
  private warrior!: WarriorView;
  private goblinViews = new Map<Goblin, GoblinView>();
  private goblinRoom = new Map<Goblin, number>();
  private cmd: PlayerCommand = emptyCommand();
  private last = performance.now();
  private sun: THREE.DirectionalLight;
  paused = true;
  /** Highest room reached: where you respawn. */
  checkpoint = 0;
  currentRoom = 0;
  private cleared = new Set<number>();
  private deadTimer = 0;
  private hurtCooldown = 0;
  private won = false;

  constructor(R: Rapier, container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.cam = new FollowCamera(this.camera);
    this.cam.collide = (from, dir, max) => {
      const hit = this.pw.world.castRay(new this.pw.R.Ray(from, dir), max, true, undefined, groups(0xffff, GROUP.GROUND));
      return hit ? hit.timeOfImpact : max;
    };
    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(container);
    this.hud.onResume = () => this.setPaused(false);
    this.hud.showPause(true);

    this.scene.background = new THREE.Color(0x0d0b10);
    this.scene.fog = new THREE.Fog(0x0d0b10, 18, 45);
    this.scene.add(new THREE.HemisphereLight(0xb0bad8, 0x3a2c20, 1.6));
    this.sun = new THREE.DirectionalLight(0xffe6c8, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
    this.scene.add(this.sun, this.sun.target);

    this.pw = new PhysicsWorld(R, this.tun);
    this.level = new Level(this.pw, this.scene);
    this.goblins = new GoblinManager(this.pw, this.tun);
    this.goblins.onPlayerHit = (_g, dmg) => this.hurtPlayer(dmg);
    this.effects = new Effects(this.scene);
    this.debug = new DebugOverlay(this.scene, this.tun, () => this.restartRoom());

    this.spawnPlayer(0);
    ROOMS.forEach((r, i) => r.goblins.forEach((gd) => this.addGoblin(gd.pos, gd.shield, i)));
    this.pw.hooks.push({
      pre: (dt) => {
        this.player.preStep(dt, this.cmd);
        const pp = v3(this.player.body.translation());
        this.goblins.pre(dt, pp, (g) => this.goblinRoom.get(g) === this.currentRoom && this.player.health > 0);
        this.impacts.pre();
      },
      post: (dt) => this.postStep(dt),
    });

    this.input.onKey = (c) => {
      this.sfx.unlock();
      if (c === 'Escape') this.setPaused(!this.paused);
      else if (this.paused) return;
      if (c === 'KeyR') this.restartRoom();
      if (c === 'F1') this.debug.toggle();
      if (c === 'KeyM') this.sfx.muted = !this.sfx.muted;
    };
    this.renderer.domElement.addEventListener('pointerdown', () => this.sfx.unlock());
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.updateHud();
    requestAnimationFrame(() => this.frame());
  }

  private setPaused(v: boolean): void {
    this.paused = v;
    this.hud.showPause(v);
    this.sfx.unlock();
    this.last = performance.now();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private spawnPlayer(room: number): void {
    const r = ROOMS[room];
    const spawn = { position: r.spawn.clone(), heading: r.spawnHeading };
    if (!this.player) this.player = new Player(this.pw, this.tun, spawn);
    else this.player.respawn(spawn);
    if (this.warrior) { this.scene.remove(this.warrior.root); this.warrior.dispose(); }
    this.warrior = new WarriorView(this.tun.swordLength);
    this.scene.add(this.warrior.root);
    this.impacts = new ImpactDetector(this.pw, () => this.player.sword, () => [this.player.swordBlade]);
    for (const g of this.goblins.goblins) this.impacts.track(g.body);
    this.cam.snap();
    this.cam.yaw = r.spawnHeading + Math.PI;
  }

  private addGoblin(pos: THREE.Vector3, shield: Goblin['shield'], room: number): void {
    const g = this.goblins.spawn(pos, shield, Math.PI);
    this.goblinRoom.set(g, room);
    const view = new GoblinView(g);
    view.attach(this.scene);
    this.goblinViews.set(g, view);
    this.impacts?.track(g.body);
  }

  private removeGoblin(g: Goblin): void {
    this.goblinViews.get(g)?.detach(this.scene);
    this.goblinViews.delete(g);
    this.goblinRoom.delete(g);
    this.impacts.untrack(g.body);
  }

  /** R: back to the start of the current checkpoint room, its goblins reset, tunables re-applied. */
  restartRoom(): void {
    const room = this.checkpoint;
    for (const g of [...this.goblins.goblins]) {
      if (this.goblinRoom.get(g) === room) { this.removeGoblin(g); this.goblins.remove(g); }
    }
    if (!this.cleared.has(room)) ROOMS[room].goblins.forEach((gd) => this.addGoblin(gd.pos, gd.shield, room));
    this.spawnPlayer(room);
    this.deadTimer = 0;
    this.updateHud();
  }

  private hurtPlayer(dmg: number): void {
    if (this.player.health <= 0 || this.hurtCooldown > 0) return;
    this.hurtCooldown = 0.3;
    this.player.health -= dmg;
    this.warrior.hurt();
    this.sfx.thud(6);
    if (this.player.health <= 0) { this.hud.message('Clubbed by a goblin', 2.5); this.deadTimer = 2.5; }
  }

  private postStep(dt: number): void {
    const p = this.player;
    p.postStep(dt);
    this.impacts.post();
    const hits = this.goblins.applyImpacts(this.impacts.impacts);
    for (const h of hits) {
      const sp = h.impact.normalSpeed;
      if (h.blocked) {
        this.effects.spark(h.impact.point, h.impact.normal.clone().negate(), sp, 0xbfe8ff);
        this.sfx.clang(sp, 'shield');
      } else if (h.damage > 0) {
        this.effects.spark(h.impact.point, h.impact.normal.clone().negate(), sp * 0.6, 0x7cff5a);
        this.sfx.clang(sp, 'flesh');
        if (h.goblin.state === 'dead') this.hud.message(['Bonk.', 'Splat.', 'Yeet.', 'Goodnight.'][h.goblin.id % 4], 1.2);
      } else if (sp > 2) this.sfx.thud(sp);
    }
    // sword on stone
    for (const imp of this.impacts.impacts) {
      if (this.goblins.owner(imp.other)) continue;
      if (imp.normalSpeed > 2.5) {
        this.effects.spark(imp.point, imp.normal.clone().negate(), imp.normalSpeed);
        this.sfx.clang(imp.normalSpeed, 'stone');
      }
    }
    for (const e of p.feet.slipEvents) {
      this.effects.footSlip(e.pos, e.speed, e.N, dt, e.material === 'slick');
      this.sfx.scrape(e.speed * e.N);
    }
  }

  private updateHud(): void {
    const r = ROOMS[this.currentRoom];
    const left = this.goblins.goblins.filter((g) => this.goblinRoom.get(g) === this.currentRoom && g.alive).length;
    this.hud.setRoom(r.name, r.hint, left);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
  }

  private lastStoodUp = 0;
  private gameLogic(dt: number): void {
    if (this.player.stoodUp !== this.lastStoodUp) {
      this.lastStoodUp = this.player.stoodUp;
      this.hud.message(['Heave!', 'Hup!', 'Nnngh... up.', 'Dignity restored (mostly)'][this.lastStoodUp % 4], 1.2);
      this.warrior.resetCape();
    }
    const pp = v3(this.player.body.translation());
    const room = this.level.roomAt(pp);
    if (room >= 0 && room !== this.currentRoom) {
      this.currentRoom = room;
      if (room > this.checkpoint) { this.checkpoint = room; this.hud.message(ROOMS[room].name, 2); }
    }
    // clear rooms -> open doors
    ROOMS.forEach((_, i) => {
      if (this.cleared.has(i)) return;
      const alive = this.goblins.goblins.some((g) => this.goblinRoom.get(g) === i && g.alive);
      if (!alive) {
        this.cleared.add(i);
        if (ROOMS[i].exit) { this.level.openDoor(i); this.hud.message('Room cleared — the door grinds open', 2.5); }
        else if (!this.won) { this.won = true; this.hud.message('Dungeon cleared! The sword is still too big.', 6); }
      }
    });
    for (const g of this.goblins.cleanup(8)) this.removeGoblin(g);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) { this.spawnPlayer(this.checkpoint); this.hud.message('Try again', 1.5); }
    }
    if (pp.y < -5) this.spawnPlayer(this.checkpoint);
    this.updateHud();
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
      if (this.player.health <= 0) { this.cmd.move.set(0, 0, 0); this.cmd.swingYaw = this.cmd.swingPitch = 0; }
      this.pw.advance(dt);
      this.gameLogic(dt);
      this.level.update(dt);
    }
    const sdt = this.paused ? 0 : dt * this.tun.timeScale;
    this.warrior.update(this.player, sdt);
    for (const v of this.goblinViews.values()) v.update(sdt, this.camera);
    this.effects.update(sdt);
    this.hud.update(dt);
    const pp = v3(this.player.body.translation());
    const ceiling = ROOMS[Math.max(0, this.currentRoom)].ceiling;
    this.cam.update(dt, pp, ceiling);
    this.sun.position.copy(pp).add(new THREE.Vector3(5, 12, 3));
    this.sun.target.position.copy(pp);
    this.debug.update(this.player);
    this.renderer.render(this.scene, this.camera);
  }
}
