import * as THREE from "three";

// Mesh-model resize/transform baking. CAD models get parametric transform ops in
// the worker; mesh (generative/imported) models get their transform baked into the
// geometry here. The ORIGINAL glb blob stays untouched — the exact cumulative
// matrix is stored alongside it (`meshXform` on results/versions) and replayed
// after loading, so baked textures survive and reopening reproduces the transform.

export interface BakedMesh {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  /** The EXACT matrix applied (input transform + the settle-to-bed translate). */
  applied: THREE.Matrix4;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function measure(g: THREE.BufferGeometry): { x: number; y: number; z: number } {
  g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  return { x: r1(size.x), y: r1(size.y), z: r1(size.z) };
}

/** Bake `m` into a COPY of a mesh geometry, settle it back onto the bed (z=0),
 *  and report the exact total matrix applied so it can be replayed on reopen.
 *  UVs are untouched, so a baked color texture keeps fitting. */
export function bakeMeshTransform(geometry: THREE.BufferGeometry, m: THREE.Matrix4): BakedMesh {
  const g = geometry.clone();
  g.applyMatrix4(m);
  g.computeBoundingBox();
  const settleZ = -g.boundingBox!.min.z;
  g.translate(0, 0, settleZ);
  g.computeVertexNormals();
  const applied = new THREE.Matrix4().makeTranslation(0, 0, settleZ).multiply(m);
  return { geometry: g, dims: measure(g), applied };
}

/** Fold a newly-baked step into the stored cumulative transform (column-major, 16 numbers). */
export function composeXform(prev: number[] | undefined, applied: THREE.Matrix4): number[] {
  const total = prev && prev.length === 16 ? new THREE.Matrix4().fromArray(prev).premultiply(applied) : applied.clone();
  return total.toArray();
}

/** Replay a stored cumulative transform on a freshly-loaded mesh (reopen path).
 *  Mutates in place; returns the new dims, or null when there is nothing to apply. */
export function applyStoredMeshXform(geometry: THREE.BufferGeometry, xform: number[] | undefined): { x: number; y: number; z: number } | null {
  if (!xform || xform.length !== 16) return null;
  geometry.applyMatrix4(new THREE.Matrix4().fromArray(xform));
  geometry.computeVertexNormals();
  return measure(geometry);
}

/** Uniform SHRINK factor that fits `dims` inside the bed (as placed, small margin);
 *  1 when it already fits. Never scales up — that's a deliberate user action. */
export function fitToBedFactor(dims: { x: number; y: number; z: number }, bed: { x: number; y: number; z: number }, margin = 0.95): number {
  const f = Math.min(1, (bed.x * margin) / Math.max(1e-6, dims.x), (bed.y * margin) / Math.max(1e-6, dims.y), (bed.z * margin) / Math.max(1e-6, dims.z));
  return f >= 1 ? 1 : Math.max(0.001, Math.floor(f * 1000) / 1000);
}

/** Scale matrix about the model's bbox centre (XY) and bed plane (Z) — resizing in
 *  place, without drifting off-centre or into/off the bed. */
export function scaleAboutBase(geometry: THREE.BufferGeometry, s: [number, number, number]): THREE.Matrix4 {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  return new THREE.Matrix4()
    .makeTranslation(cx, cy, bb.min.z)
    .multiply(new THREE.Matrix4().makeScale(s[0], s[1], s[2]))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -bb.min.z));
}
