// Naming the defects in a mesh, and fixing the ones that can be fixed locally —
// no network, no key, no credits.
//
// print/repair.ts (still the export preflight's auto-fix and the SVG extruder's
// closer) does four things: three's mergeVertices, drop zero-area triangles,
// centroid-fan the boundary loops, flip everything if the TOTAL signed volume came
// out negative. That is enough for a CAD tessellation with a seam. It is not what an
// AI mesh engine ships, which is typically: a handful of triangles wound against
// their neighbours (a global flip cannot fix those — it just inverts which ones are
// wrong), a 0.02 mm³ tetrahedron floating beside the body, and vertex pairs a
// nanometre apart that survive the weld. And it reports one number, "open edges",
// for six different problems.
//
// Which libraries do what here, and why:
//
//   manifold-3d — USED, as the verdict, never as the repair. Its constructor is a
//     solid-modelling kernel's own opinion on whether a mesh is a closed, coherently
//     wound 2-manifold, and status() names the failure when it isn't. That is worth
//     more than our edge counter agreeing with itself, so verifySolid() (preview
//     worker, where Manifold already lives) runs the repaired mesh through it before
//     the UI is allowed to use the word "watertight". It cannot do the repairing:
//     every Manifold operation needs a valid manifold to begin with, which is exactly
//     what a broken mesh is not.
//
//   meshoptimizer — deliberately NOT used here; it stays behind Simplify.
//     generatePositionRemap welds on exact position equality, which misses the
//     near-duplicates that cause most of these cracks. simplifyPrune does drop small
//     islands, but its threshold is a fraction of mesh scale rather than a volume and
//     it does not report what it removed — and naming the debris, in mm³, so the user
//     can tell a stray blob from a real 2 mm pin, is most of the point of this pass.
//
//   three's mergeVertices — not used here either. It buckets coordinates on a fixed
//     grid (`~~(v * 1/tolerance)`), so two vertices a nanometre apart that straddle a
//     bucket line are never compared and the crack between them survives the weld.
//     weldVertices() below searches the neighbouring cells, which is the difference
//     between "welded" and "welded except along one seam".

import * as THREE from "three";

export interface MeshDefects {
  triangles: number;
  /** Vertices as the file stores them (a triangle soup repeats every shared corner). */
  sourceVertices: number;
  /** Distinct vertices once positions within the tolerance are fused. */
  vertices: number;
  /** Edges used by exactly one triangle — the model is open there. */
  boundaryEdges: number;
  /** How many separate holes those edges close up into. */
  holes: number;
  /** Edges shared by three or more triangles: a slicer cannot decide which side is in. */
  nonManifoldEdges: number;
  /** Triangles wound against the majority of their own shell. */
  invertedFaces: number;
  /** Shells whose surface faces inward once the shell is internally consistent.
   *  For an open shell this reads a signed volume that has holes in it — an estimate. */
  insideOutShells: number;
  degenerateTriangles: number;
  shellCount: number;
  /** Shells small enough that the repair would delete them. Counted over every shell,
   *  not just the ones listed below — a mesh can trail hundreds of specks. */
  debrisShells: number;
  /** Volume in mm³ of the biggest DETAIL_SHELLS shells, largest first. A shell with
   *  holes in it gets the closed-surface estimate, not a fact. */
  shells: number[];
}

export interface RepairOptions {
  /** Positions closer together than this fuse. Default: 1e-5 of the model's diagonal,
   *  clamped to 0.00001–0.01 mm — below anything an FDM printer can resolve, so this
   *  can only ever close float noise, never a real feature. */
  weldToleranceMM?: number;
  /** A shell is debris only if it is under this volume AND under tinyShellSpanFraction
   *  of the model's diagonal. Both, because a big open patch can have a near-zero
   *  signed volume without being small, and deleting it would be silent data loss. */
  tinyShellMM3?: number;
  tinyShellSpanFraction?: number;
  /** Holes with more edges than this are left open. A centroid fan across a large,
   *  wandering boundary makes a lid that passes through the model — worse than a hole,
   *  because the slicer no longer flags it. */
  maxHoleEdges?: number;
}

export interface MeshRepairReport {
  before: MeshDefects;
  after: MeshDefects;
  verticesFused: number;
  degenerateRemoved: number;
  facesReoriented: number;
  shellsFlipped: number;
  /** Volume in mm³ of each debris shell deleted — named so the user can spot a mistake. */
  shellsRemoved: number[];
  holesFilled: number;
  holesLeft: number;
}

/** The kernel's verdict on the repaired mesh — see verifySolid() in engine/previewEngine. */
export interface SolidVerdict {
  solid: boolean;
  /** Manifold's own ErrorStatus string, or the exception text if it threw. */
  status: string;
  volumeMM3: number;
  genus: number;
  shells: number;
}

/** Above this the diagnosis is skipped on the automatic (idle) path.
 *
 *  Measured in the harness (sphere soups, `tmp-perf` run): 67k triangles → 113 ms,
 *  159k → 505 ms, 312k → 1.13 s, which puts diagnoseMesh within a few percent of the
 *  analyzePrintability pass that already shares this idle callback (352 ms / 615 ms /
 *  1.12 s at the same sizes). So the budget is set where the pair still fits in one
 *  deferred chunk; above it a multi-million-triangle sculpt would visibly stall the
 *  frame it lands on. The Repair button runs at any size — it shows a busy state. */
export const DIAGNOSE_BUDGET_TRIANGLES = 300_000;

const DETAIL_SHELLS = 12;

const DEFAULTS: Required<RepairOptions> = {
  weldToleranceMM: 0,
  tinyShellMM3: 1,
  tinyShellSpanFraction: 0.02,
  maxHoleEdges: 512,
};

/** The debris threshold, quoted in the UI so the number the user reads is this one. */
export const TINY_SHELL_MM3 = DEFAULTS.tinyShellMM3;

// ---------------------------------------------------------------------------
// Topology: one pass that both the diagnosis and the repair read from.
// ---------------------------------------------------------------------------

interface ShellState {
  triangles: number;
  volume: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

interface Topology {
  positions: Float32Array; // welded, vertCount * 3
  vertCount: number;
  index: Uint32Array; // degenerates already gone, winding untouched
  faceShell: Int32Array;
  /** 1 = this face is wound against its shell's majority. */
  faceFlip: Uint8Array;
  shells: ShellState[];
  edges: Map<number, number[]>;
  sourceVertices: number;
  degenerateTriangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  invertedFaces: number;
  tolerance: number;
  diagonal: number;
}

function sourceArrays(geometry: THREE.BufferGeometry): { pos: Float32Array; index: Uint32Array } {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!attr) throw new Error("geometry has no position attribute");
  const pos = attr.array instanceof Float32Array ? attr.array : Float32Array.from(attr.array as ArrayLike<number>);
  const idx = geometry.index;
  if (idx) return { pos, index: Uint32Array.from(idx.array as ArrayLike<number>) };
  const seq = new Uint32Array(attr.count);
  for (let i = 0; i < attr.count; i++) seq[i] = i;
  return { pos, index: seq };
}

function bboxDiagonal(pos: Float32Array): number {
  if (!pos.length) return 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < x0) x0 = pos[i];
    if (pos[i] > x1) x1 = pos[i];
    if (pos[i + 1] < y0) y0 = pos[i + 1];
    if (pos[i + 1] > y1) y1 = pos[i + 1];
    if (pos[i + 2] < z0) z0 = pos[i + 2];
    if (pos[i + 2] > z1) z1 = pos[i + 2];
  }
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

/** Fuse vertices within `tol`, searching neighbouring buckets so a pair that straddles
 *  a bucket wall still welds. Buckets are 64× the tolerance: at that size a vertex is
 *  almost never near a wall, so the neighbour search costs one lookup in the common
 *  case, and a bucket still holds only a handful of points on any real print mesh. */
function weldVertices(pos: Float32Array, tol: number): { positions: Float32Array; count: number; map: Uint32Array } {
  const n = pos.length / 3;
  const map = new Uint32Array(n);
  const out = new Float32Array(pos.length);
  let count = 0;
  const cell = tol * 64;
  const inv = 1 / cell;
  const tol2 = tol * tol;
  const buckets = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) =>
    (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) | 0;

  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const i0 = Math.floor((x - tol) * inv), i1 = Math.floor((x + tol) * inv);
    const j0 = Math.floor((y - tol) * inv), j1 = Math.floor((y + tol) * inv);
    const k0 = Math.floor((z - tol) * inv), k1 = Math.floor((z + tol) * inv);
    let hit = -1;
    search:
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (let k = k0; k <= k1; k++) {
          const bucket = buckets.get(key(i, j, k));
          if (!bucket) continue;
          for (const c of bucket) {
            const dx = out[c * 3] - x, dy = out[c * 3 + 1] - y, dz = out[c * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= tol2) { hit = c; break search; }
          }
        }
      }
    }
    if (hit >= 0) { map[v] = hit; continue; }
    const id = count++;
    out[id * 3] = x; out[id * 3 + 1] = y; out[id * 3 + 2] = z;
    const home = key(Math.floor(x * inv), Math.floor(y * inv), Math.floor(z * inv));
    const bucket = buckets.get(home);
    if (bucket) bucket.push(id); else buckets.set(home, [id]);
    map[v] = id;
  }
  return { positions: out.slice(0, count * 3), count, map };
}

/** Undirected edge → the faces on it, packed as face * 2 + (1 when the face walks the
 *  edge from its higher vertex id to its lower one). The direction bit is what makes
 *  winding checkable: two neighbours agree exactly when they walk the shared edge in
 *  opposite directions. */
function buildEdges(index: ArrayLike<number>, vertCount: number): Map<number, number[]> {
  const edges = new Map<number, number[]>();
  const add = (u: number, v: number, f: number) => {
    const lo = u < v ? u : v, hi = u < v ? v : u;
    const k = lo * vertCount + hi;
    const rec = f * 2 + (u < v ? 0 : 1);
    const list = edges.get(k);
    if (list) list.push(rec); else edges.set(k, [rec]);
  };
  for (let f = 0; f * 3 < index.length; f++) {
    const a = index[f * 3], b = index[f * 3 + 1], c = index[f * 3 + 2];
    add(a, b, f); add(b, c, f); add(c, a, f);
  }
  return edges;
}

function buildTopology(geometry: THREE.BufferGeometry, opts: Required<RepairOptions>): Topology {
  const src = sourceArrays(geometry);
  const diagonal = bboxDiagonal(src.pos);
  const tolerance = opts.weldToleranceMM > 0
    ? opts.weldToleranceMM
    : Math.min(0.01, Math.max(1e-5, diagonal * 1e-5));

  const weld = weldVertices(src.pos, tolerance);
  const positions = weld.positions;
  const vertCount = weld.count;

  // Degenerates: a repeated corner after welding (the triangle collapsed to a line),
  // or an area small enough to be float noise. Near-degenerate slivers are LEFT alone —
  // they print fine, and deleting them would open a hole where there wasn't one.
  const areaEps = tolerance * tolerance;
  const kept: number[] = [];
  let degenerateTriangles = 0;
  for (let i = 0; i < src.index.length; i += 3) {
    const a = weld.map[src.index[i]], b = weld.map[src.index[i + 1]], c = weld.map[src.index[i + 2]];
    if (a === b || b === c || a === c) { degenerateTriangles++; continue; }
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) * 0.5 <= areaEps) { degenerateTriangles++; continue; }
    kept.push(a, b, c);
  }
  const index = Uint32Array.from(kept);
  const faceCount = index.length / 3;

  const edges = buildEdges(index, vertCount);
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const list of edges.values()) {
    if (list.length === 1) boundaryEdges++;
    else if (list.length > 2) nonManifoldEdges++;
  }

  // Walk face adjacency: one traversal gives both the connected shells and, per face,
  // whether its winding agrees with the seed it was reached from.
  const faceShell = new Int32Array(faceCount).fill(-1);
  const faceFlip = new Uint8Array(faceCount);
  const shells: ShellState[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < faceCount; seed++) {
    if (faceShell[seed] !== -1) continue;
    const shellId = shells.length;
    shells.push({
      triangles: 0, volume: 0,
      minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    });
    faceShell[seed] = shellId;
    stack.push(seed);
    while (stack.length) {
      const f = stack.pop()!;
      for (let e = 0; e < 3; e++) {
        const u = index[f * 3 + e], v = index[f * 3 + ((e + 1) % 3)];
        const lo = u < v ? u : v, hi = u < v ? v : u;
        const list = edges.get(lo * vertCount + hi)!;
        const effF = (u < v ? 0 : 1) ^ faceFlip[f];
        for (const rec of list) {
          const g = rec >> 1;
          if (g === f || faceShell[g] !== -1) continue;
          faceShell[g] = shellId;
          // Agreement means opposite traversal, so g flips exactly when it walks the
          // shared edge the same way f effectively does.
          faceFlip[g] = (rec & 1) === effF ? 1 : 0;
          stack.push(g);
        }
      }
    }
  }

  // The flip flags so far are relative to whichever face the walk happened to start
  // from. "Inverted" means the minority, so a shell that came out mostly-flipped has
  // its flags inverted before anyone counts them.
  const shellFlips = new Int32Array(shells.length);
  for (let f = 0; f < faceCount; f++) {
    shells[faceShell[f]].triangles++;
    if (faceFlip[f]) shellFlips[faceShell[f]]++;
  }
  for (let f = 0; f < faceCount; f++) {
    if (shellFlips[faceShell[f]] * 2 > shells[faceShell[f]].triangles) faceFlip[f] ^= 1;
  }
  let invertedFaces = 0;
  for (let f = 0; f < faceCount; f++) if (faceFlip[f]) invertedFaces++;

  // Signed volume and extent per shell, reading the corrected winding.
  for (let f = 0; f < faceCount; f++) {
    const s = shells[faceShell[f]];
    const a = index[f * 3];
    const b = index[f * 3 + (faceFlip[f] ? 2 : 1)];
    const c = index[f * 3 + (faceFlip[f] ? 1 : 2)];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    s.volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    if (ax < s.minX) s.minX = ax; if (ax > s.maxX) s.maxX = ax;
    if (ay < s.minY) s.minY = ay; if (ay > s.maxY) s.maxY = ay;
    if (az < s.minZ) s.minZ = az; if (az > s.maxZ) s.maxZ = az;
  }

  return {
    positions, vertCount, index, faceShell, faceFlip, shells, edges,
    sourceVertices: src.pos.length / 3,
    degenerateTriangles, boundaryEdges, nonManifoldEdges, invertedFaces,
    tolerance, diagonal,
  };
}

function shellSize(s: ShellState): number {
  if (!s.triangles) return 0;
  return Math.hypot(s.maxX - s.minX, s.maxY - s.minY, s.maxZ - s.minZ);
}

/** Small AND short. Both, because a large open patch can have a near-zero signed volume
 *  without being small, and deleting that would be silent data loss. */
function isDebris(s: ShellState, topo: Topology, opts: Required<RepairOptions>): boolean {
  return Math.abs(s.volume) < opts.tinyShellMM3 && shellSize(s) < topo.diagonal * opts.tinyShellSpanFraction;
}

/** Boundary loops, each wound the way a patch closing it must be wound. A vertex can
 *  sit on more than one loop (two holes meeting at a point), so successors are consumed
 *  from a list rather than a single-entry map. */
function boundaryLoops(index: ArrayLike<number>, edges: Map<number, number[]>, vertCount: number): number[][] {
  const next = new Map<number, number[]>();
  for (let f = 0; f * 3 < index.length; f++) {
    for (let e = 0; e < 3; e++) {
      const u = index[f * 3 + e], v = index[f * 3 + ((e + 1) % 3)];
      const lo = u < v ? u : v, hi = u < v ? v : u;
      if (edges.get(lo * vertCount + hi)!.length !== 1) continue;
      // The surface walks u→v, so the lid closing the hole walks v→u.
      const list = next.get(v);
      if (list) list.push(u); else next.set(v, [u]);
    }
  }
  const loops: number[][] = [];
  for (const start of Array.from(next.keys())) {
    for (;;) {
      const first = next.get(start);
      if (!first || !first.length) break;
      const loop = [start];
      let cur = first.pop()!;
      let closed = cur === start;
      while (!closed) {
        loop.push(cur);
        const onward = next.get(cur);
        if (!onward || !onward.length) break;
        cur = onward.pop()!;
        closed = cur === start;
      }
      if (closed && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

function defectsFrom(topo: Topology, opts: Required<RepairOptions>, holes: number): MeshDefects {
  let insideOutShells = 0;
  for (const s of topo.shells) if (s.volume < 0) insideOutShells++;
  const shells = topo.shells.map((s) => Math.abs(s.volume)).sort((a, b) => b - a).slice(0, DETAIL_SHELLS);
  const debrisShells = topo.shells.length > 1 ? topo.shells.filter((s) => isDebris(s, topo, opts)).length : 0;
  return {
    triangles: topo.index.length / 3,
    sourceVertices: topo.sourceVertices,
    vertices: topo.vertCount,
    boundaryEdges: topo.boundaryEdges,
    holes,
    nonManifoldEdges: topo.nonManifoldEdges,
    invertedFaces: topo.invertedFaces,
    insideOutShells,
    degenerateTriangles: topo.degenerateTriangles,
    shellCount: topo.shells.length,
    debrisShells,
    shells,
  };
}

/** Name every defect in a mesh. Read-only — nothing here changes the geometry. */
export function diagnoseMesh(geometry: THREE.BufferGeometry, options: RepairOptions = {}): MeshDefects {
  const opts = { ...DEFAULTS, ...options };
  const topo = buildTopology(geometry, opts);
  const holes = topo.boundaryEdges ? boundaryLoops(topo.index, topo.edges, topo.vertCount).length : 0;
  return defectsFrom(topo, opts, holes);
}

/** True when at least one thing here is worth clicking Repair over. A watertight mesh
 *  can still be inside-out or trailing debris, so this is not `!isWatertight` — and a
 *  second shell on its own is not a defect, because a box printed beside its lid is two
 *  shells on purpose. Only debris-sized ones count. */
export function needsRepair(d: MeshDefects): boolean {
  return d.boundaryEdges > 0 || d.nonManifoldEdges > 0 || d.invertedFaces > 0
    || d.insideOutShells > 0 || d.degenerateTriangles > 0 || d.debrisShells > 0;
}

/** The defect list, shortest honest phrasing, for a panel row or a tooltip. */
export function defectLines(d: MeshDefects): string[] {
  const out: string[] = [];
  if (d.boundaryEdges > 0) out.push(`${plural(d.boundaryEdges, "open edge")} across ${plural(d.holes, "hole")}`);
  if (d.nonManifoldEdges > 0) out.push(`${plural(d.nonManifoldEdges, "non-manifold edge")} (3+ faces meet)`);
  if (d.invertedFaces > 0) out.push(`${plural(d.invertedFaces, "face")} wound inside-out`);
  if (d.insideOutShells > 0) out.push(`${plural(d.insideOutShells, "shell")} surfaced inward`);
  if (d.degenerateTriangles > 0) out.push(`${plural(d.degenerateTriangles, "zero-area triangle")}`);
  if (d.debrisShells > 0) out.push(`${plural(d.debrisShells, "debris shell")} under ${TINY_SHELL_MM3} mm³ (${d.shellCount} shells in all)`);
  return out;
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

export interface MeshRepairResult {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
  report: MeshRepairReport;
}

export function repairMeshForPrint(input: THREE.BufferGeometry, options: RepairOptions = {}): MeshRepairResult {
  const opts = { ...DEFAULTS, ...options };
  const topo = buildTopology(input, opts);
  const before = defectsFrom(topo, opts, topo.boundaryEdges ? boundaryLoops(topo.index, topo.edges, topo.vertCount).length : 0);

  // 1) Winding: rewrite the minority faces so every shell is internally consistent.
  //    A global flip (what repair.ts does) cannot reach these — it would swap which
  //    faces are wrong and leave the same count behind.
  const faceCount = topo.index.length / 3;
  let index = new Uint32Array(topo.index.length);
  let faceShell = Int32Array.from(topo.faceShell);
  for (let f = 0; f < faceCount; f++) {
    const b = topo.index[f * 3 + 1], c = topo.index[f * 3 + 2];
    index[f * 3] = topo.index[f * 3];
    index[f * 3 + 1] = topo.faceFlip[f] ? c : b;
    index[f * 3 + 2] = topo.faceFlip[f] ? b : c;
  }

  // 2) Debris — see isDebris for why "small" alone is not enough.
  const shellsRemoved: number[] = [];
  const doomed = new Set<number>();
  if (topo.shells.length > 1) {
    topo.shells.forEach((s, id) => {
      if (!isDebris(s, topo, opts)) return;
      doomed.add(id);
      shellsRemoved.push(Math.abs(s.volume));
    });
  }
  if (doomed.size) {
    const keptIndex = new Uint32Array(index.length);
    const keptShell = new Int32Array(faceCount);
    let w = 0;
    for (let f = 0; f < faceCount; f++) {
      if (doomed.has(faceShell[f])) continue;
      keptIndex[w * 3] = index[f * 3];
      keptIndex[w * 3 + 1] = index[f * 3 + 1];
      keptIndex[w * 3 + 2] = index[f * 3 + 2];
      keptShell[w] = faceShell[f];
      w++;
    }
    index = keptIndex.slice(0, w * 3);
    faceShell = keptShell.slice(0, w);
  }

  // 3) Holes: fan each boundary loop to its own centroid, wound to match the surface it
  //    closes so the patch does not create a fresh winding defect.
  const extraVerts: number[] = [];
  const extraTris: number[] = [];
  const extraShell: number[] = [];
  let vertCount = topo.vertCount;
  let holesFilled = 0, holesLeft = 0;
  {
    const vertShell = new Int32Array(vertCount).fill(-1);
    for (let f = 0; f * 3 < index.length; f++) {
      vertShell[index[f * 3]] = faceShell[f];
      vertShell[index[f * 3 + 1]] = faceShell[f];
      vertShell[index[f * 3 + 2]] = faceShell[f];
    }
    const loops = boundaryLoops(index, buildEdges(index, vertCount), vertCount);
    for (const loop of loops) {
      if (loop.length > opts.maxHoleEdges) { holesLeft++; continue; }
      const shell = vertShell[loop[0]];
      if (loop.length === 3) {
        extraTris.push(loop[0], loop[1], loop[2]);
        extraShell.push(shell);
      } else {
        let cx = 0, cy = 0, cz = 0;
        for (const v of loop) {
          cx += topo.positions[v * 3]; cy += topo.positions[v * 3 + 1]; cz += topo.positions[v * 3 + 2];
        }
        const ci = vertCount++;
        extraVerts.push(cx / loop.length, cy / loop.length, cz / loop.length);
        for (let i = 0; i < loop.length; i++) {
          extraTris.push(loop[i], loop[(i + 1) % loop.length], ci);
          extraShell.push(shell);
        }
      }
      holesFilled++;
    }
  }

  const positions = new Float32Array(vertCount * 3);
  positions.set(topo.positions, 0);
  positions.set(extraVerts, topo.positions.length);
  const finalIndex = new Uint32Array(index.length + extraTris.length);
  finalIndex.set(index, 0);
  finalIndex.set(extraTris, index.length);
  const finalShell = new Int32Array(finalIndex.length / 3);
  finalShell.set(faceShell, 0);
  finalShell.set(extraShell, faceShell.length);

  // 4) Inside-out: with the holes closed, a shell's signed volume finally means
  //    something, so anything negative gets turned right-side-out as a whole.
  const shellVolume = new Map<number, number>();
  for (let f = 0; f * 3 < finalIndex.length; f++) {
    const a = finalIndex[f * 3] * 3, b = finalIndex[f * 3 + 1] * 3, c = finalIndex[f * 3 + 2] * 3;
    const v = (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
    shellVolume.set(finalShell[f], (shellVolume.get(finalShell[f]) ?? 0) + v);
  }
  let shellsFlipped = 0;
  for (const v of shellVolume.values()) if (v < 0) shellsFlipped++;
  if (shellsFlipped) {
    for (let f = 0; f * 3 < finalIndex.length; f++) {
      if ((shellVolume.get(finalShell[f]) ?? 0) >= 0) continue;
      const t = finalIndex[f * 3 + 1];
      finalIndex[f * 3 + 1] = finalIndex[f * 3 + 2];
      finalIndex[f * 3 + 2] = t;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setIndex(new THREE.BufferAttribute(finalIndex, 1));
  out.computeVertexNormals();
  out.computeBoundingBox();
  const size = new THREE.Vector3();
  out.boundingBox!.getSize(size);
  const r1 = (n: number) => Math.round(n * 10) / 10;

  // The "after" numbers come from the same analyser the "before" ones did, not from
  // bookkeeping — if a step failed to do what it claimed, this is what notices.
  const after = diagnoseMesh(out, options);
  return {
    geometry: out,
    dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) },
    report: {
      before,
      after,
      verticesFused: before.sourceVertices - before.vertices,
      degenerateRemoved: before.degenerateTriangles,
      facesReoriented: before.invertedFaces,
      shellsFlipped,
      shellsRemoved,
      holesFilled,
      holesLeft,
    },
  };
}

// ---------------------------------------------------------------------------
// Saying what happened, without overstating it
// ---------------------------------------------------------------------------

export interface RepairSummary {
  fixed: string[];
  remaining: string[];
  advice: string[];
  /** The mesh has no detectable defect left AND the kernel did not contradict us. */
  printReady: boolean;
}

function plural(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function describeRepair(r: MeshRepairReport, verdict: SolidVerdict | null): RepairSummary {
  const fixed: string[] = [];
  if (r.verticesFused > 0) fixed.push(`fused ${plural(r.verticesFused, "duplicate vertex", "duplicate vertices")}`);
  if (r.degenerateRemoved > 0) fixed.push(`dropped ${plural(r.degenerateRemoved, "zero-area triangle")}`);
  if (r.facesReoriented > 0) fixed.push(`re-wound ${plural(r.facesReoriented, "face")} that faced the wrong way`);
  if (r.shellsFlipped > 0) fixed.push(`turned ${plural(r.shellsFlipped, "inside-out shell")} right-side-out`);
  if (r.shellsRemoved.length > 0) {
    const sizes = r.shellsRemoved.slice(0, 4).map((v) => `${v >= 1 ? v.toFixed(1) : v.toPrecision(2)} mm³`).join(", ");
    fixed.push(`removed ${plural(r.shellsRemoved.length, "floating shell")} (${sizes}${r.shellsRemoved.length > 4 ? ", …" : ""})`);
  }
  if (r.holesFilled > 0) {
    fixed.push(`closed ${plural(r.holesFilled, "hole")} — open edges ${r.before.boundaryEdges.toLocaleString()} → ${r.after.boundaryEdges.toLocaleString()}`);
  }

  const remaining: string[] = [];
  const advice: string[] = [];
  if (r.after.nonManifoldEdges > 0) {
    remaining.push(`${plural(r.after.nonManifoldEdges, "non-manifold edge")} — three or more faces meet there`);
    advice.push("Non-manifold edges mean two parts of the surface are fused along a seam. Deep repair or your slicer's own repair can rebuild that region; nothing local can decide which side is inside.");
  }
  if (r.after.boundaryEdges > 0) {
    remaining.push(`${plural(r.after.boundaryEdges, "open edge")} across ${plural(r.after.holes, "hole")}`);
    advice.push(r.holesLeft > 0
      ? `${plural(r.holesLeft, "hole")} had a boundary too long to lid safely — a flat patch across it would cut through the model. Rebuild that area, or let the slicer close it and check the sliced preview.`
      : "The openings left do not form closed loops, which is what a torn surface looks like. Most slicers patch small gaps — inspect the sliced preview before you print.");
  }
  if (r.after.invertedFaces > 0) remaining.push(`${plural(r.after.invertedFaces, "face")} still wound against its neighbours`);
  // Advice, not "remaining": anything still standing after the sweep is bigger than the
  // debris threshold, and a box printed beside its lid is two shells on purpose. Listing
  // it as an unfixed defect would contradict the clean verdict two lines later.
  if (r.after.shellCount > 1) {
    advice.push(`The model is ${plural(r.after.shellCount, "separate shell")}, all above the ${TINY_SHELL_MM3} mm³ debris threshold. If they aren't meant to be there, use Separate parts and delete them; if they are — a lid beside its box — nothing needs doing.`);
  }

  const clean = r.after.boundaryEdges === 0 && r.after.nonManifoldEdges === 0
    && r.after.invertedFaces === 0 && r.after.insideOutShells === 0 && r.after.degenerateTriangles === 0;
  const printReady = clean && verdict?.solid !== false;

  if (verdict && !verdict.solid) {
    remaining.push(`the Manifold kernel still rejects it (${verdict.status})`);
    advice.push("Our checks pass and the kernel's don't, which in practice means the surface passes through itself. Self-intersections are not detected or fixed here — that is what Deep repair is for.");
  } else if (!verdict) {
    advice.push("The solid-kernel cross-check didn't run, so this is our own edge count talking.");
  }
  if (printReady) {
    advice.push("Self-intersections are still unchecked — a surface that passes through itself can pass every test above. If the slicer objects, try Deep repair.");
  }
  return { fixed, remaining, advice, printReady };
}

/** The chat receipt. Never says print-ready unless describeRepair agrees. */
export function repairMessage(r: MeshRepairReport, verdict: SolidVerdict | null): string {
  const s = describeRepair(r, verdict);
  const lines: string[] = [];
  lines.push(s.fixed.length
    ? `Repaired the mesh on your own machine — no upload, no credits. **Fixed:** ${s.fixed.join("; ")}.`
    : "Ran the local repair — nothing here needed changing.");
  if (s.remaining.length) lines.push(`**Still there:** ${s.remaining.join("; ")}.`);
  if (verdict?.solid) {
    lines.push(`**Cross-checked:** the Manifold kernel reads it as a closed solid — ${(verdict.volumeMM3 / 1000).toFixed(1)} cm³, genus ${verdict.genus}, ${plural(verdict.shells, "shell")}.`);
  }
  lines.push(s.printReady
    ? "Nothing left that this pass can detect. Exports now use the repaired mesh; undo reverts it."
    : "That's an improvement, not a clean bill of health — this model is not print-ready yet. Exports use the repaired mesh; undo reverts it.");
  for (const a of s.advice) lines.push(a);
  return lines.join("\n\n");
}
