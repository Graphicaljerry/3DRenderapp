// Bounds-tree acceleration for picking.
//
// Every pointermove over the stage raycasts the model — hover highlight, edge/face
// adaptive picking, the push arrow, hole ghosts, measure snapping. three's stock
// Mesh.raycast walks EVERY triangle, so on a 200k-triangle generative mesh a single
// hover costs a full linear scan and the cursor visibly lags the pointer. three-mesh-bvh
// was already a dependency (the slicer, thin-wall check and cut planner all build their
// own MeshBVH) — it just was never wired into the picking path.
//
// Installing on the prototypes is the library's documented integration and it is opt-in
// per geometry: a mesh only takes the fast path once computeBoundsTree() has built its
// tree, and acceleratedRaycast falls straight through to the original implementation
// otherwise. Nothing else in the app changes behaviour.
import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

let installed = false;
export function installBVH(): void {
  if (installed) return;
  installed = true;
  (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  (THREE.Mesh.prototype as any).raycast = acceleratedRaycast;
}

/** Build (or rebuild) the bounds tree for a geometry about to be picked against.
 *  Cheap enough to do on every new build — a 100k-triangle tree is a few ms — and it
 *  pays for itself on the first hover. Silently skipped for geometry that can't carry
 *  one (no position attribute yet); picking then just uses the linear path.
 *
 *  `indirect` IS NOT OPTIONAL HERE. The default build REORDERS the geometry's index to
 *  group triangles spatially, and replicad's faceGroups are (start, count) ranges INTO
 *  that index — reorder it and every B-rep face id points at the wrong triangle. The
 *  symptom is quiet and total: face picking still returns a region, but it's a spatial
 *  blob spanning several real faces, so a flat top reports itself as curved and
 *  Push/Pull refuses to work on it. The indirect build keeps the index as authored and
 *  puts the ordering in a side buffer instead. */
export function ensureBoundsTree(geo: THREE.BufferGeometry | null | undefined): void {
  if (!geo || (geo as any).boundsTree) return;
  const pos = geo.getAttribute("position");
  if (!pos || pos.count < 3) return;
  try {
    (geo as any).computeBoundsTree({ maxLeafTris: 12, indirect: true });
  } catch {
    // A degenerate/NaN soup (imported STL, half-finished generative mesh) can't be
    // partitioned. Picking still works — it just walks triangles the old way.
  }
}

/** Drop a geometry's tree when the geometry itself is disposed, so the tree's typed
 *  arrays don't outlive it. */
export function dropBoundsTree(geo: THREE.BufferGeometry | null | undefined): void {
  if (!geo || !(geo as any).boundsTree) return;
  try { (geo as any).disposeBoundsTree(); } catch { /* already gone */ }
}
