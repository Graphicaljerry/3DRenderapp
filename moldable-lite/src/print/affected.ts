import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

/** Triangles of `base` whose surface is NOT present in `probe` — i.e. the faces that
 *  actually move when one parameter changes.
 *
 *  Why not a boolean diff: the added/removed VOLUMES a boolean produces are two solid
 *  slabs floating in and around the part. They tell you a change happened but not which
 *  feature owns it, and on a tall growth they drape most of the model. What a person
 *  wants to see is "these faces, the ones you are about to move", drawn on the object
 *  itself.
 *
 *  Method: build a BVH over the probe surface, then for every triangle of the base mesh
 *  measure the distance from its centroid to the nearest point on that surface. A face
 *  that stayed put lies ON the probe surface; a face that moved does not. This is
 *  topology-independent, so it survives a rebuild that re-tessellates — which it always
 *  does, since OCCT re-meshes from scratch.
 */
export function affectedFaces(
  base: THREE.BufferGeometry,
  probe: THREE.BufferGeometry,
  opts: { tolMM?: number; maxTris?: number; probeOffset?: [number, number, number] } = {},
): Float32Array | null {
  const maxTris = opts.maxTris ?? 120_000;

  const b = base.index ? base.toNonIndexed() : base;
  const pos = b.getAttribute("position")?.array as Float32Array | undefined;
  if (!pos) { if (b !== base) b.dispose(); return null; }
  const triCount = Math.floor(pos.length / 9);
  if (!triCount || triCount > maxTris) { if (b !== base) b.dispose(); return null; }

  // MeshBVH takes ownership of the geometry it indexes, so give it a copy the caller
  // can't dispose out from under us.
  const pg = probe.index ? probe.toNonIndexed() : probe.clone();
  const ppos = pg.getAttribute("position")?.array as Float32Array | undefined;
  if (!ppos || ppos.length < 9) { pg.dispose(); if (b !== base) b.dispose(); return null; }
  // Each engine build is recentred on ITS OWN bounding box, so base and probe live in
  // different display frames: grow plateHeight and the probe's recentre shifts, which
  // made every face read as "moved" (or the wrong region light up). The caller passes
  // the recenter delta; applying it here puts both surfaces in the base's frame.
  const off = opts.probeOffset;
  if (off && (off[0] || off[1] || off[2])) {
    for (let i = 0; i < ppos.length; i += 3) { ppos[i] += off[0]; ppos[i + 1] += off[1]; ppos[i + 2] += off[2]; }
  }
  const bvh = new MeshBVH(pg);

  // Tolerance scales with the part: the two meshes are INDEPENDENT triangulations of
  // curved surfaces, so a face that did not move still lands a fraction of a millimetre
  // off the other tessellation. Measured on the wall-hook template, unmoved faces sat at
  // 0.002-0.09 mm while a nudged parameter moves faces by millimetres — so anything in
  // that noise band must not light up.
  const bb = new THREE.Box3().setFromBufferAttribute(b.getAttribute("position") as THREE.BufferAttribute);
  const diag = bb.getSize(new THREE.Vector3()).length() || 1;
  const tol = opts.tolMM ?? Math.max(0.25, diag * 0.004);

  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const c = new THREE.Vector3();
  const keep: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    c.set(
      (pos[o] + pos[o + 3] + pos[o + 6]) / 3,
      (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3,
      (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3,
    );
    // maxThreshold prunes BOUNDING BOXES, not results: a triangle whose box is inside
    // the radius but whose surface is outside it still comes back as a hit. Passing tol
    // there and trusting a null return reported every face as unmoved and lit nothing.
    // The distance has to be compared here.
    const hit = bvh.closestPointToPoint(c, target, 0, diag);
    if (!hit || target.distance > tol) keep.push(t);
  }

  pg.dispose();
  // Everything moved (or nothing did) — neither is a useful highlight, so draw none.
  if (!keep.length || keep.length > triCount * 0.9) { if (b !== base) b.dispose(); return null; }

  const out = new Float32Array(keep.length * 9);
  for (let i = 0; i < keep.length; i++) out.set(pos.subarray(keep[i] * 9, keep[i] * 9 + 9), i * 9);
  if (b !== base) b.dispose();
  return out;
}
