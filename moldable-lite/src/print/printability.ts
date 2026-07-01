import * as THREE from "three";

export interface PrintabilityReport {
  triangleCount: number;
  boundingBox: {
    size: { x: number; y: number; z: number };
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  bedFit: {
    bed: { x: number; y: number; z: number };
    fitsAsIs: boolean;
    fitsWithRotation: boolean;
    fitsRotated: boolean;
  };
  manifold: {
    isWatertight: boolean;
    boundaryEdges: number;
    nonManifoldEdges: number;
    method: "boundary-edge-adjacency";
    note: string;
  };
  overhangs: {
    thresholdDeg: number;
    overhangTriangleCount: number;
    overhangArea: number;
    ratio: number;
  };
  volume: { approxVolume: number; signedVolume: number; note: string };
  warnings: string[];
}

export interface PrinterDefaults {
  bed: { x: number; y: number; z: number };
  overhangThresholdDeg: number;
}

export const DEFAULT_PRINTER: PrinterDefaults = {
  bed: { x: 256, y: 256, z: 256 },
  overhangThresholdDeg: 45,
};

export interface PrintabilityOptions {
  bed?: { x: number; y: number; z: number };
  overhangThresholdDeg?: number;
}

function toTriangleSoup(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

export function analyzePrintability(
  inputGeometry: THREE.BufferGeometry,
  options: PrintabilityOptions = {},
): PrintabilityReport {
  const bed = options.bed ?? DEFAULT_PRINTER.bed;
  const thresholdDeg = options.overhangThresholdDeg ?? DEFAULT_PRINTER.overhangThresholdDeg;
  const warnings: string[] = [];

  const geometry = toTriangleSoup(inputGeometry);
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  if (!pos) throw new Error("geometry has no position attribute");

  const triangleCount = pos.count / 3;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bb.getSize(size);

  const fitsAsIs = size.x <= bed.x && size.y <= bed.y && size.z <= bed.z;
  const fitsWithRotation = size.y <= bed.x && size.x <= bed.y && size.z <= bed.z;
  const fitsRotated = fitsAsIs || fitsWithRotation;
  if (!fitsRotated) warnings.push("Model exceeds the build volume in every tested orientation.");

  const edgeUse = new Map<string, number>();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  const edgeKey = (k1: string, k2: string) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
  const bumpEdge = (k1: string, k2: string) => {
    const k = edgeKey(k1, k2);
    edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
  };

  const up = new THREE.Vector3(0, 0, 1);
  const thresholdRad = THREE.MathUtils.degToRad(thresholdDeg);
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), faceN = new THREE.Vector3();
  let overhangTriangleCount = 0;
  let overhangArea = 0;
  let signedVolume = 0;

  for (let i = 0; i < pos.count; i += 3) {
    va.fromBufferAttribute(pos, i);
    vb.fromBufferAttribute(pos, i + 1);
    vc.fromBufferAttribute(pos, i + 2);

    const ka = keyOf(va.x, va.y, va.z);
    const kb = keyOf(vb.x, vb.y, vb.z);
    const kc = keyOf(vc.x, vc.y, vc.z);
    bumpEdge(ka, kb); bumpEdge(kb, kc); bumpEdge(kc, ka);

    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    faceN.crossVectors(ab, ac);
    const area = faceN.length() * 0.5;
    if (area > 0) faceN.normalize();

    const angleToUp = faceN.angleTo(up);
    if (angleToUp > Math.PI / 2) {
      const overhangFromHorizontal = Math.PI - angleToUp;
      if (overhangFromHorizontal > thresholdRad) {
        overhangTriangleCount++;
        overhangArea += area;
      }
    }

    signedVolume += va.dot(new THREE.Vector3().crossVectors(vb, vc)) / 6;
  }

  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const count of edgeUse.values()) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }
  const isWatertight = boundaryEdges === 0 && nonManifoldEdges === 0;
  if (boundaryEdges > 0) warnings.push(`${boundaryEdges} open (hole) edge(s) — not watertight.`);
  if (nonManifoldEdges > 0) warnings.push(`${nonManifoldEdges} non-manifold edge(s) — shared by >2 faces.`);

  const approxVolume = Math.abs(signedVolume);

  return {
    triangleCount,
    boundingBox: {
      size: { x: r1(size.x), y: r1(size.y), z: r1(size.z) },
      min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
    },
    bedFit: { bed, fitsAsIs, fitsWithRotation, fitsRotated },
    manifold: {
      isWatertight,
      boundaryEdges,
      nonManifoldEdges,
      method: "boundary-edge-adjacency",
      note: "Heuristic: watertight ⇔ every edge shared by exactly 2 triangles (verts fused on a 1e-5 grid).",
    },
    overhangs: {
      thresholdDeg,
      overhangTriangleCount,
      overhangArea,
      ratio: triangleCount ? overhangTriangleCount / triangleCount : 0,
    },
    volume: {
      approxVolume,
      signedVolume,
      note: "Signed-tetrahedra sum; assumes a closed surface.",
    },
    warnings,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
