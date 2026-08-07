import { BufferGeometry, BufferAttribute } from "three";
import type { FaceMesh } from "../worker/workerMessages";

/** replicad face payload -> BufferGeometry, recentred to sit on the bed (min z -> 0).
 *
 *  The attributes wrap the worker's TRANSFERRED buffers directly — this function does
 *  not copy the mesh. (It replaces replicad-threejs-helper's syncFaces, which took a
 *  boxed number[] and copied it into a Float32Array; with the buffers already typed and
 *  handed over, that copy was the last of three.) */
export function facesToGeometry(faces: FaceMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setIndex(new BufferAttribute(faces.triangles, 1));
  g.setAttribute("position", new BufferAttribute(faces.vertices, 3));
  if (faces.normals?.length) g.setAttribute("normal", new BufferAttribute(faces.normals, 3));
  else g.computeVertexNormals();
  // Face groups drive B-rep face picking (see buildTriData). syncFaces used to both
  // stash them on userData AND register draw groups; the second material slot they
  // switched between was never wired up here, so only the userData copy earns its keep.
  if (faces.faceGroups?.length) g.userData.faceGroups = faces.faceGroups;
  g.addGroup(0, faces.triangles.length, 0);
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
