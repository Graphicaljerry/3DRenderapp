// Live-preview kernel: Manifold (guaranteed-robust mesh booleans, WASM) fuses/cuts the
// drag prism against the committed display mesh at interactive rates — pure mesh math,
// no OCCT in the loop. OCCT stays the source of truth: every commit still rebuilds
// through the CAD worker; this worker only ever paints previews.
import Module from "manifold-3d";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import { expose, transfer } from "comlink";

let ready: Promise<any> | null = null;
function ensureManifold(): Promise<any> {
  if (!ready) {
    ready = (Module as any)({ locateFile: () => manifoldWasmUrl }).then((m: any) => {
      m.setup();
      return m;
    });
  }
  return ready!;
}

// The committed model as a Manifold, kept until the next setBase. Booleans against it
// are then a single call per drag tick.
let base: any = null;

function seq(n: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/** Typed-array mesh → Manifold. merge() welds the duplicated per-face vertices a CAD
 *  tessellation carries; the constructor throws if the welded mesh isn't a closed solid. */
function toManifold(wasm: any, positions: Float32Array, indices?: Uint32Array | null): any {
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices && indices.length ? indices : seq(positions.length / 3),
  });
  mesh.merge();
  return new wasm.Manifold(mesh);
}

/** Deterministic 2D value-ish noise from integer lattice hashing (no Math.random). */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1024) / 1024;
}
function vnoise(u: number, v: number): number {
  const iu = Math.floor(u), iv = Math.floor(v);
  const fu = u - iu, fv = v - iv;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const a = hash2(iu, iv), b = hash2(iu + 1, iv), c = hash2(iu, iv + 1), d = hash2(iu + 1, iv + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Pattern value in [0,1] at a point, evaluated tri-planar-style: the two coordinates
 *  orthogonal to the vertex normal's dominant axis, so it reads right on every face. */
function patternAt(kind: string, px: number, py: number, pz: number, nx: number, ny: number, nz: number, s: number): number {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let u: number, v: number;
  if (az >= ax && az >= ay) { u = px; v = py; }
  else if (ax >= ay) { u = py; v = pz; }
  else { u = px; v = pz; }
  if (kind === "noise") return vnoise(u / s, v / s) * 0.7 + vnoise(u / (s * 0.5), v / (s * 0.5)) * 0.3;
  if (kind === "honeycomb") {
    // Ridged tri-lattice → hexagonal cells.
    const k = (2 * Math.PI) / s;
    const w = Math.cos(k * u) + Math.cos(k * (u / 2 + (v * Math.sqrt(3)) / 2)) + Math.cos(k * (u / 2 - (v * Math.sqrt(3)) / 2));
    return Math.min(1, Math.max(0, (w + 1.5) / 4.5));
  }
  // knurl: crisp diamond checker.
  const a = Math.sin((Math.PI * (u + v)) / s);
  const b = Math.sin((Math.PI * (u - v)) / s);
  return a * b > 0 ? 1 : 0;
}

export interface PreviewApi {
  /** Load the committed model (display coords). Call once per commit, not per tick. */
  setBase(positions: Float32Array, indices: Uint32Array | null): Promise<{ ok: boolean; error?: string }>;
  /** One drag tick: boolean the closed prism against the base. Returns a triangle soup
   *  (positions only) in the same display coords. "intersect" powers the fit check:
   *  the returned soup is the interference volume between the tool and the base. */
  preview(prism: Float32Array, op: "add" | "cut" | "intersect"): Promise<{ ok: true; positions: Float32Array } | { ok: false; error: string }>;
  /** Physical surface texture: weld → subdivide until edges suit the pattern scale →
   *  displace along vertex normals. Returns a closed triangle soup. */
  displace(positions: Float32Array, opts: { pattern: "knurl" | "honeycomb" | "noise"; scale: number; depth: number }): Promise<{ ok: true; positions: Float32Array } | { ok: false; error: string }>;
  /** Uniform outward surface offset (~delta mm): weld, then displace every vertex along
   *  its area-weighted normal. Correct on non-convex shapes (interior steps move OUT,
   *  where bbox scaling would pull them in) — powers "Make it fit" clearance. */
  grow(positions: Float32Array, delta: number): Promise<{ ok: true; positions: Float32Array } | { ok: false; error: string }>;
}

const MAX_TRIS = 700_000; // displacement subdivision budget

const api: PreviewApi = {
  async displace(positions, opts) {
    try {
      const wasm = await ensureManifold();
      // Weld through Manifold so the displaced surface stays a closed solid.
      const man = toManifold(wasm, positions);
      const mesh = man.getMesh();
      man.delete();
      let verts: Float32Array = mesh.vertProperties.slice();
      let tris: Uint32Array = mesh.triVerts.slice();
      const np: number = mesh.numProp ?? 3;
      if (np !== 3) {
        const nVert = verts.length / np;
        const v3 = new Float32Array(nVert * 3);
        for (let i = 0; i < nVert; i++) { v3[i * 3] = verts[i * np]; v3[i * 3 + 1] = verts[i * np + 1]; v3[i * 3 + 2] = verts[i * np + 2]; }
        verts = v3;
      }
      // Subdivide (1 tri → 4) until edges are fine enough to carry the pattern.
      const targetEdge = Math.max(0.35, opts.scale * 0.45);
      for (let pass = 0; pass < 6; pass++) {
        let maxE = 0;
        for (let t = 0; t < tris.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = tris[t + e] * 3, b = tris[t + ((e + 1) % 3)] * 3;
            const d = Math.hypot(verts[a] - verts[b], verts[a + 1] - verts[b + 1], verts[a + 2] - verts[b + 2]);
            if (d > maxE) maxE = d;
          }
        }
        if (maxE <= targetEdge || (tris.length / 3) * 4 > MAX_TRIS) break;
        const mid = new Map<string, number>();
        const nv: number[] = [];
        const midOf = (i: number, j: number): number => {
          const key = i < j ? `${i}_${j}` : `${j}_${i}`;
          let m2 = mid.get(key);
          if (m2 === undefined) {
            m2 = verts.length / 3 + nv.length / 3;
            nv.push((verts[i * 3] + verts[j * 3]) / 2, (verts[i * 3 + 1] + verts[j * 3 + 1]) / 2, (verts[i * 3 + 2] + verts[j * 3 + 2]) / 2);
            mid.set(key, m2);
          }
          return m2;
        };
        const nt = new Uint32Array(tris.length * 4);
        let o = 0;
        for (let t = 0; t < tris.length; t += 3) {
          const a = tris[t], b = tris[t + 1], c = tris[t + 2];
          const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a);
          nt.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o);
          o += 12;
        }
        const merged = new Float32Array(verts.length + nv.length);
        merged.set(verts, 0);
        merged.set(nv, verts.length);
        verts = merged;
        tris = nt;
      }
      // Area-weighted vertex normals.
      const nrm = new Float32Array(verts.length);
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
        const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        for (const i of [a, b, c]) { nrm[i] += cx; nrm[i + 1] += cy; nrm[i + 2] += cz; }
      }
      // Displace along the (normalised) vertex normal by depth × pattern.
      for (let i = 0; i < verts.length; i += 3) {
        const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
        const nx = nrm[i] / l, ny = nrm[i + 1] / l, nz = nrm[i + 2] / l;
        const d = opts.depth * patternAt(opts.pattern, verts[i], verts[i + 1], verts[i + 2], nx, ny, nz, opts.scale);
        verts[i] += nx * d; verts[i + 1] += ny * d; verts[i + 2] += nz * d;
      }
      // Expand back to a soup for the app's standard pipeline.
      const soup = new Float32Array(tris.length * 3);
      for (let i = 0; i < tris.length; i++) {
        const v = tris[i] * 3;
        soup[i * 3] = verts[v]; soup[i * 3 + 1] = verts[v + 1]; soup[i * 3 + 2] = verts[v + 2];
      }
      return transfer({ ok: true, positions: soup }, [soup.buffer]);
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  async grow(positions, delta) {
    try {
      const wasm = await ensureManifold();
      // Weld so shared vertices exist — vertex normals then average across faces.
      const man = toManifold(wasm, positions);
      const mesh = man.getMesh();
      man.delete();
      const np: number = mesh.numProp ?? 3;
      const vpRaw: Float32Array = mesh.vertProperties;
      const tris: Uint32Array = mesh.triVerts.slice();
      const nVert = vpRaw.length / np;
      const verts = new Float32Array(nVert * 3);
      for (let i = 0; i < nVert; i++) { verts[i * 3] = vpRaw[i * np]; verts[i * 3 + 1] = vpRaw[i * np + 1]; verts[i * 3 + 2] = vpRaw[i * np + 2]; }
      const nrm = new Float32Array(verts.length);
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
        const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        for (const i of [a, b, c]) { nrm[i] += cx; nrm[i + 1] += cy; nrm[i + 2] += cz; }
      }
      for (let i = 0; i < verts.length; i += 3) {
        const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
        verts[i] += (nrm[i] / l) * delta;
        verts[i + 1] += (nrm[i + 1] / l) * delta;
        verts[i + 2] += (nrm[i + 2] / l) * delta;
      }
      const soup = new Float32Array(tris.length * 3);
      for (let i = 0; i < tris.length; i++) {
        const v = tris[i] * 3;
        soup[i * 3] = verts[v]; soup[i * 3 + 1] = verts[v + 1]; soup[i * 3 + 2] = verts[v + 2];
      }
      return transfer({ ok: true, positions: soup }, [soup.buffer]);
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  async setBase(positions, indices) {
    try {
      const wasm = await ensureManifold();
      base?.delete?.();
      base = null;
      const m = toManifold(wasm, positions, indices);
      if (!m.numTri()) {
        m.delete();
        return { ok: false, error: "base mesh reduced to nothing" };
      }
      base = m;
      return { ok: true };
    } catch (e: any) {
      base = null;
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  async preview(prism, op) {
    try {
      const wasm = await ensureManifold();
      if (!base) return { ok: false, error: "no base loaded" };
      const tool = toManifold(wasm, prism);
      const out = op === "add" ? base.add(tool) : op === "intersect" ? base.intersect(tool) : base.subtract(tool);
      tool.delete();
      const mesh = out.getMesh();
      out.delete();
      // Expand to a triangle soup so the main thread's computeVertexNormals yields flat
      // per-face normals — matching the crisp CAD look of the real tessellation.
      const tv: Uint32Array = mesh.triVerts;
      const vp: Float32Array = mesh.vertProperties;
      const np: number = mesh.numProp ?? 3;
      const soup = new Float32Array(tv.length * 3);
      for (let i = 0; i < tv.length; i++) {
        const v = tv[i] * np;
        soup[i * 3] = vp[v];
        soup[i * 3 + 1] = vp[v + 1];
        soup[i * 3 + 2] = vp[v + 2];
      }
      return transfer({ ok: true, positions: soup }, [soup.buffer]);
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },
};

expose(api);
