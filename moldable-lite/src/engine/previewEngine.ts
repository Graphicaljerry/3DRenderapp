// Thin main-thread handle on the Manifold preview worker (see preview.worker.ts).
// Lazy: the worker (and its WASM) loads on the first extrude drag, never sooner.
import { wrap, type Remote } from "comlink";
import type { BufferGeometry, BufferAttribute } from "three";
import type { PreviewApi } from "../worker/preview.worker";

let api: Remote<PreviewApi> | null = null;
function ensure(): Remote<PreviewApi> {
  if (!api) {
    const worker = new Worker(new URL("../worker/preview.worker.ts", import.meta.url), { type: "module" });
    api = wrap<PreviewApi>(worker);
  }
  return api;
}

// Which geometry the worker currently holds as its base, and whether loading it failed —
// a geometry Manifold can't weld into a solid stays on the OCCT preview path.
let baseFor: BufferGeometry | null = null;
let baseDead: BufferGeometry | null = null;

/** Make `geometry` the boolean base (no-op if it already is). False → caller should
 *  fall back to the OCCT preview for this geometry. */
export async function previewSetBase(geometry: BufferGeometry): Promise<boolean> {
  if (baseFor === geometry) return true;
  if (baseDead === geometry) return false;
  const pos = geometry.getAttribute("position") as BufferAttribute;
  const idx = geometry.index;
  // Copies, not transfers — the live scene still renders from these buffers.
  const r = await ensure().setBase(
    new Float32Array(pos.array as Float32Array),
    idx ? new Uint32Array(idx.array as ArrayLike<number>) : null,
  );
  if (!r.ok) {
    baseDead = geometry;
    return false;
  }
  baseFor = geometry;
  return true;
}

/** One drag tick: fuse (dist ≥ 0) or cut (dist < 0) the closed prism. Null → fall back. */
export async function previewBoolean(prism: Float32Array, dist: number): Promise<Float32Array | null> {
  if (!baseFor) return null;
  const r = await ensure().preview(prism, dist >= 0 ? "add" : "cut");
  return r.ok ? r.positions : null;
}

/** Fit check: the interference volume (triangle soup) between `tool` and the base —
 *  empty when they don't overlap. Null → Manifold couldn't weld one of the meshes. */
export async function previewIntersect(tool: Float32Array): Promise<Float32Array | null> {
  if (!baseFor) return null;
  const r = await ensure().preview(tool, "intersect");
  return r.ok ? r.positions : null;
}

/** Uniform outward offset (~delta mm along vertex normals) — the clearance-growing
 *  step of "Make it fit". Null → the mesh couldn't be welded into a solid. */
export async function growMesh(positions: Float32Array, delta: number): Promise<Float32Array | null> {
  const r = await ensure().grow(positions, delta);
  return r.ok ? r.positions : null;
}

/** Physical surface texture: subdivide + displace the mesh in the preview worker. */
export async function displaceMesh(positions: Float32Array, opts: { pattern: "knurl" | "honeycomb" | "noise"; scale: number; depth: number }): Promise<Float32Array | null> {
  const r = await ensure().displace(positions, opts);
  return r.ok ? r.positions : null;
}
