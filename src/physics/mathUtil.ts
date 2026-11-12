import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export type Vec = { x: number; y: number; z: number };
export const UP = new THREE.Vector3(0, 1, 0);

export const v3 = (v: Vec, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const q4 = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) =>
  out.set(q.x, q.y, q.z, q.w);

/** World-frame inertia tensor about the body's centre of mass. */
export function worldInertia(body: RAPIER.RigidBody, out = new THREE.Matrix3()): THREE.Matrix3 {
  const I = body.effectiveAngularInertia();
  return out.set(I.m11, I.m12, I.m13, I.m12, I.m22, I.m23, I.m13, I.m23, I.m33);
}

/** Rotation vector (axis * angle, |angle| <= PI) of a quaternion. */
export function quatToRotVec(q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return out.set(2 * x, 2 * y, 2 * z);
  const angle = 2 * Math.atan2(s, w);
  return out.set(x, y, z).multiplyScalar(angle / s);
}

/** Quaternion from rotation vector. */
export function rotVecToQuat(v: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const a = v.length();
  if (a < 1e-12) return out.set(0.5 * v.x, 0.5 * v.y, 0.5 * v.z, 1).normalize();
  const s = Math.sin(a / 2) / a;
  return out.set(v.x * s, v.y * s, v.z * s, Math.cos(a / 2));
}

/** Heading (yaw about +Y) of a rotation, 0 = facing +Z. */
export function yawOf(q: THREE.Quaternion): number {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function clampLen(v: THREE.Vector3, max: number): THREE.Vector3 {
  const l = v.length();
  if (l > max && l > 0) v.multiplyScalar(max / l);
  return v;
}

/** 2D convex hull (monotone chain) on xz. Returns points in CCW order. */
export function convexHullXZ(pts: { x: number; z: number }[]): { x: number; z: number }[] {
  const p = pts.map((q) => ({ x: q.x, z: q.z })).sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length <= 2) return p;
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: typeof p = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: typeof p = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/**
 * Signed distance from point to convex polygon (CCW) on xz: negative inside.
 * Degenerate polygons (point / segment) are treated as having zero area (always >= 0).
 */
export function signedDistToPolygon(pt: { x: number; z: number }, poly: { x: number; z: number }[]): number {
  if (poly.length === 0) return Infinity;
  if (poly.length === 1) return Math.hypot(pt.x - poly[0].x, pt.z - poly[0].z);
  let inside = poly.length >= 3;
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len2 = ex * ex + ez * ez || 1e-12;
    const t = clamp(((pt.x - a.x) * ex + (pt.z - a.z) * ez) / len2, 0, 1);
    const d = Math.hypot(pt.x - (a.x + t * ex), pt.z - (a.z + t * ez));
    minD = Math.min(minD, d);
    if (poly.length >= 3 && ex * (pt.z - a.z) - ez * (pt.x - a.x) < 0) inside = false;
  }
  return inside ? -minD : minD;
}
