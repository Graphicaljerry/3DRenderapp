import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface MeshLoad {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
}

/**
 * Load a generated GLB and flatten it into ONE BufferGeometry so it flows through
 * the same viewer / printability / export pipeline as CAD models. glTF is Y-up and
 * often metres; we convert to our Z-up mm convention and drop it onto the bed.
 */
export async function glbToGeometry(glb: Blob): Promise<MeshLoad> {
  const url = URL.createObjectURL(glb);
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.updateMatrixWorld(true);

    const parts: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if ((mesh as any).isMesh && mesh.geometry) {
        let g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        if (g.index) g = g.toNonIndexed();
        // keep only position so unrelated attribute sets can be merged safely
        for (const name of Object.keys(g.attributes)) {
          if (name !== "position") g.deleteAttribute(name);
        }
        parts.push(g);
      }
    });
    if (parts.length === 0) throw new Error("The generated file contained no 3D mesh.");

    let geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geo) throw new Error("Couldn't merge the generated mesh.");

    // heuristic: glTF is metres; if the model is tiny (<2 units) treat as metres -> mm
    geo.computeBoundingBox();
    let size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0 && maxDim < 2) geo.scale(1000, 1000, 1000); // m -> mm

    geo.rotateX(Math.PI / 2); // glTF Y-up -> our Z-up
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    geo.translate(-cx, -cy, -bb.min.z);
    geo.computeVertexNormals();
    geo.computeBoundingBox();

    size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const r = (n: number) => Math.round(n * 10) / 10;
    return { geometry: geo, dims: { x: r(size.x), y: r(size.y), z: r(size.z) } };
  } finally {
    URL.revokeObjectURL(url);
  }
}
