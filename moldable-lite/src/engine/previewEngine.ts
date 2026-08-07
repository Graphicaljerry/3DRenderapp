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

/** Physical surface treatment: subdivide + displace the mesh in the preview worker.
 *  Two families, one machinery — TEXTURES are micro surface feel (grip, hiding layer
 *  lines), PATTERNS are decorative geometry you read from across the room. */
export type SurfacePattern =
  | "knurl" | "honeycomb" | "noise" | "wave" | "voronoi" | "diamond" | "fuzzy"
  | "scales" | "chevron" | "weave" | "dots" | "grid" | "ripple";
export const TEXTURE_KINDS = ["knurl", "honeycomb", "noise", "wave", "voronoi", "diamond", "fuzzy"] as const;
export const PATTERN_KINDS = ["scales", "chevron", "weave", "dots", "grid", "ripple"] as const;

/** One treatment: what it is, how big a repeat, and how far it stands off the surface
 *  (negative = carved in). Two of these — one pattern, one texture — can ride at once. */
export type SurfFxSlot = { kind: SurfacePattern; scale: number; depth: number };

/** Named for what the printed surface looks like, not for the maths behind it. */
export const FX_LABEL: Record<SurfacePattern, string> = {
  knurl: "Knurl", honeycomb: "Hex", noise: "Noise", wave: "Wave",
  voronoi: "Voronoi", diamond: "Diamond", fuzzy: "Fuzzy",
  scales: "Scales", chevron: "Chevron", weave: "Basket", dots: "Studs",
  grid: "Waffle", ripple: "Ripple",
};

export const FX_TIP: Record<SurfacePattern, string> = {
  knurl: "Crosshatched diamonds, like a tool handle — the classic printed grip.",
  honeycomb: "Hex cells. Reads as engineered; hides layer lines on big flat panels.",
  noise: "Fine random roughness — the cheapest way to kill a shiny, plasticky face.",
  wave: "Soft parallel swells. Gentle on the hand, easy to print at any angle.",
  voronoi: "Irregular organic cells — stone, coral, bone.",
  diamond: "Sharp raised diamonds. Grippier than knurl, and it prints crisper.",
  fuzzy: "Dense micro-bumps. Matte, suede-like, hides everything.",
  scales: "Overlapping dragon scales — armour, fish, creature props.",
  chevron: "Bold zigzag bands. Directional and graphic from across the room.",
  weave: "Basket weave — alternating over-under bars, like woven cane.",
  dots: "Staggered domed studs. Toy-brick energy, and a real thumb grip.",
  grid: "Raised waffle lines. Structural, technical, panel-like.",
  ripple: "Concentric rings spreading from the middle, like water.",
};

export async function displaceMesh(positions: Float32Array, opts: { pattern: SurfacePattern; scale: number; depth: number }): Promise<Float32Array | null> {
  const r = await ensure().displace(positions, opts);
  return r.ok ? r.positions : null;
}
