// Best-effort mesh repair for AI-generated meshes: weld seams, drop degenerate
// triangles, fill simple boundary holes (fan to loop centroid), fix inverted
// winding. Honest scope: cracks/holes yes; self-intersections no.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface RepairOutcome {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  boundaryEdgesBefore: number;
  boundaryEdgesAfter: number;
  holesFilled: number;
  degenerateRemoved: number;
  flippedWinding: boolean;
}

function countBoundaryEdges(index: number[], _vertCount: number): number {
  const use = new Map<string, number>();
  for (let i = 0; i < index.length; i += 3) {
    const t = [index[i], index[i + 1], index[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  }
  let n = 0;
  for (const c of use.values()) if (c === 1) n++;
  return n;
}

export function repairGeometry(input: THREE.BufferGeometry): RepairOutcome {
  // ---- 1) weld coincident vertices (position-only clone so welding is aggressive) ----
  let g = input.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const srcIndex = Array.from(g.index ? (g.index.array as ArrayLike<number>) : []);

  // ---- 2) drop degenerate triangles ----
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const index: number[] = [];
  let degenerateRemoved = 0;
  for (let i = 0; i < srcIndex.length; i += 3) {
    const a = srcIndex[i], b = srcIndex[i + 1], c = srcIndex[i + 2];
    if (a === b || b === c || a === c) {
      degenerateRemoved++;
      continue;
    }
    va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); vc.fromBufferAttribute(pos, c);
    n.crossVectors(ab.subVectors(vb, va), ac.subVectors(vc, va));
    if (n.lengthSq() < 1e-14) {
      degenerateRemoved++;
      continue;
    }
    index.push(a, b, c);
  }

  const boundaryEdgesBefore = countBoundaryEdges(index, pos.count);

  // ---- 3) fill boundary loops with a centroid fan ----
  // Directed boundary edges: an edge (a->b) whose undirected use-count is 1.
  const undirected = new Map<string, number>();
  for (let i = 0; i < index.length; i += 3) {
    const t = [index[i], index[i + 1], index[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      undirected.set(k, (undirected.get(k) ?? 0) + 1);
    }
  }
  const nextOf = new Map<number, number>();
  for (let i = 0; i < index.length; i += 3) {
    const t = [index[i], index[i + 1], index[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      // Boundary hole loops run OPPOSITE to triangle winding: edge a->b on the
      // surface means the hole boundary walks b->a.
      if (undirected.get(k) === 1) nextOf.set(b, a);
    }
  }

  const newVerts: number[] = [];
  let holesFilled = 0;
  const visited = new Set<number>();
  let vertCount = pos.count;
  for (const start of Array.from(nextOf.keys())) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      loop.push(cur);
      cur = nextOf.get(cur);
      if (loop.length > 5000) break; // safety
    }
    if (cur !== start || loop.length < 3) continue; // not a closed loop
    // centroid vertex
    const cx = new THREE.Vector3();
    for (const v of loop) cx.add(va.fromBufferAttribute(pos, v));
    cx.multiplyScalar(1 / loop.length);
    const ci = vertCount++;
    newVerts.push(cx.x, cx.y, cx.z);
    for (let i = 0; i < loop.length; i++) {
      index.push(loop[i], loop[(i + 1) % loop.length], ci);
    }
    holesFilled++;
  }

  // rebuild position buffer if we added centroids
  let outPos = pos;
  if (newVerts.length) {
    const merged = new Float32Array(pos.count * 3 + newVerts.length);
    merged.set(pos.array as Float32Array, 0);
    merged.set(newVerts, pos.count * 3);
    outPos = new THREE.BufferAttribute(merged, 3);
  }

  // ---- 4) fix inverted winding (negative signed volume) ----
  let signed = 0;
  for (let i = 0; i < index.length; i += 3) {
    va.fromBufferAttribute(outPos, index[i]);
    vb.fromBufferAttribute(outPos, index[i + 1]);
    vc.fromBufferAttribute(outPos, index[i + 2]);
    signed += va.dot(n.crossVectors(vb, vc)) / 6;
  }
  const flippedWinding = signed < 0;
  if (flippedWinding) {
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = tmp;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", outPos);
  out.setIndex(index);
  out.computeVertexNormals();
  out.computeBoundingBox();

  const boundaryEdgesAfter = countBoundaryEdges(index, vertCount);
  const size = new THREE.Vector3();
  out.boundingBox!.getSize(size);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    geometry: out,
    dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) },
    boundaryEdgesBefore,
    boundaryEdgesAfter,
    holesFilled,
    degenerateRemoved,
    flippedWinding,
  };
}
