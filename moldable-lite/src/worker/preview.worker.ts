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

/** Pattern value in [0,1] at a point, blended across all three planar projections.
 *  Picking only the normal's DOMINANT axis meant the projection flipped the instant a
 *  surface crossed 45°, and the pattern tore itself apart along every edge of the part
 *  — visible as ragged spikes on each corner. Weighting by |n|⁴ keeps flat faces
 *  essentially pure and blends only through the rounded band near an edge. */
function patternAt(kind: string, px: number, py: number, pz: number, nx: number, ny: number, nz: number, s: number, rib: RibFrame | null): number {
  if (rib) return ribAt(kind, px, py, pz, nx, ny, nz, s, rib);
  const ax = nx * nx * nx * nx, ay = ny * ny * ny * ny, az = nz * nz * nz * nz;
  const w = ax + ay + az || 1;
  let out = 0;
  if (az > 1e-4) out += (az / w) * patternUV(kind, px, py, s);
  if (ax > 1e-4) out += (ax / w) * patternUV(kind, py, pz, s);
  if (ay > 1e-4) out += (ay / w) * patternUV(kind, px, pz, s);
  return out;
}

/** Everything the rib family needs that a single vertex can't know: where the upright
 *  axis is, and how many ribs go round. */
interface RibFrame { cx: number; cy: number; n: number; z0: number; z1: number; fade: number }

/** Ribs, flutes and rings — wrapped around the part's upright axis.
 *
 *  These can't use the triplanar projection the all-over patterns use. A vertical rib
 *  is a function of the ANGLE about the axis, and stamping one from three flat planes
 *  gives you interference fringes instead of ribs. Two things make them come out clean:
 *
 *  1. The rib count is a whole number, so the pattern meets itself exactly at the seam
 *     behind the part. A fixed pitch in millimetres would leave a visible mismatch there.
 *     Because the count is fixed and the angle isn't, ribs converge as the body narrows
 *     — which is exactly what a turned or printed vase does at its neck.
 *  2. Amplitude falls off as a face turns to point up or down, so the ribs live on the
 *     walls and the top rim and base stay flat. Without it a vase gets radial spokes
 *     across its rim and won't sit down properly. */
function ribAt(kind: string, px: number, py: number, pz: number, nx: number, ny: number, nz: number, s: number, rib: RibFrame): number {
  const dx = px - rib.cx, dy = py - rib.cy;
  const theta = Math.atan2(dy, dx);
  const phase = theta * rib.n; // whole turns → the seam closes
  const wall = 1 - Math.abs(nz); // 1 on a vertical wall, 0 on a flat top or bottom
  if (wall < 0.02) return 0;
  // OUTER surfaces only. On a shelled part — a vase, a planter, a pen pot — the inner
  // wall is a surface too, and ribbing it buries detail nobody will ever see inside the
  // pot while doubling the triangles. Carving it would be worse: it eats into a 2.5 mm
  // wall from the inside. A surface belongs to the outside when its normal leans away
  // from the upright axis.
  const rl = Math.hypot(dx, dy);
  if (rl > 1e-6 && (nx * dx + ny * dy) / rl < 0.02) return 0;
  // Ribs also stop short of the foot and the rim. Running them right off the bottom
  // edge leaves a scalloped base that won't lay a clean first layer, and a rim that
  // reads as ragged rather than turned. Every printed vase in the reference photos has
  // this plain band; here it is also what makes the part sit flat.
  const band = Math.min(pz - rib.z0, rib.z1 - pz) / rib.fade;
  if (band <= 0) return 0;
  const ends = band >= 1 ? 1 : band * band * (3 - 2 * band);
  const cyc = (x: number) => x - Math.floor(x); // 0..1 within one rib
  const bar = (x: number) => Math.sqrt(Math.max(0, 1 - (2 * x - 1) * (2 * x - 1)));
  let v: number;
  if (kind === "reed") {
    // Half-round rods with a flat land between them: the rod occupies 70% of the pitch.
    const f = cyc(phase / (2 * Math.PI));
    v = f < 0.7 ? bar(f / 0.7) : 0;
  } else if (kind === "twist") {
    // One full pitch of rise per pitch around, i.e. a 45° helix at the widest radius.
    v = 0.5 + 0.5 * Math.cos(phase + (2 * Math.PI * pz) / s);
  } else if (kind === "pleat") {
    // Folded paper: a triangle wave, with the crease knocked off just enough that the
    // subdivision can resolve it instead of spiking. It used to run at double density,
    // which quietly made "Rib pitch 3 mm" mean 1.5 mm for this one pattern and pushed it
    // past what the mesh could carry. Pleated is the SHARP profile, not the dense one —
    // wind the pitch down if you want more of them.
    const f = cyc(phase / (2 * Math.PI));
    const tri = 1 - Math.abs(2 * f - 1);
    v = tri * tri * (3 - 2 * tri);
  } else if (kind === "ribwave") {
    // The rib's phase meanders as it climbs — organic, not machined.
    v = 0.5 + 0.5 * Math.cos(phase + 1.6 * Math.sin((2 * Math.PI * pz) / (s * 7)));
  } else if (kind === "ring") {
    // Horizontal rings: a function of height alone, so it needs no seam handling.
    v = 0.5 + 0.5 * Math.cos((2 * Math.PI * pz) / s);
  } else {
    v = 0.5 + 0.5 * Math.cos(phase); // flute: plain round ribs
  }
  // Square the falloff so the wall keeps full relief and only the last few degrees
  // before the rim taper out — a linear fade visibly weakened the whole upper body.
  return v * wall * wall * ends;
}

/** The pattern's own height field, on a flat plane. */
function patternUV(kind: string, u: number, v: number, s: number): number {
  if (kind === "noise") return vnoise(u / s, v / s) * 0.7 + vnoise(u / (s * 0.5), v / (s * 0.5)) * 0.3;
  if (kind === "honeycomb") {
    // Ridged tri-lattice → hexagonal cells.
    const k = (2 * Math.PI) / s;
    const w = Math.cos(k * u) + Math.cos(k * (u / 2 + (v * Math.sqrt(3)) / 2)) + Math.cos(k * (u / 2 - (v * Math.sqrt(3)) / 2));
    return Math.min(1, Math.max(0, (w + 1.5) / 4.5));
  }
  if (kind === "wave") {
    // Flowing parallel ridges with a slow drift — the ribbed-vase / dune look.
    return 0.5 + 0.5 * Math.sin((2 * Math.PI * u) / s + 0.8 * Math.cos((2 * Math.PI * v) / (s * 3)));
  }
  if (kind === "voronoi") {
    // Organic cell walls: ridge where the two nearest feature points tie (F2−F1≈0).
    const { f1, f2 } = worley(u / s, v / s);
    return Math.min(1, Math.max(0, 1 - (f2 - f1) * 2.5));
  }
  if (kind === "diamond") {
    // Smooth pyramid grid (stud/quilt look) — unlike knurl's hard checker.
    const tri = (x: number) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);
    return tri(u / s) * tri(v / s);
  }
  if (kind === "fuzzy") {
    // Fuzzy skin: fine random stipple that hides layer lines (like slicers' fuzzy
    // skin, but real geometry that survives any slicer).
    return vnoise(u / (s * 0.18), v / (s * 0.18));
  }
  // ---- Decorative patterns (the Pattern tab): shapes you read from across the room,
  // as opposed to the micro-textures above that you feel in the hand.
  if (kind === "scales") {
    // Overlapping fish scales: staggered rows of dome caps, each row half a cell over.
    const row = Math.floor(v / s);
    const fu = u / s + (row % 2 ? 0.5 : 0) - Math.floor(u / s + (row % 2 ? 0.5 : 0));
    const fv = v / s - row;
    const r = Math.hypot((fu - 0.5) * 2, fv * 1.7);
    return Math.max(0, 1 - r * r);
  }
  if (kind === "chevron") {
    // Parallel V-bands. A sawtooth fed into a sawtooth (the obvious way to write this)
    // makes the phase jump at every cell boundary and reads as crumpled rock; marching
    // a SMOOTH ridge's phase back and forth along v bends the bands at 45° instead.
    const tri = (x: number) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);
    return 0.5 + 0.5 * Math.cos((2 * Math.PI * (u + tri(v / (4 * s)) * 2 * s)) / s);
  }
  if (kind === "weave") {
    // Basket weave: strands run UNBROKEN in both directions and cross everywhere, and
    // a checkerboard decides which one is on top in each cell. Giving each cell its own
    // isolated pad (the obvious reading of "alternate cells carry a strand") just made
    // a quilted pillow — a weave needs the strand to continue past the crossing.
    const iu = Math.floor(u / s), iv = Math.floor(v / s);
    const bar = (x: number) => Math.sqrt(Math.max(0, 1 - (2 * x - 1) * (2 * x - 1)));
    const across = bar(v / s - iv); // strand running along u, sectioned across v
    const along = bar(u / s - iu);
    return (iu + iv) % 2 === 0 ? Math.max(across, along * 0.4) : Math.max(along, across * 0.4);
  }
  if (kind === "dots") {
    // Round studs on a staggered grid — smooth paraboloid domes.
    const row = Math.floor(v / s);
    const fu = u / s + (row % 2 ? 0.5 : 0);
    const cu = fu - Math.floor(fu) - 0.5, cv = v / s - row - 0.5;
    const r = Math.hypot(cu, cv) / 0.36;
    return Math.max(0, 1 - r * r);
  }
  if (kind === "grid") {
    // Raised waffle lines. A clamped linear ramp creases at the shoulder of every
    // ridge, and no amount of subdivision resolves a crease — it came out spiky. A
    // raised-cosine shoulder is smooth all the way down.
    const ridge = (x: number) => {
      const f = x - Math.floor(x);
      const d = Math.min(f, 1 - f) / 0.2;
      return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
    };
    return Math.max(ridge(u / s), ridge(v / s));
  }
  if (kind === "ripple") {
    // Concentric rings spreading from the projection origin (the part's middle).
    return 0.5 + 0.5 * Math.sin((2 * Math.PI * Math.hypot(u, v)) / s);
  }
  // knurl: diamond bumps from two crossed sine ridges. This used to be a hard 0/1
  // checker — vertical walls that the subdivision could only approximate as a jagged
  // staircase, so a real tool handle's crisp diamonds printed as gravel. The product
  // of the two sines gives the same diamond lattice with printable flanks.
  const a = Math.sin((Math.PI * (u + v)) / s);
  const b = Math.sin((Math.PI * (u - v)) / s);
  return Math.abs(a * b);
}

/** Worley/cellular noise: distance to the nearest (f1) and 2nd-nearest (f2) hashed
 *  feature point on the unit lattice. */
function worley(u: number, v: number): { f1: number; f2: number } {
  const iu = Math.floor(u), iv = Math.floor(v);
  let f1 = 9, f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = iu + dx, cy = iv + dy;
      const px = cx + hash2(cx, cy);
      const py = cy + hash2(cy * 7 + 1, cx * 3 + 5);
      const d = Math.hypot(u - px, v - py);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) f2 = d;
    }
  }
  return { f1, f2 };
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
  /** Normals come back WITH the positions: the displaced surface is smooth, and letting
   *  the main thread derive normals from the triangle soup would shade every facet flat. */
  displace(positions: Float32Array, opts: { pattern: string; scale: number; depth: number; refineKey?: string; draft?: boolean }): Promise<{ ok: true; positions: Float32Array; normals: Float32Array } | { ok: false; error: string }>;
  /** Uniform outward surface offset (~delta mm): weld, then displace every vertex along
   *  its area-weighted normal. Correct on non-convex shapes (interior steps move OUT,
   *  where bbox scaling would pull them in) — powers "Make it fit" clearance. */
  grow(positions: Float32Array, delta: number): Promise<{ ok: true; positions: Float32Array } | { ok: false; error: string }>;
  /** Manifold's own verdict on a mesh: does a solid-modelling kernel accept it as a
   *  closed, coherently wound solid, and what does it measure? The local repair
   *  (print/meshdoctor) counts edges; this is the second opinion that lets the UI use
   *  the word "watertight" without it meaning only "our own counter is happy". */
  verify(positions: Float32Array, indices: Uint32Array | null): Promise<
    { ok: true; status: string; empty: boolean; volume: number; genus: number; shells: number }
    | { ok: false; error: string }
  >;
}

/** Refined-but-not-yet-displaced meshes, keyed by base identity + pattern + scale.
 *  Refinement is 95-98% of a displacement's wall time and — because the split test
 *  below compares RELATIVE deviation — is independent of the Relief depth. So while
 *  the Relief slider drags, only the cheap displacement re-runs (~50-150 ms) and the
 *  preview is live. Two slots, because Pattern and Texture can be active together. */
const refineCache = new Map<string, { verts: Float32Array; tris: Uint32Array; hard: Uint8Array; rib: RibFrame | null }>();

const MAX_TRIS = 700_000; // displacement subdivision budget
// Ribs get a bigger one. They are fine, regular and read against a curved silhouette,
// so anywhere the refinement stops short shows up as a visible seam down the wall —
// where an organic texture would just look slightly softer there.
// It used to be 2M, back when refinement was driven by edge LENGTH and most of those
// triangles were spent resolving the direction a rib doesn't vary in. The field-driven
// rule below puts them where the surface actually bends, and a ribbed vase now lands
// around 150k — so the ceiling is headroom, not a target, and it stays low enough that
// positions AND normals both fit in memory on a tablet.
const MAX_TRIS_RIB = 1_200_000;

/** Area-weighted vertex normals over a welded index buffer. */
function vertexNormals(verts: Float32Array, tris: Uint32Array): Float32Array {
  const n = new Float32Array(verts.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += cx; n[i + 1] += cy; n[i + 2] += cz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** The depth-dependent tail of a displacement: push every vertex along its normal by
 *  depth × pattern, then build the smooth-shaded triangle soup. Split out so a cached
 *  refined mesh (see refineCache) can re-run ONLY this while the Relief slider drags. */
function finishDisplace(
  verts: Float32Array,
  tris: Uint32Array,
  hard: Uint8Array,
  rib: RibFrame | null,
  opts: { pattern: string; scale: number; depth: number },
): { ok: true; positions: Float32Array; normals: Float32Array } {
  const nrm = vertexNormals(verts, tris);
  for (let i = 0; i < verts.length; i += 3) {
    const nx = nrm[i], ny = nrm[i + 1], nz = nrm[i + 2];
    const d = opts.depth * patternAt(opts.pattern, verts[i], verts[i + 1], verts[i + 2], nx, ny, nz, opts.scale, rib);
    verts[i] += nx * d; verts[i + 1] += ny * d; verts[i + 2] += nz * d;
  }
  // SHADING NORMALS for the displaced surface, computed here rather than left to the
  // main thread. The mesh below travels as a triangle soup (every downstream stage —
  // export, split, orientation, thin-wall check — expects one), and deriving normals
  // from a soup gives every triangle its own flat facet. On a fluted vase that is a
  // million hard little planes where there should be a smooth curve: the "gritty
  // ribs" this pattern family kept coming out with.
  //
  // The surface is smooth everywhere the model was smooth, however deep the relief,
  // so it is shaded smooth there — and kept flat only at the corners marked hard on
  // the model itself, before displacement.
  const fan = vertexNormals(verts, tris); // on the DISPLACED surface
  const soup = new Float32Array(tris.length * 3);
  const nsoup = new Float32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    for (let k = 0; k < 3; k++) {
      const v = tris[t + k] * 3, o = (t + k) * 3;
      soup[o] = verts[v]; soup[o + 1] = verts[v + 1]; soup[o + 2] = verts[v + 2];
      const smooth = !hard[t + k];
      nsoup[o] = smooth ? fan[v] : fx;
      nsoup[o + 1] = smooth ? fan[v + 1] : fy;
      nsoup[o + 2] = smooth ? fan[v + 2] : fz;
    }
  }
  return transfer({ ok: true as const, positions: soup, normals: nsoup }, [soup.buffer, nsoup.buffer]);
}

const api: PreviewApi = {
  async displace(positions, opts) {
    try {
      // Draft quality is part of the mesh's identity: a try-on must never be served
      // the full-quality mesh (slow) and Apply must never be served the draft (coarse).
      const ck = opts.refineKey ? `${opts.refineKey}|${opts.pattern}|${opts.scale}|${opts.draft ? "d" : "f"}` : null;
      const cached = ck ? refineCache.get(ck) : undefined;
      if (cached) {
        // The base was already welded, refined and crease-marked for this pattern and
        // scale — only the depth changed (the Relief slider mid-drag). Displace a copy.
        const verts = cached.verts.slice();
        return finishDisplace(verts, cached.tris, cached.hard, cached.rib, opts);
      }
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
      // Ribs wrap around the part's upright axis, so they need that axis and a whole
      // number of ribs before anything can be evaluated. The axis is the centre of the
      // footprint; the count comes from the requested pitch at the WIDEST radius, so the
      // pitch you asked for is the pitch you get on the broadest part of the body.
      const RIBS = new Set(["flute", "reed", "twist", "pleat", "ribwave", "ring"]);
      let rib: RibFrame | null = null;
      let ribPitchMin = opts.scale;
      if (RIBS.has(opts.pattern)) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < verts.length; i += 3) {
          if (verts[i] < x0) x0 = verts[i];
          if (verts[i] > x1) x1 = verts[i];
          if (verts[i + 1] < y0) y0 = verts[i + 1];
          if (verts[i + 1] > y1) y1 = verts[i + 1];
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        let rMax = 0, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < verts.length; i += 3) {
          const r = Math.hypot(verts[i] - cx, verts[i + 1] - cy);
          if (r > rMax) rMax = r;
          if (verts[i + 2] < z0) z0 = verts[i + 2];
          if (verts[i + 2] > z1) z1 = verts[i + 2];
        }
        // A band about one rib pitch deep, but never more than a tenth of the height —
        // on a shallow tray a fixed band would swallow the whole wall.
        const fade = Math.min(Math.max(1, opts.scale), (z1 - z0) * 0.1);
        rib = { cx, cy, n: Math.max(3, Math.round((2 * Math.PI * rMax) / Math.max(0.5, opts.scale))), z0, z1, fade: Math.max(0.2, fade) };
        // The rib COUNT is fixed, so the pitch on the ground is smallest wherever the
        // body is narrowest — on a 87×60 part that is 2 mm, not the 3 mm asked for. The
        // mesh has to be fine enough for the tightest ribs on the part or those come out
        // with crests of uneven height, which reads as random dark streaks down the wall.
        ribPitchMin = (2 * Math.PI * Math.max(1, Math.min(x1 - x0, y1 - y0) / 2)) / rib.n;
      }
      // How fine the mesh has to be, decided by the PATTERN rather than by edge length.
      //
      // Refining every edge longer than one target was isotropic, and a rib is not: it
      // is a wave across the body and a constant along it, so a length rule refined the
      // boring direction exactly as hard as the interesting one. The budget ran out
      // resolving the length of a flute, and its crests — the only part anyone looks at
      // — came out of a million triangles still visibly stepped.
      //
      // Instead: sample the displacement at both ends of an edge and at its middle. If
      // the middle sits where a straight line between the ends would put it, splitting
      // buys nothing and the edge is left long. Crests, creases and the shoulder of a
      // stud fail that test and get refined; flat walls, rims, the inside of a shelled
      // pot and the length of a rib pass it and stay coarse.
      const feat = rib ? ribPitchMin : opts.pattern === "fuzzy" ? opts.scale * 0.18 : opts.scale;
      // Two hard bounds around that test. The coarse one is Nyquist: with no edge longer
      // than half a cycle, a whole feature cannot hide between the three samples and
      // fool the test into passing. The fine one is where refinement stops regardless.
      const coarseEdge = Math.max(0.3, feat * 0.5);
      // …and the fine one is a samples-per-feature budget, which is the honest way to say
      // "how good does this need to look": six facets across a rib, twelve across an
      // all-over pattern (those have hard rims — a stud's dome, a scale's cap — and a rib
      // does not). Bounding it here rather than letting the tolerance below decide keeps
      // the triangle count predictable on any part, instead of depending on how sharply
      // that particular body curves.
      const minEdge = Math.max(0.07, feat / (rib ? 8 : 12));
      // Tolerated departure from a straight line, in millimetres of relief. An eighth of
      // the relief lands around five facets across a rib — well under a 0.4 mm nozzle,
      // and smooth to the eye because the surface is SHADED smooth (below) rather than
      // relying on facet size to hide itself. A twentieth looked no better and cost four
      // times the triangles, which on a real vase meant hitting the ceiling and stopping
      // refinement mid-wall — a visible seam, from asking for more than could be paid.
      // RELATIVE, not absolute: deviation and relief both scale linearly with depth,
      // so testing deviation/depth against a constant makes the refinement identical
      // across the whole Relief range — which is what lets the refined mesh be CACHED
      // and the Relief slider re-displace it live instead of re-refining per tick.
      // 0.125 of the relief ≈ five facets across a rib, same quality as before.
      let relTol = 0.125;
      // ADAPTIVE refinement: split only the edges that are still too long.
      //
      // This used to split every triangle into four, every pass. On a CAD part that is
      // exactly the wrong distribution — a fillet arrives already finely tessellated and
      // gets refined into oblivion, while the big flat wall next to it is still coarse
      // when the triangle budget runs out. Ribs on a 60 mm body came out as a staircase
      // with 290k triangles already spent.
      //
      // The split decision is a property of the EDGE, not the triangle, so the two
      // triangles sharing an edge always agree and the surface cannot crack open into
      // T-junctions. A triangle with 1, 2 or 3 of its edges marked emits 2, 3 or 4
      // children respectively; one with none is passed through untouched.
      const ekey = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
      for (let pass = 0; pass < 12; pass++) {
        // The field is evaluated along the surface normal, so the pass needs normals
        // for the mesh as it stands — the same ones the displacement will use.
        const vn = vertexNormals(verts, tris);
        // Unit amplitude — see relTol above. The sign of depth (carved vs raised)
        // changes only the displacement direction, never where detail is needed.
        const fieldAt = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) =>
          patternAt(opts.pattern, px, py, pz, nx, ny, nz, opts.scale, rib);
        const need = new Set<string>();
        for (let t = 0; t < tris.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const i = tris[t + e], j = tris[t + ((e + 1) % 3)];
            const k = ekey(i, j);
            if (need.has(k)) continue; // the other triangle sharing it already decided
            const a = i * 3, b = j * 3;
            const len = Math.hypot(verts[a] - verts[b], verts[a + 1] - verts[b + 1], verts[a + 2] - verts[b + 2]);
            if (len <= minEdge) continue;
            if (len > coarseEdge) { need.add(k); continue; }
            const da = fieldAt(verts[a], verts[a + 1], verts[a + 2], vn[a], vn[a + 1], vn[a + 2]);
            const db = fieldAt(verts[b], verts[b + 1], verts[b + 2], vn[b], vn[b + 1], vn[b + 2]);
            let mx = vn[a] + vn[b], my = vn[a + 1] + vn[b + 1], mz = vn[a + 2] + vn[b + 2];
            const ml = Math.hypot(mx, my, mz) || 1;
            const dm = fieldAt(
              (verts[a] + verts[b]) / 2, (verts[a + 1] + verts[b + 1]) / 2, (verts[a + 2] + verts[b + 2]) / 2,
              mx / ml, my / ml, mz / ml,
            );
            if (Math.abs(dm - (da + db) / 2) > relTol) need.add(k);
          }
        }
        if (!need.size) break;
        // Cost this pass before paying for it, so the budget stops us between passes
        // rather than halfway through building an array.
        let out = 0;
        for (let t = 0; t < tris.length; t += 3) {
          const a = tris[t], b = tris[t + 1], c = tris[t + 2];
          const m = (need.has(ekey(a, b)) ? 1 : 0) + (need.has(ekey(b, c)) ? 1 : 0) + (need.has(ekey(c, a)) ? 1 : 0);
          out += m + 1;
        }
        // A try-on runs at a quarter of the budget: it exists to be judged on screen,
        // not printed, and a preview that takes ten seconds per slider tick is not a
        // preview. Apply re-runs at full quality (the draft flag is in the cache key).
        if (out > (rib ? MAX_TRIS_RIB : MAX_TRIS) / (opts.draft ? 4 : 1)) {
          // Do NOT abandon the pass: that left the mesh refined everywhere except
          // where the budget ran out — a visible seam — and it meant a FINER Size
          // setting could come out COARSER than a bigger one, the opposite of what
          // the slider promises. Loosen the tolerance and re-mark instead, so the
          // shortfall is spread evenly across the whole surface.
          relTol *= 2;
          if (relTol > 1) break;
          continue;
        }
        const mid = new Map<string, number>();
        const nv: number[] = [];
        const midOf = (i: number, j: number): number => {
          const k = ekey(i, j);
          let m2 = mid.get(k);
          if (m2 === undefined) {
            m2 = verts.length / 3 + nv.length / 3;
            const a = i * 3, b = j * 3;
            let mx = (verts[a] + verts[b]) / 2, my = (verts[a + 1] + verts[b + 1]) / 2, mz = (verts[a + 2] + verts[b + 2]) / 2;
            // Phong tessellation (Boubekeur & Alexa): lift the midpoint off the CHORD
            // toward the smooth surface the two endpoint normals describe. A midpoint
            // left on the chord inherits the base tessellation's flat facets, and the
            // displacement then rides those facets — crests came out at visibly uneven
            // heights, the wavy streaks in the fluted-model report. Projecting the
            // chord midpoint onto each endpoint's tangent plane and blending recovers
            // the curvature the tessellation chopped off. Guarded by normal agreement:
            // across a real model edge (a box corner, a rim) the normals disagree and
            // the midpoint stays on the chord, so hard edges stay hard.
            const nax = vn[a], nay = vn[a + 1], naz = vn[a + 2], nbx = vn[b], nby = vn[b + 1], nbz = vn[b + 2];
            if (nax * nbx + nay * nby + naz * nbz > 0.77) { // cos 40° — same smooth stretch as the crease rule
              const da = (mx - verts[a]) * nax + (my - verts[a + 1]) * nay + (mz - verts[a + 2]) * naz;
              const db = (mx - verts[b]) * nbx + (my - verts[b + 1]) * nby + (mz - verts[b + 2]) * nbz;
              const px = mx - (da * nax + db * nbx) / 2, py = my - (da * nay + db * nby) / 2, pz = mz - (da * naz + db * nbz) / 2;
              const ALPHA = 0.75; // the paper's default; 1.0 over-inflates near creases
              mx += (px - mx) * ALPHA; my += (py - my) * ALPHA; mz += (pz - mz) * ALPHA;
            }
            nv.push(mx, my, mz);
            mid.set(k, m2);
          }
          return m2;
        };
        const nt = new Uint32Array(out * 3);
        let o = 0;
        const push = (x: number, y: number, z: number) => { nt[o++] = x; nt[o++] = y; nt[o++] = z; };
        for (let t = 0; t < tris.length; t += 3) {
          let a = tris[t], b = tris[t + 1], c = tris[t + 2];
          let s0 = need.has(ekey(a, b)), s1 = need.has(ekey(b, c)), s2 = need.has(ekey(c, a));
          const n = (s0 ? 1 : 0) + (s1 ? 1 : 0) + (s2 ? 1 : 0);
          if (n === 0) { push(a, b, c); continue; }
          if (n === 3) {
            const m0 = midOf(a, b), m1 = midOf(b, c), m2 = midOf(c, a);
            push(a, m0, m2); push(m0, b, m1); push(m2, m1, c); push(m0, m1, m2);
            continue;
          }
          // Rotate the triangle so the marked edges sit in a canonical place: for one
          // split that is ab, for two it is ab and bc. Rotation preserves winding.
          for (let r = 0; r < 3; r++) {
            if (n === 1 ? s0 : s0 && s1) break;
            const ta = a; a = b; b = c; c = ta;
            const t0 = s0; s0 = s1; s1 = s2; s2 = t0;
          }
          if (n === 1) {
            const m0 = midOf(a, b);
            push(a, m0, c); push(m0, b, c);
          } else {
            const m0 = midOf(a, b), m1 = midOf(b, c);
            push(a, m0, c); push(m0, m1, c); push(m0, b, m1);
          }
        }
        const merged = new Float32Array(verts.length + nv.length);
        merged.set(verts, 0);
        merged.set(nv, verts.length);
        verts = merged;
        tris = nt;
      }
      // WHERE THE MODEL'S OWN EDGES ARE — recorded now, on the smooth surface, because
      // after displacement they are impossible to tell from the pattern. A deep flute
      // turns the surface through 100° inside a millimetre, so any after-the-fact crease
      // test reads every rib crest as an edge and shades it flat: the crests, the one
      // part that has to look turned, came out as hard little planes. On the smooth
      // surface the question is easy — a corner whose face disagrees with its own vertex
      // fan by more than 38° is a box edge or a rim, and nothing else is.
      const CREASE = Math.cos((38 * Math.PI) / 180);
      const hard = new Uint8Array(tris.length); // one flag per triangle corner
      {
        const fan = vertexNormals(verts, tris);
        for (let t = 0; t < tris.length; t += 3) {
          const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
          const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
          const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
          let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
          const fl = Math.hypot(fx, fy, fz) || 1;
          fx /= fl; fy /= fl; fz /= fl;
          for (let k = 0; k < 3; k++) {
            const v = tris[t + k] * 3;
            hard[t + k] = fan[v] * fx + fan[v + 1] * fy + fan[v + 2] * fz >= CREASE ? 0 : 1;
          }
        }
      }
      if (ck) {
        // Cache the PRE-displacement mesh: finishDisplace mutates verts in place, and
        // the whole point of the entry is to re-displace it at other Relief depths.
        refineCache.set(ck, { verts: verts.slice(), tris, hard, rib });
        while (refineCache.size > 2) refineCache.delete(refineCache.keys().next().value as string);
      }
      return finishDisplace(verts, tris, hard, rib, opts);
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

  async verify(positions, indices) {
    try {
      const wasm = await ensureManifold();
      // NOT toManifold(): that helper is for geometry we already believe in. Here the
      // mesh is the thing under test, so the Manifold is built and then interrogated —
      // a rejected mesh comes back empty with a named status rather than throwing.
      const mesh = new wasm.Mesh({
        numProp: 3,
        vertProperties: positions,
        triVerts: indices && indices.length ? indices : seq(positions.length / 3),
      });
      mesh.merge();
      const m = new wasm.Manifold(mesh);
      const status: string = m.status();
      const empty: boolean = m.isEmpty();
      let volume = 0, genus = 0, shells = 0;
      if (!empty) {
        volume = m.volume();
        genus = m.genus();
        const parts = m.decompose();
        shells = parts.length;
        for (const p of parts) p.delete();
      }
      m.delete();
      return { ok: true as const, status, empty, volume, genus, shells };
    } catch (e: any) {
      return { ok: false as const, error: String(e?.message ?? e) };
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
