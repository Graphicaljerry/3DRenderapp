import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// STL serialization on its own: mesh results store their geometry as STL bytes
// (EngineResult.glb) all over the app, so this stays in the eager bundle, while
// the rest of print/exportClient (3MF/OBJ/zip + fflate) loads on demand.

export function meshOf(geometry: THREE.BufferGeometry): THREE.Mesh {
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

export function geometryToSTL(geometry: THREE.BufferGeometry): Blob {
  const dv = new STLExporter().parse(meshOf(geometry), { binary: true }) as unknown as DataView;
  return new Blob([dv as unknown as BlobPart], { type: "model/stl" });
}
