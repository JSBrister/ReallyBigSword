import * as THREE from 'three';
import GUI from 'lil-gui';
import type { Tunables } from '../physics/tunables';
import { defaultTunables } from '../physics/tunables';
import type { Player } from '../physics/player/player';

const STATE_COLOR: Record<string, number> = { stick: 0x30e060, slip: 0xff8a20, air: 0x666666 };

/** F1 overlay: COM, support polygon, contact states, momentum, actuator load; plus tunables. */
export class DebugOverlay {
  readonly group = new THREE.Group();
  visible = false;
  private com: THREE.Mesh;
  private comShadow: THREE.Mesh;
  private comLine: THREE.Line;
  private capture: THREE.Mesh;
  private poly: THREE.LineLoop;
  private contacts: THREE.Mesh[] = [];
  private swordTorque: THREE.ArrowHelper;
  private panel: HTMLDivElement;
  private gui: GUI;

  constructor(scene: THREE.Scene, private tun: Tunables, onRebuild: () => void,
    controls?: { stickMode: 'sword' | 'camera'; dragFullSpeed: number }) {
    const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9 });
    this.com = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat(0xff3050));
    this.comShadow = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.09, 20).rotateX(-Math.PI / 2), mat(0xff3050));
    this.capture = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.05, 4).rotateX(-Math.PI / 2), mat(0x40c0ff));
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.comLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff3050, depthTest: false }));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.poly = new THREE.LineLoop(pg, new THREE.LineBasicMaterial({ color: 0xffff40, depthTest: false }));
    this.poly.frustumCulled = false;
    this.swordTorque = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xff40ff);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0xffffff));
      this.contacts.push(m);
      this.group.add(m);
    }
    for (const o of [this.com, this.comShadow, this.capture, this.comLine, this.poly, this.swordTorque]) {
      o.renderOrder = 999;
      this.group.add(o);
    }
    this.group.visible = false;
    scene.add(this.group);

    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed', left: '10px', bottom: '10px', padding: '8px 10px', background: 'rgba(0,0,0,0.6)',
      color: '#cfe', font: '12px/1.35 ui-monospace, monospace', whiteSpace: 'pre', display: 'none', pointerEvents: 'none',
    });
    document.body.appendChild(this.panel);

    this.gui = new GUI({ title: 'Tunables (F1)' });
    this.gui.hide();
    const g = this.gui;
    const mass = g.addFolder('Masses & size (applied on R)');
    mass.add(tun, 'warriorMass', 40, 200, 1).name('warrior kg');
    mass.add(tun, 'swordMass', 41, 600, 1).name('sword kg').onChange(() => {
      if (tun.swordMass <= tun.warriorMass) { tun.swordMass = tun.warriorMass + 1; g.controllersRecursive().forEach((c) => c.updateDisplay()); }
    });
    mass.add(tun, 'swordLength', 1.2, 4.5, 0.05).name('sword length m');
    mass.add(tun, 'legLength', 0.7, 1.2, 0.01).name('leg length m');
    mass.add({ rebuild: onRebuild }, 'rebuild').name('Apply & restart room (R)');
    const feet = g.addFolder('Feet & friction');
    feet.add(tun, 'muStatic', 0.05, 2, 0.01).name('μ static (stone)');
    feet.add(tun, 'muKinetic', 0.02, 2, 0.01).name('μ kinetic (stone)');
    feet.add(tun, 'footNormalStiffness', 1000, 200000, 500).name('leg stiffness N/m (per contact)');
    feet.add(tun, 'legTravel', 0, 0.3, 0.01).name('leg travel m');
    feet.add(tun, 'footNormalDamping', 50, 10000, 50).name('leg damping');
    feet.add(tun, 'restickSpeed', 0.01, 0.5, 0.01).name('re-stick speed');
    feet.add(tun, 'restickTime', 0, 0.3, 0.01).name('re-stick time');
    feet.close();
    const ctl = g.addFolder('Controls & assists');
    ctl.add(tun, 'swordEffort', 200, 20000, 100).name('full swing effort N·m');
    ctl.add(tun, 'swordFreeDamping', 0, 3000, 10).name('follow-through damping');
    ctl.add(tun, 'braceAmount', 0, 1, 0.05).name('bracing amount');
    ctl.add(tun, 'braceCrouch', 0, 0.3, 0.01).name('brace: crouch m');
    ctl.add(tun, 'braceWiden', 0, 0.3, 0.01).name('brace: widen stance m');
    ctl.add(tun, 'braceStagger', 0, 0.4, 0.01).name('brace: split stance m');
    ctl.add(tun, 'balanceReflex').name('balance reflex (ease off when tipping)');
    ctl.add(tun, 'governor').name('balance governor (assist)');
    if (controls) {
      ctl.add(controls, 'stickMode', ['sword', 'camera']).name('gamepad right stick');
      ctl.add(controls, 'dragFullSpeed', 100, 3000, 10).name('mouse: px/s for full swing');
    }
    const act = g.addFolder('Actuators');
    act.add(tun, 'swordMaxTorque', 1000, 60000, 100).name('sword max torque N·m');
    act.add(tun, 'swordMaxRate', 1, 30, 0.5).name('swing rate cap rad/s');
    act.add(tun, 'swordHoldGain', 1, 80, 1).name('hold stiffness 1/s');
    act.add(tun, 'reachSpeed', 0.2, 5, 0.1).name('reach speed m/s');
    act.add(tun, 'hipMaxTorque', 0, 15000, 100).name('hip max torque N·m');
    act.add(tun, 'hipStiffness', 0, 30000, 100).name('hip stiffness');
    act.add(tun, 'hipDamping', 0, 5000, 50).name('hip damping');
    act.close();
    const loco = g.addFolder('Locomotion');
    loco.add(tun, 'walkSpeed', 0.2, 4, 0.1);
    loco.add(tun, 'walkAccel', 0.5, 15, 0.5);
    loco.add(tun, 'stepDuration', 0.15, 0.6, 0.01);
    loco.add(tun, 'maxStepLength', 0.3, 1.2, 0.01);
    loco.add(tun, 'jumpForce', 0, 40000, 500).name('jump thrust N');
    loco.close();
    const combat = g.addFolder('Combat');
    combat.add(tun, 'damageThreshold', 0, 30, 0.5).name('damage threshold m/s');
    combat.add(tun, 'damagePerMps', 0, 30, 0.5).name('damage per m/s');
    combat.close();
    const sim = g.addFolder('Simulation');
    sim.add(tun, 'timeScale', 0.05, 2, 0.05).name('time scale');
    sim.add(tun, 'substeps', 2, 16, 1).name('substeps / frame');
    const cheats = g.addFolder('Physics cheats (the joke, off by default)');
    cheats.add(tun, 'cheatStickyFeet').name('Sticky Feet');
    cheats.add(tun, 'cheatInfiniteFriction').name('Infinite Friction');
    cheats.add(tun, 'cheatWeightlessSword').name('Weightless Sword');
    cheats.add(tun, 'cheatAirControl').name('Air Control');
    g.add({ reset: () => { Object.assign(tun, defaultTunables); g.controllersRecursive().forEach((c) => c.updateDisplay()); } }, 'reset').name('Reset all to defaults');
  }

  toggle(): void {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.gui.show(); else this.gui.hide();
  }

  /** Show the text readout even without F1 (the training ground does this). */
  forcePanel = false;

  update(player: Player, groundY = 0): void {
    if (!this.visible) {
      this.panel.style.display = this.forcePanel ? 'block' : 'none';
      if (this.forcePanel) this.updatePanel(player);
      return;
    }
    this.panel.style.display = 'block';
    const s = player.state;
    this.com.position.copy(s.com);
    this.comShadow.position.set(s.com.x, groundY + 0.01, s.com.z);
    const lp = this.comLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    lp.setXYZ(0, s.com.x, s.com.y, s.com.z); lp.setXYZ(1, s.com.x, groundY, s.com.z); lp.needsUpdate = true;
    this.capture.position.set(player.gait.capture.x, groundY + 0.012, player.gait.capture.z);
    const poly = player.gait.support;
    const pa = this.poly.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(16, poly.length);
    for (let i = 0; i < n; i++) pa.setXYZ(i, poly[i].x, groundY + 0.015, poly[i].z);
    pa.needsUpdate = true;
    this.poly.geometry.setDrawRange(0, n);
    const pts = player.feet.feet.flatMap((f) => f.points);
    pts.forEach((cp, i) => {
      const m = this.contacts[i];
      m.position.set(cp.anchor.x, (cp.state === 'air' ? cp.world.y : cp.groundY) + 0.02, cp.anchor.z);
      if (cp.state === 'air') m.position.copy(cp.world);
      (m.material as THREE.MeshBasicMaterial).color.setHex(STATE_COLOR[cp.state]);
      m.scale.setScalar(0.6 + Math.min(2, cp.usage) * 0.8);
    });
    const tq = player.swordAct.torque;
    if (tq.lengthSq() > 1) {
      this.swordTorque.position.copy(player.gripWorld);
      this.swordTorque.setDirection(tq.clone().normalize());
      this.swordTorque.setLength(0.3 + 1.2 * Math.min(1, player.swordAct.usage), 0.12, 0.08);
      this.swordTorque.visible = true;
    } else this.swordTorque.visible = false;

    this.updatePanel(player);
  }

  private updatePanel(player: Player): void {
    const s = player.state;
    const feetLines = player.feet.feet.map((f) => {
      const side = f.side < 0 ? 'L' : 'R';
      const N = f.points.reduce((a, p) => a + p.N, 0);
      const F = f.points.reduce((a, p) => a + p.force.length(), 0);
      const pts = f.points.map((p) => `${p.state === 'stick' ? 'stick' : p.state === 'slip' ? 'SLIP ' : ' air '} ${p.usage.toFixed(2)}`).join('  ');
      return `${side} foot ${f.phase.padEnd(6)} N=${N.toFixed(0).padStart(5)}N F=${F.toFixed(0).padStart(5)}N  [${pts}]`;
    });
    const mat = player.feet.feet.flatMap((f) => f.points).find((p) => p.state !== 'air');
    this.panel.textContent = [
      `system mass ${s.mass.toFixed(0)} kg   COM (${s.com.x.toFixed(2)}, ${s.com.y.toFixed(2)}, ${s.com.z.toFixed(2)})`,
      `|v_com| ${s.vcom.length().toFixed(2)} m/s   L about COM (${s.L.x.toFixed(0)}, ${s.L.y.toFixed(0)}, ${s.L.z.toFixed(0)}) |L| ${s.L.length().toFixed(1)} kg·m²/s`,
      `sword actuator ${(player.swordAct.usage * 100).toFixed(0).padStart(3)}% of ${this.tun.swordMaxTorque} N·m   reach ${player.reach.toFixed(2)} m`,
      `ground ${mat ? `${mat.material} μs=${mat.muS.toFixed(2)} μk=${mat.muK.toFixed(2)}` : 'none (airborne)'}   ${player.fallen ? 'TOPPLED' : ''}`,
      'friction use F/μN per contact (heel, toe-in, toe-out):',
      ...feetLines,
    ].join('\n');
  }
}
