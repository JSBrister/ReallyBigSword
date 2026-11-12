import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initRapier } from '../src/physics/rapier';
import { PhysicsWorld, GROUP, groups, ALL_GROUPS } from '../src/physics/world';
import { makeTunables } from '../src/physics/tunables';
import { ImpactDetector } from '../src/physics/impacts';
import { GoblinManager, type ShieldSide, type HitResult } from '../src/physics/goblin';
import { makeSandbox } from './helpers';

/** A 150 kg sword-sized slab flown at a goblin at an exact speed. */
async function fling(opts: { speed: number; shield?: ShieldSide; from: THREE.Vector3; at?: THREE.Vector3 }) {
  const R = await initRapier();
  const tun = makeTunables();
  const pw = new PhysicsWorld(R, tun);
  pw.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(30, 0.5, 30));
  const gm = new GoblinManager(pw, tun);
  const g = gm.spawn(new THREE.Vector3(0, 0, 0), opts.shield ?? 'none', 0);
  const target = opts.at ?? new THREE.Vector3(0, 0.7, 0);
  const start = target.clone().add(opts.from.clone().normalize().multiplyScalar(1.4));
  const dir = target.clone().sub(start).normalize();
  const slab = pw.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(start.x, start.y, start.z)
    .setLinvel(dir.x * opts.speed, dir.y * opts.speed, dir.z * opts.speed).setGravityScale(0).setCcdEnabled(true));
  const col = pw.world.createCollider(R.ColliderDesc.cuboid(0.17, 0.17, 0.17).setMass(150)
    .setCollisionGroups(groups(GROUP.SWORD, ALL_GROUPS)), slab);
  const det = new ImpactDetector(pw, () => slab, () => [col]);
  det.track(g.body);
  const hits: HitResult[] = [];
  pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => { det.post(); hits.push(...gm.applyImpacts(det.impacts)); } });
  const p0 = g.position;
  const v0 = slab.linvel();
  for (let i = 0; i < 480 * 0.6; i++) pw.substep();
  const v1 = slab.linvel();
  return { g, hits, moved: g.position.distanceTo(p0), slabV0: new THREE.Vector3(v0.x, v0.y, v0.z), slabV1: new THREE.Vector3(v1.x, v1.y, v1.z), dir };
}

describe('sword damage', () => {
  it('a hit below the speed threshold does no damage but still shoves', async () => {
    const r = await fling({ speed: 4, from: new THREE.Vector3(0, 0, 1) });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.damage === 0)).toBe(true);
    expect(r.g.hp).toBe(r.g.maxHp);
    expect(r.moved).toBeGreaterThan(0.1);
  });

  it('a hit above the threshold damages and launches the goblin as a free body', async () => {
    const r = await fling({ speed: 16, from: new THREE.Vector3(0, 0, 1) });
    const dmg = r.hits.reduce((a, h) => a + h.damage, 0);
    console.log(`16 m/s hit: normal speed ${r.hits[0]?.impact.normalSpeed.toFixed(1)} m/s, damage ${dmg}`);
    expect(dmg).toBeGreaterThan(0);
    expect(['ragdoll', 'dead']).toContain(r.g.state);
    expect(r.moved).toBeGreaterThan(1);
  });

  it('damage scales with speed above the threshold', async () => {
    const a = await fling({ speed: 11, from: new THREE.Vector3(0, 0, 1) });
    const b = await fling({ speed: 20, from: new THREE.Vector3(0, 0, 1) });
    expect(b.hits[0].damage).toBeGreaterThan(a.hits[0].damage);
  });

  it('a fast hit on a shield face does no damage, and the sword bounces', async () => {
    const r = await fling({ speed: 16, shield: 'left', from: new THREE.Vector3(1, 0, 0), at: new THREE.Vector3(0.48, 0.7, 0.15) });
    expect(r.hits.some((h) => h.blocked && h.impact.normalSpeed > 8)).toBe(true);
    expect(r.hits.every((h) => h.damage === 0)).toBe(true);
    expect(r.g.hp).toBe(r.g.maxHp);
    expect(r.slabV1.dot(r.dir)).toBeLessThan(0); // bounced back
  });

  it('the same blow from the unshielded side does damage', async () => {
    const r = await fling({ speed: 16, shield: 'left', from: new THREE.Vector3(-1, 0, 0) });
    expect(r.hits.reduce((a, h) => a + h.damage, 0)).toBeGreaterThan(0);
  });

  it('a top shield stops an overhead slam', async () => {
    const r = await fling({ speed: 16, shield: 'top', from: new THREE.Vector3(0, 1, 0), at: new THREE.Vector3(0, 1.6, 0.05) });
    expect(r.hits.some((h) => h.blocked)).toBe(true);
    expect(r.g.hp).toBe(r.g.maxHp);
  });

  it('a real overhead slam from the warrior hurts a goblin (a flat spin mostly turns him instead)', async () => {
    const sb = await makeSandbox();
    const gm = new GoblinManager(sb.pw, sb.tun);
    const g = gm.spawn(new THREE.Vector3(0, 0, 1.6), 'none', Math.PI); // close: he rocks back as he swings
    const det = new ImpactDetector(sb.pw, () => sb.player.sword, () => [sb.player.swordBlade]);
    det.track(g.body);
    let dmg = 0, best = 0;
    sb.pw.hooks.push({ pre: (dt) => { gm.pre(dt, new THREE.Vector3(0, 0, -50), () => false); det.pre(); }, post: () => {
      det.post();
      for (const h of gm.applyImpacts(det.impacts)) { dmg += h.damage; best = Math.max(best, h.impact.normalSpeed); }
    } });
    sb.run(0.3);
    sb.cmd.swingPitch = -14; // bring the upright sword down hard onto the goblin in front
    sb.run(1.0);
    console.log(`overhead slam: impact ${best.toFixed(1)} m/s, goblin damage ${dmg}, state ${g.state}`);
    expect(dmg).toBeGreaterThan(0);
  });
});
