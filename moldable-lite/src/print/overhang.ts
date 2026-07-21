import * as THREE from "three";

// Overhang heatmap: the triangles that will need support, as a paint-on overlay.
// Slicer convention: a surface needs support when it tilts more than the threshold
// (default 45°) past vertical while facing DOWN. For a unit face normal n that is
// exactly: n.z < -sin(threshold) — vertical wall n.z = 0 (safe), flat ceiling
// n.z = -1 (worst). Colour ramps amber (just past the threshold) → red (ceiling).

export interface OverlayData {
  /** Flagged triangles only, as a non-indexed soup (display coords). */
  positions: Float32Array;
  /** Per-vertex RGB matching `positions`. */
  colors: Float32Array;
  triangles: number;
  /** Total flagged area, mm². */
  areaMM2: number;
}

const AMBER = new THREE.Color("#f59e0b");
const RED = new THREE.Color("#dc2626");

export function overhangOverlay(geometry: THREE.BufferGeometry, thresholdDeg: number): OverlayData {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const sinT = Math.sin(THREE.MathUtils.degToRad(thresholdDeg));
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const outPos: number[] = [];
  const outCol: number[] = [];
  const col = new THREE.Color();
  let area = 0;
  let tris = 0;
  for (let i = 0; i < pos.count; i += 3) {
    va.fromBufferAttribute(pos, i);
    vb.fromBufferAttribute(pos, i + 1);
    vc.fromBufferAttribute(pos, i + 2);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    n.crossVectors(ab, ac);
    const a2 = n.length();
    if (a2 <= 0) continue;
    n.divideScalar(a2);
    if (n.z >= -sinT) continue; // safe: wall-ish or upward-facing
    // Skip the bed-contact face itself: a downward face sitting on the plate is
    // printed on the bed, not supported. (First layer ⇔ min-z of the model ≈ 0
    // in display coords; tolerate slicing epsilon.)
    if (n.z < -0.999 && Math.max(va.z, vb.z, vc.z) < 0.15) continue;
    tris++;
    area += a2 / 2;
    // Severity 0 at the threshold → 1 at a flat ceiling.
    const t = Math.min(1, (-n.z - sinT) / Math.max(1e-6, 1 - sinT));
    col.copy(AMBER).lerp(RED, t);
    for (const v of [va, vb, vc]) outPos.push(v.x, v.y, v.z);
    for (let k = 0; k < 3; k++) outCol.push(col.r, col.g, col.b);
  }
  return {
    positions: new Float32Array(outPos),
    colors: new Float32Array(outCol),
    triangles: tris,
    areaMM2: Math.round(area * 10) / 10,
  };
}
