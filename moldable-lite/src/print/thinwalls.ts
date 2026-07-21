import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { OverlayData } from "./overhang";

// Thin-wall detection, Meshmixer-style: sample the surface, fire a ray INWARD from
// each sample, and the distance to the opposite surface is the local wall thickness.
// FDM reality: walls under ~2 nozzle widths (0.8 mm @ 0.4 mm) come out fragile or
// vanish entirely — a slicer discovers this at slicing time; a CAD app can warn now.

export interface ThinWallReport {
  thresholdMM: number;
  sampled: number;
  thinSamples: number;
  /** Thinnest wall found (mm), or null when nothing measured. */
  minThicknessMM: number | null;
  /** Flagged triangles for the paint-on overlay (solid warning colour). */
  overlay: OverlayData;
}

/** Deterministic PRNG so results (and tests) are repeatable. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THIN_COLOR = new THREE.Color("#e11d48");

export function findThinWalls(
  geometry: THREE.BufferGeometry,
  thresholdMM = 0.8,
  opts: { maxSamples?: number } = {},
): ThinWallReport {
  const maxSamples = opts.maxSamples ?? 800;
  // The BVH writes an index onto the geometry — work on a throwaway copy.
  const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()) as THREE.BufferGeometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const triCount = Math.floor(pos.count / 3);
  const empty: OverlayData = { positions: new Float32Array(0), colors: new Float32Array(0), triangles: 0, areaMM2: 0 };
  if (!triCount) return { thresholdMM, sampled: 0, thinSamples: 0, minThicknessMM: null, overlay: empty };

  g.computeBoundingBox();
  const diag = g.boundingBox!.getSize(new THREE.Vector3()).length();

  // Per-triangle centroid/normal/area + cumulative area for weighted sampling.
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const cum = new Float64Array(triCount);
  const data = new Float32Array(triCount * 7); // cx cy cz nx ny nz area
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    va.fromBufferAttribute(pos, i);
    vb.fromBufferAttribute(pos, i + 1);
    vc.fromBufferAttribute(pos, i + 2);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    n.crossVectors(ab, ac);
    const len = n.length();
    const area = len / 2;
    total += area;
    cum[t] = total;
    const o = t * 7;
    data[o] = (va.x + vb.x + vc.x) / 3;
    data[o + 1] = (va.y + vb.y + vc.y) / 3;
    data[o + 2] = (va.z + vb.z + vc.z) / 3;
    if (len > 0) { data[o + 3] = n.x / len; data[o + 4] = n.y / len; data[o + 5] = n.z / len; }
    data[o + 6] = area;
  }
  if (total <= 0) return { thresholdMM, sampled: 0, thinSamples: 0, minThicknessMM: null, overlay: empty };

  const bvh = new MeshBVH(g);
  const rng = mulberry32(42);
  const ray = new THREE.Ray();
  const EPS = 0.05; // step inside before casting, so the source face never self-hits
  const flagged = new Set<number>();
  let sampled = 0, thin = 0;
  let minT: number | null = null;
  const samples = Math.min(maxSamples, triCount);
  for (let s = 0; s < samples; s++) {
    // Area-weighted pick: big faces (the sides of a wall) get sampled most.
    const r = rng() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const o = lo * 7;
    const nx = data[o + 3], ny = data[o + 4], nz = data[o + 5];
    if (nx === 0 && ny === 0 && nz === 0) continue;
    ray.origin.set(data[o] - nx * EPS, data[o + 1] - ny * EPS, data[o + 2] - nz * EPS);
    ray.direction.set(-nx, -ny, -nz);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (!hit || hit.distance > diag) continue; // open shell here — nothing opposite to measure
    const thickness = hit.distance + EPS;
    if (thickness < 0.02) continue; // coincident/degenerate internal face, not a wall
    sampled++;
    if (minT === null || thickness < minT) minT = thickness;
    if (thickness < thresholdMM) { thin++; flagged.add(lo); }
  }

  // Overlay: the sampled triangles that measured thin, solid warning red.
  const outPos: number[] = [], outCol: number[] = [];
  let area = 0;
  for (const t of flagged) {
    const i = t * 3;
    for (const k of [i, i + 1, i + 2]) {
      outPos.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      outCol.push(THIN_COLOR.r, THIN_COLOR.g, THIN_COLOR.b);
    }
    area += data[t * 7 + 6];
  }
  return {
    thresholdMM,
    sampled,
    thinSamples: thin,
    minThicknessMM: minT === null ? null : Math.round(minT * 100) / 100,
    overlay: { positions: new Float32Array(outPos), colors: new Float32Array(outCol), triangles: flagged.size, areaMM2: Math.round(area * 10) / 10 },
  };
}
