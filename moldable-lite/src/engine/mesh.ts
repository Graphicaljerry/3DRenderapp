import { BufferGeometry } from "three";
import { syncFaces, syncLines } from "replicad-threejs-helper";
import type { FaceMesh, EdgeMesh } from "../worker/workerMessages";

/** replicad face payload -> BufferGeometry, recentred to sit on the bed (min z -> 0). */
export function facesToGeometry(faces: FaceMesh): BufferGeometry {
  const g = new BufferGeometry();
  syncFaces(g, faces as any);
  if (!faces.normals || faces.normals.length === 0) g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  // Recentre for display, but record the offset so picked points (which are in these
  // display coords) can be mapped back to replicad's shape coords for direct ops.
  let recenter: [number, number, number] = [0, 0, 0];
  if (bb) {
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    recenter = [cx, cy, bb.min.z];
    g.translate(-cx, -cy, -bb.min.z);
  }
  g.userData.recenter = recenter;
  g.computeBoundingBox();
  return g;
}

export function edgesToGeometry(edges: EdgeMesh): BufferGeometry {
  const g = new BufferGeometry();
  syncLines(g, edges as any);
  return g;
}
