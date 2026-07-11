import * as THREE from "three";

// Split a mesh into its disconnected solids ("ungroup"): weld vertices by position,
// union-find the triangles, and emit one triangle-soup geometry per island, biggest
// volume first. Powers "Separate parts" — e.g. lifting a template's lid off its box
// to dry-fit it — so it must cope with CAD tessellations where faces don't share
// vertex indices (hence position welding, not index adjacency).

/** Union-find with path halving. */
function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function positionsOf(geometry: THREE.BufferGeometry): { pos: Float32Array; index: Uint32Array } {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const pos = attr.array as Float32Array;
  const idx = geometry.index;
  if (idx) return { pos, index: Uint32Array.from(idx.array as ArrayLike<number>) };
  const seqIdx = new Uint32Array(attr.count);
  for (let i = 0; i < attr.count; i++) seqIdx[i] = i;
  return { pos, index: seqIdx };
}

/** Label each triangle with its island id; islands keyed by welded vertex position. */
function triangleIslands(pos: Float32Array, index: Uint32Array): { label: Int32Array; count: number } {
  const nVert = pos.length / 3;
  const weld = new Int32Array(nVert); // vertex → welded representative vertex
  const byPos = new Map<string, number>();
  for (let v = 0; v < nVert; v++) {
    const key = `${Math.round(pos[v * 3] * 5000)}_${Math.round(pos[v * 3 + 1] * 5000)}_${Math.round(pos[v * 3 + 2] * 5000)}`;
    const seen = byPos.get(key);
    if (seen === undefined) {
      byPos.set(key, v);
      weld[v] = v;
    } else weld[v] = seen;
  }
  const parent = new Int32Array(nVert);
  for (let i = 0; i < nVert; i++) parent[i] = i;
  const union = (a: number, b: number) => {
    const ra = find(parent, a), rb = find(parent, b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < index.length; t += 3) {
    union(weld[index[t]], weld[index[t + 1]]);
    union(weld[index[t]], weld[index[t + 2]]);
  }
  const rootToIsland = new Map<number, number>();
  const label = new Int32Array(index.length / 3);
  for (let t = 0; t < index.length; t += 3) {
    const root = find(parent, weld[index[t]]);
    let isl = rootToIsland.get(root);
    if (isl === undefined) {
      isl = rootToIsland.size;
      rootToIsland.set(root, isl);
    }
    label[t / 3] = isl;
  }
  return { label, count: rootToIsland.size };
}

/** How many disconnected solids the mesh contains (1 = already one part). */
export function connectedPartCount(geometry: THREE.BufferGeometry): number {
  const { pos, index } = positionsOf(geometry);
  return triangleIslands(pos, index).count;
}

/** Unsigned volume (mm³) of a closed triangle soup / indexed mesh via signed tetrahedra. */
export function meshVolume(pos: Float32Array, index?: Uint32Array): number {
  let v6 = 0;
  const n = index ? index.length : pos.length / 3;
  for (let i = 0; i < n; i += 3) {
    const a = (index ? index[i] : i) * 3, b = (index ? index[i + 1] : i + 1) * 3, c = (index ? index[i + 2] : i + 2) * 3;
    v6 +=
      pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
      pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
      pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return Math.abs(v6 / 6);
}

/** The mesh's disconnected solids as separate geometries, biggest volume first.
 *  Returns [] when the mesh is already a single connected part. */
export function splitConnectedParts(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const { pos, index } = positionsOf(geometry);
  const { label, count } = triangleIslands(pos, index);
  if (count < 2) return [];
  const triCount = new Array<number>(count).fill(0);
  for (const l of label) triCount[l]++;
  const soups = triCount.map((n) => new Float32Array(n * 9));
  const cursor = new Array<number>(count).fill(0);
  for (let t = 0; t < label.length; t++) {
    const soup = soups[label[t]];
    let o = cursor[label[t]];
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k] * 3;
      soup[o++] = pos[v];
      soup[o++] = pos[v + 1];
      soup[o++] = pos[v + 2];
    }
    cursor[label[t]] = o;
  }
  return soups
    .map((soup) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(soup, 3));
      g.computeVertexNormals();
      g.computeBoundingBox();
      return g;
    })
    .sort((a, b) => {
      // "Largest" by bounding box, not material volume: a hollow box should outrank
      // its solid lid — that's the part a person expects to stay as "the model".
      const vol = (g: THREE.BufferGeometry) => {
        const s = g.boundingBox!.getSize(new THREE.Vector3());
        return s.x * s.y * s.z;
      };
      return vol(b) - vol(a);
    });
}
