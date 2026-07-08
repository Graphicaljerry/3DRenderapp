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

export interface PreviewApi {
  /** Load the committed model (display coords). Call once per commit, not per tick. */
  setBase(positions: Float32Array, indices: Uint32Array | null): Promise<{ ok: boolean; error?: string }>;
  /** One drag tick: boolean the closed prism against the base. Returns a triangle soup
   *  (positions only) in the same display coords. */
  preview(prism: Float32Array, op: "add" | "cut"): Promise<{ ok: true; positions: Float32Array } | { ok: false; error: string }>;
}

const api: PreviewApi = {
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
      const out = op === "add" ? base.add(tool) : base.subtract(tool);
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
