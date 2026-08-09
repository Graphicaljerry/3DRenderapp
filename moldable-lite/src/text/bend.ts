// Wrapping flat text onto a curved wall.
//
// A word built by buildTextGeometry is flat: it lies in XY and extrudes toward +Z. Laid
// on the side of a vase or a mug that is a chord across the curve — the middle of the
// word sinks into the wall while its ends lift off it, and on a print the ends come away
// as loose tabs. Bending the solid around the same cylinder the wall follows is what
// makes it a decal instead of a plank.
import * as THREE from "three";
import { smoothTextNormals } from "./geometry";

/** Bend a flat, +Z-extruded solid around a cylinder whose axis runs along local Y.
 *
 *  `radius` is signed and measured at the surface: positive wraps the OUTSIDE of a body
 *  (a vase, a bottle), negative wraps the inside of a bowl, and anything non-finite
 *  leaves the geometry exactly as it was — which is what a flat face reports, so a plate
 *  costs nothing but the check. Local +Z stays "away from the wall" all the way along, so
 *  the extrusion follows the curve instead of shearing across it. */
export function bendAroundY(geom: THREE.BufferGeometry, radius: number): THREE.BufferGeometry {
  if (!Number.isFinite(radius) || Math.abs(radius) < 1e-3) return geom;
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i < a.length; i += 3) {
    // The vertex's x becomes an arc at its own distance from the axis, so a letter's
    // face and its back travel through the same angle and the wall stays that thick.
    const t = a[i] / radius;
    const r = radius + a[i + 2];
    a[i] = r * Math.sin(t);
    a[i + 2] = r * Math.cos(t) - radius;
  }
  pos.needsUpdate = true;
  smoothTextNormals(geom); // computeVertexNormals would re-flatten the walls into bands
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** How tightly the wall under a decal curves, about the decal's up-axis.
 *
 *  Three samples along the baseline: the middle one is the point already under the
 *  cursor, and the outer two say how far the surface has dropped away by the ends of the
 *  word. A circle through them gives the radius to bend by. Reads Infinity — meaning
 *  "don't bend" — for a flat face, and for a word wider than the body it sits on, where
 *  the outer rays fly past and there is nothing honest to fit. */
export function wallRadius(
  mesh: THREE.Object3D,
  origin: THREE.Vector3,
  right: THREE.Vector3,
  normal: THREE.Vector3,
  halfWidth: number,
): number {
  if (!(halfWidth > 0.5)) return Infinity;
  const back = halfWidth * 4 + 20; // start clear of the surface, even on a tight curve
  const rc = new THREE.Raycaster();
  rc.far = back * 2;
  const drop = (sx: number): number | null => {
    rc.set(origin.clone().addScaledVector(right, sx).addScaledVector(normal, back), normal.clone().negate());
    const h = rc.intersectObject(mesh, false)[0];
    return h ? h.point.clone().sub(origin).dot(normal) : null; // signed height off the tangent plane
  };
  const seen = [drop(-halfWidth), drop(halfWidth)].filter((v): v is number => v !== null);
  if (!seen.length) return Infinity;
  const w = seen.reduce((s, v) => s + v, 0) / seen.length;
  if (Math.abs(w) < 1e-3) return Infinity; // flat to within a micron
  const r = -(halfWidth * halfWidth + w * w) / (2 * w);
  return Math.abs(r) > 1e4 ? Infinity : r; // a 10 m radius is flat for anything printable
}

/** Lay a flat decal on the ACTUAL surface, vertex by vertex.
 *
 *  `wallRadius` + `bendAroundY` fit the whole word to one cylinder, which is right for a
 *  bottle and wrong for almost anything else. On a rounded box — a pen holder, a case —
 *  the wall is flat across the middle and curved only at the corners, so a single radius
 *  is over-bent on the flat part and under-bent on the corner, and the middle letters
 *  sink into the body. A word must never do that: every letter sits ON the outer wall or
 *  the part is wrong.
 *
 *  So each vertex is dropped onto whatever is underneath it and re-raised by its own
 *  height in the extrusion. That holds on any shape, curved in one direction or two,
 *  because it never assumes a shape at all. Vertices whose ray misses the body (a word
 *  overhanging an edge) keep the position they came in with, so an overhang degrades to
 *  the old cylindrical answer instead of collapsing.
 *
 *  Returns false when too little of the word found the surface to trust the result. */
export function conformToSurface(
  geom: THREE.BufferGeometry,
  flat: THREE.BufferGeometry,
  mesh: THREE.Object3D,
  origin: THREE.Vector3,
  quat: THREE.Quaternion,
): boolean {
  const src = flat.getAttribute("position") as THREE.BufferAttribute | undefined;
  const dst = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!src || !dst || src.count !== dst.count) return false;
  if (!flat.boundingBox) flat.computeBoundingBox();
  const reach = Math.max(20, (flat.boundingBox!.max.x - flat.boundingBox!.min.x) * 2);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  const out = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  const inv = quat.clone().invert();
  const rc = new THREE.Raycaster();
  rc.far = reach * 2.5;
  (rc as unknown as { firstHitOnly: boolean }).firstHitOnly = true; // three-mesh-bvh
  const a = src.array as Float32Array;
  const b = dst.array as Float32Array;
  const from = new THREE.Vector3();
  const dir = out.clone().negate();
  const p = new THREE.Vector3();
  let hits = 0;
  for (let i = 0; i < a.length; i += 3) {
    from.copy(origin).addScaledVector(right, a[i]).addScaledVector(up, a[i + 1]).addScaledVector(out, reach);
    rc.set(from, dir);
    const h = rc.intersectObject(mesh, false)[0];
    if (!h?.face) continue;
    hits++;
    // Raise by this vertex's own place in the extrusion, along the LOCAL normal — so the
    // face of a letter stays parallel to the wall under it rather than to the wall under
    // the middle of the word.
    const n = h.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
    p.copy(h.point).addScaledVector(n, a[i + 2]).sub(origin).applyQuaternion(inv);
    b[i] = p.x; b[i + 1] = p.y; b[i + 2] = p.z;
  }
  if (hits < src.count * 0.5) return false; // mostly off the part — not a decal, leave it
  dst.needsUpdate = true;
  smoothTextNormals(geom); // same reason as bendAroundY: keep the walls smooth
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return true;
}
