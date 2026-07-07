// "Split to fit bed" — when a model is larger than the printer bed, cut it into a
// grid of bed-sized parts (CSG box intersection), then lay the parts out spread
// across the plate so they're ready to print in pieces and assemble. Reframes
// Tripo's "generate in parts" for the maker who prints, not the game artist.

import * as THREE from "three";
import { Evaluator, Brush, INTERSECTION } from "three-bvh-csg";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface SplitPiece {
  geometry: THREE.BufferGeometry; // laid-out, position-only — one printable island
  color: string; // "#rrggbb" used both in the viewer and as the piece's label swatch
  dims: { x: number; y: number; z: number };
}

export interface SplitResult {
  parts: number;
  geometry: THREE.BufferGeometry; // all pieces merged, with a per-piece vertex "color" for display
  pieces: SplitPiece[]; // each piece on its own, for separate STL/3MF export
  dims: { x: number; y: number; z: number };
}

/** Evenly-spaced distinct hue per piece, so adjacent parts read as different colours. */
function pieceColor(i: number, n: number): THREE.Color {
  return new THREE.Color().setHSL((i / Math.max(1, n)) % 1, 0.6, 0.55);
}

const CSG_MAT = new THREE.MeshStandardMaterial();
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Position-only, non-indexed clone — clean input for CSG + mergeGeometries. */
function posOnly(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", (src.getAttribute("position") as THREE.BufferAttribute).clone());
  return out;
}

/** How many bed-sized pieces the model needs along each axis. 1×1×1 means it fits. */
export function partsNeeded(size: { x: number; y: number; z: number }, bed: { x: number; y: number; z: number }, marginMm = 5): { nx: number; ny: number; nz: number } {
  const u = { x: Math.max(bed.x - marginMm, 10), y: Math.max(bed.y - marginMm, 10), z: Math.max(bed.z, 10) };
  return {
    nx: Math.max(1, Math.ceil(size.x / u.x)),
    ny: Math.max(1, Math.ceil(size.y / u.y)),
    nz: Math.max(1, Math.ceil(size.z / u.z)),
  };
}

export function splitToFitBed(geometry: THREE.BufferGeometry, bed: { x: number; y: number; z: number }, marginMm = 5): SplitResult {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!.clone();
  const size = new THREE.Vector3();
  box.getSize(size);
  const { nx, ny, nz } = partsNeeded({ x: size.x, y: size.y, z: size.z }, bed, marginMm);
  if (nx * ny * nz <= 1) {
    return { parts: 1, geometry, pieces: [], dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) } };
  }

  const cx = size.x / nx, cy = size.y / ny, cz = size.z / nz;
  const evaluator = new Evaluator();
  // Position only — inputs are position-only (posOnly) and we recompute normals
  // after; carrying "normal" here reads .array on a missing attribute and throws.
  evaluator.attributes = ["position"];
  const meshBrush = new Brush(posOnly(geometry), CSG_MAT);
  meshBrush.updateMatrixWorld(true);

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        // A slightly-oversized cutting box avoids co-planar seams between cells.
        const boxGeo = new THREE.BoxGeometry(cx * 1.001, cy * 1.001, cz * 1.001);
        const boxBrush = new Brush(posOnly(boxGeo), CSG_MAT);
        boxBrush.position.set(
          box.min.x + (i + 0.5) * cx,
          box.min.y + (j + 0.5) * cy,
          box.min.z + (k + 0.5) * cz,
        );
        boxBrush.updateMatrixWorld(true);
        const res = evaluator.evaluate(meshBrush, boxBrush, INTERSECTION);
        const g = res.geometry;
        const pos = g.getAttribute("position");
        if (pos && pos.count >= 3) parts.push(posOnly(g));
      }
    }
  }
  if (parts.length <= 1) {
    return { parts: parts.length || 1, geometry, pieces: [], dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) } };
  }

  // Recenter each part (centered in X/Y, resting on Z=0), track its own size and
  // the widest footprint for tiling.
  let maxW = 0, maxD = 0;
  const partSize: THREE.Vector3[] = [];
  for (const g of parts) {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const s = new THREE.Vector3();
    b.getSize(s);
    g.translate(-(b.min.x + s.x / 2), -(b.min.y + s.y / 2), -b.min.z);
    partSize.push(s.clone());
    maxW = Math.max(maxW, s.x);
    maxD = Math.max(maxD, s.y);
  }

  // Tile the parts across the plate with a gap so each is a separate printable island.
  const gap = 8;
  const cols = Math.ceil(Math.sqrt(parts.length));
  const rows = Math.ceil(parts.length / cols);
  const stepX = maxW + gap, stepY = maxD + gap;
  parts.forEach((g, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols);
    g.translate((col - (cols - 1) / 2) * stepX, (row - (rows - 1) / 2) * stepY, 0);
  });

  // Keep each piece on its own for separate export; assign a distinct colour.
  const pieces: SplitPiece[] = parts.map((g, i) => {
    const c = pieceColor(i, parts.length);
    const s = partSize[i];
    return { geometry: g, color: "#" + c.getHexString(), dims: { x: r1(s.x), y: r1(s.y), z: r1(s.z) } };
  });

  // Build the merged DISPLAY geometry with a per-piece vertex colour, so the viewer
  // shows the pieces colour-coded. Colours live on a clone so the export pieces stay
  // position-only (STL/3MF ignore colour anyway).
  const coloured = parts.map((g, i) => {
    const cg = posOnly(g);
    const n = (cg.getAttribute("position") as THREE.BufferAttribute).count;
    const c = pieceColor(i, parts.length);
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return cg;
  });
  // Don't weld across pieces here — welding would blend seam colours; each piece is
  // already welded internally enough for display. Volume/printability use the pieces.
  const merged = mergeGeometries(coloured, false);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  const ms = new THREE.Vector3();
  merged.boundingBox!.getSize(ms);
  return { parts: parts.length, geometry: merged, pieces, dims: { x: r1(ms.x), y: r1(ms.y), z: r1(ms.z) } };
}
