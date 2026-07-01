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
  if (bb) {
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    g.translate(-cx, -cy, -bb.min.z);
  }
  g.computeBoundingBox();
  return g;
}

export function edgesToGeometry(edges: EdgeMesh): BufferGeometry {
  const g = new BufferGeometry();
  syncLines(g, edges as any);
  return g;
}
