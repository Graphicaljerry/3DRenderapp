import * as THREE from "three";

// Auto-orientation, Tweaker-style (Schranz's open algorithm, simplified): try laying
// each big face-cluster (plus the six axis directions) on the bed, score every
// candidate by supported-overhang area vs bed contact, and suggest the winner as a
// single rotation. Pure geometry — no AI, runs in milliseconds on CAD-sized meshes.

export interface OrientSuggestion {
  /** Rotation to apply to the model (about its centre): axis (unit) + degrees. */
  axis: [number, number, number];
  angleDeg: number;
  fromOverhangMM2: number;
  toOverhangMM2: number;
  fromContactMM2: number;
  toContactMM2: number;
  improved: boolean;
  reason: string;
}

interface Tri { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number; nx: number; ny: number; nz: number; area: number }

const DOWN = new THREE.Vector3(0, 0, -1);

function collectTris(geometry: THREE.BufferGeometry): Tri[] {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const tris: Tri[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    va.fromBufferAttribute(pos, i);
    vb.fromBufferAttribute(pos, i + 1);
    vc.fromBufferAttribute(pos, i + 2);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len <= 0) continue;
    tris.push({
      ax: va.x, ay: va.y, az: va.z, bx: vb.x, by: vb.y, bz: vb.z, cx: vc.x, cy: vc.y, cz: vc.z,
      nx: n.x / len, ny: n.y / len, nz: n.z / len, area: len / 2,
    });
  }
  return tris;
}

/** Overhang + contact area (mm²) with the model rotated so `down` points at the bed. */
function scoreOrientation(tris: Tri[], down: THREE.Vector3, sinT: number): { overhang: number; contact: number; score: number } {
  const q = new THREE.Quaternion().setFromUnitVectors(down, DOWN);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  // Only rotated n.z and rotated vertex z are needed — one matrix row each.
  const rz = (x: number, y: number, z: number) => m[2] * x + m[6] * y + m[10] * z;
  let zmin = Infinity;
  for (const t of tris) {
    const z1 = rz(t.ax, t.ay, t.az), z2 = rz(t.bx, t.by, t.bz), z3 = rz(t.cx, t.cy, t.cz);
    const lo = Math.min(z1, z2, z3);
    if (lo < zmin) zmin = lo;
  }
  let overhang = 0, contact = 0;
  const EPS = 0.3; // "touches the bed" tolerance, mm
  for (const t of tris) {
    const nz = rz(t.nx, t.ny, t.nz);
    if (nz >= -sinT) continue;
    const z1 = rz(t.ax, t.ay, t.az), z2 = rz(t.bx, t.by, t.bz), z3 = rz(t.cx, t.cy, t.cz);
    if (nz < -0.97 && Math.max(z1, z2, z3) < zmin + EPS) contact += t.area;
    else overhang += t.area;
  }
  // Tweaker spirit: minimise supported area, reward a solid footprint.
  return { overhang, contact, score: overhang - 0.25 * contact };
}

/** Candidate "down" directions: the six axes + the biggest area-weighted normal clusters. */
function candidates(tris: Tri[]): THREE.Vector3[] {
  const clusters = new Map<string, { v: THREE.Vector3; area: number }>();
  for (const t of tris) {
    const k = `${Math.round(t.nx * 10)},${Math.round(t.ny * 10)},${Math.round(t.nz * 10)}`;
    const c = clusters.get(k);
    if (c) {
      c.area += t.area;
      c.v.x += t.nx * t.area; c.v.y += t.ny * t.area; c.v.z += t.nz * t.area;
    } else {
      clusters.set(k, { v: new THREE.Vector3(t.nx * t.area, t.ny * t.area, t.nz * t.area), area: t.area });
    }
  }
  const top = [...clusters.values()].sort((a, b) => b.area - a.area).slice(0, 10)
    .map((c) => c.v.normalize())
    .filter((v) => v.lengthSq() > 0.5);
  const axes = [
    new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  ];
  const out: THREE.Vector3[] = [];
  for (const v of [...axes, ...top]) {
    if (!out.some((o) => o.dot(v) > 0.995)) out.push(v);
  }
  return out;
}

export function suggestOrientation(geometry: THREE.BufferGeometry, thresholdDeg: number): OrientSuggestion | null {
  const tris = collectTris(geometry);
  if (!tris.length) return null;
  const sinT = Math.sin(THREE.MathUtils.degToRad(thresholdDeg));

  const current = scoreOrientation(tris, DOWN.clone(), sinT);
  let bestDown = DOWN.clone();
  let best = current;
  for (const d of candidates(tris)) {
    const s = scoreOrientation(tris, d, sinT);
    if (s.score < best.score - 1e-6) { best = s; bestDown = d; }
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;
  // Worth suggesting only when it meaningfully cuts support area — a few mm² of
  // change is noise, and re-orienting a clean part annoys more than it helps.
  const gain = current.overhang - best.overhang;
  const improved = bestDown.dot(DOWN) < 0.995 && current.overhang > 25 && (gain > 0.2 * current.overhang || gain > 400);

  const q = new THREE.Quaternion().setFromUnitVectors(bestDown, DOWN);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  const axis: [number, number, number] = s < 1e-6
    ? [0, 0, 1]
    : [q.x / s, q.y / s, q.z / s];
  // Keep the reported angle in (0°, 180°]: acos(|w|) already folds the sign into the axis? No —
  // flip the axis when w < 0 so axis+angle reproduce q exactly.
  const sign = q.w < 0 ? -1 : 1;

  const reason = !improved
    ? current.overhang <= 25
      ? "This orientation already prints with almost no supports."
      : "No tested orientation beats the current one meaningfully."
    : `Cuts supported overhang from ${r1(current.overhang / 100)} cm² to ${r1(best.overhang / 100)} cm²`
      + (best.contact > current.contact * 1.2 ? " and gives a bigger bed footprint" : "") + ".";

  return {
    axis: [axis[0] * sign, axis[1] * sign, axis[2] * sign],
    angleDeg: Math.round(THREE.MathUtils.radToDeg(angle) * 10) / 10,
    fromOverhangMM2: r1(current.overhang),
    toOverhangMM2: r1(best.overhang),
    fromContactMM2: r1(current.contact),
    toContactMM2: r1(best.contact),
    improved,
    reason,
  };
}
