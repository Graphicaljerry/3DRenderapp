// Mesh simplification for slicer limits: Bambu Studio / Orca stutter or error
// on multi-million-triangle AI meshes. meshoptimizer's simplifier (the engine
// behind gltfpack) collapses edges while staying within an error budget, so
// the silhouette survives. Borders are locked so existing holes don't grow.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer";

export interface SimplifyOutcome {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  trianglesBefore: number;
  trianglesAfter: number;
}

/** Above this the big slicers get sluggish; preflight flags it and the
 *  Printability tab offers one-click simplification. */
export const HEAVY_TRIANGLES = 1_000_000;

/** Halve the triangle count (default) while keeping the shape within ~1% of
 *  its extents. Click-again-to-halve keeps the control predictable. */
export async function simplifyGeometry(input: THREE.BufferGeometry, ratio = 0.5): Promise<SimplifyOutcome> {
  await MeshoptSimplifier.ready;

  // Weld first so the simplifier sees one connected surface, not a soup.
  let g = input.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
  g = mergeVertices(g, 1e-5);

  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const positions = pos.array instanceof Float32Array ? pos.array : Float32Array.from(pos.array as ArrayLike<number>);
  const srcIndex = g.index
    ? Uint32Array.from(g.index.array as ArrayLike<number>)
    : Uint32Array.from({ length: pos.count }, (_, i) => i);

  const trianglesBefore = srcIndex.length / 3;
  const targetIndexCount = Math.max(3, Math.floor((srcIndex.length * ratio) / 3)) * 3;

  const [index] = MeshoptSimplifier.simplify(srcIndex, positions, 3, targetIndexCount, 0.01, ["LockBorder"]);

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeVertexNormals();
  out.computeBoundingBox();

  const size = new THREE.Vector3();
  out.boundingBox!.getSize(size);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    geometry: out,
    dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) },
    trianglesBefore,
    trianglesAfter: index.length / 3,
  };
}
