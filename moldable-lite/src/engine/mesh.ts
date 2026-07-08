import { BufferGeometry } from "three";
import { syncFaces } from "replicad-threejs-helper";
import type { FaceMesh } from "../worker/workerMessages";

/** replicad face payload -> BufferGeometry, recentred to sit on the bed (min z -> 0). */
export function facesToGeometry(faces: FaceMesh): BufferGeometry {
  const g = new BufferGeometry();
  syncFaces(g, faces as any);
  if (!faces.normals || faces.normals.length === 0) g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  // Recentre for display, but record the offset so picked points (which are in these
  // display coords) can be mapped back to replicad's shape coords for direct ops.
  // Drop to the bed (min-z → 0) but PRESERVE the part's XY position, so a gizmo Move that
  // shifts the part in X/Y actually sticks (an XY re-centre would silently undo it). Parts are
  // authored ~around the origin, so this keeps them centred until the user moves them.
  let recenter: [number, number, number] = [0, 0, 0];
  if (bb) {
    recenter = [0, 0, bb.min.z];
    g.translate(0, 0, -bb.min.z);
  }
  g.userData.recenter = recenter;
  g.computeBoundingBox();
  return g;
}

