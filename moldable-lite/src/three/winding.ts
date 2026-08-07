import * as THREE from "three";

/** Swap two vertices of every triangle to reverse winding.
 *
 *  Both places that build a solid from font/SVG outlines have to flip Y (those formats
 *  are y-down, the scene is y-up), and a single negative axis is a reflection: it leaves
 *  every triangle wound backwards, so `computeVertexNormals()` afterwards bakes normals
 *  that point INTO the solid and a FrontSide material renders its interior. Call this
 *  between the flip and the normals. */
export function reverseWinding(geom: THREE.BufferGeometry) {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i + 8 < a.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = a[i + 3 + k];
      a[i + 3 + k] = a[i + 6 + k];
      a[i + 6 + k] = t;
    }
  }
  pos.needsUpdate = true;
}
