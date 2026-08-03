// Freehand cutting + assembly connectors.
//
// Two jobs that belong together, because both are "the model becomes several parts
// that have to go back together after printing":
//
//  1. penCut — draw a line across the part and it splits along that line. The stroke
//     arrives as points on a camera-facing plane; we thicken it into a thin slab that
//     runs all the way through the model, subtract it, and let the two (or more)
//     disconnected islands fall out. The kerf IS the print clearance, so the halves
//     still meet cleanly instead of fighting for the same 0.2 mm.
//
//  2. addConnectors — registration pins. Every cut face gets pegs on one side and
//     matching sockets on the other, so the pieces locate themselves and glue in the
//     right place instead of being clamped by hand and set crooked. Works off the cut
//     SURFACE, so the same code serves the bed-split grid and a freehand curve.

import * as THREE from "three";
import { Evaluator, Brush, SUBTRACTION, ADDITION } from "three-bvh-csg";
import { MeshBVH } from "three-mesh-bvh";
import { splitConnectedParts } from "./separate";
import type { SplitPiece } from "./split";

const CSG_MAT = new THREE.MeshStandardMaterial();
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Position-only, non-indexed clone — clean CSG input (mirrors split.ts). */
function posOnly(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", (src.getAttribute("position") as THREE.BufferAttribute).clone());
  return out;
}

function pieceColor(i: number, n: number): THREE.Color {
  return new THREE.Color().setHSL((i / Math.max(1, n)) % 1, 0.6, 0.55);
}

/** Ramer–Douglas–Peucker: a 300-sample finger-drag becomes ~15 points that describe
    the same curve. Everything downstream is per-point work, and the raw sample noise
    would otherwise show up as facets along the cut. */
function simplify(pts: THREE.Vector2[], tol: number): THREE.Vector2[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const ab = b.clone().sub(a);
  const len = ab.length();
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len < 1e-9
      ? pts[i].distanceTo(a)
      : Math.abs(ab.x * (a.y - pts[i].y) - (a.x - pts[i].x) * ab.y) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

/** Unit normals per point (average of the adjacent segment normals) — the direction
    the slab is thickened in, and the axis a connector pin follows. */
function pointNormals(pts: THREE.Vector2[]): THREE.Vector2[] {
  const segN = pts.slice(0, -1).map((p, i) => {
    const d = pts[i + 1].clone().sub(p).normalize();
    return new THREE.Vector2(-d.y, d.x);
  });
  return pts.map((_, i) => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    return a.clone().add(b).normalize();
  });
}

export interface CutStroke {
  /** Stroke points in world space, already on a plane facing the camera. */
  pts: [number, number, number][];
  /** The plane's normal (the camera's view direction) — the slab runs along this. */
  viewDir: [number, number, number];
}

export interface CutResult {
  pieces: SplitPiece[];
  geometry: THREE.BufferGeometry; // merged, per-piece vertex colour, still in place
  dims: { x: number; y: number; z: number };
}

/** The cutting slab: the stroke swept through the model, thickened by `kerf`.
    Built as ONE extruded solid rather than a box per segment, so the whole cut is a
    single CSG subtraction however wiggly the line is. */
function buildCutter(stroke: CutStroke, kerf: number, box: THREE.Box3): { geometry: THREE.BufferGeometry; frame: THREE.Matrix4; plane2d: THREE.Vector2[]; normals2d: THREE.Vector2[] } | null {
  const dir = new THREE.Vector3(...stroke.viewDir).normalize();
  const world = stroke.pts.map((p) => new THREE.Vector3(...p));
  if (world.length < 2) return null;

  // A basis on the cutting plane. `right` is any axis not parallel to the view.
  const up0 = Math.abs(dir.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(up0, dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const origin = world[0].clone();

  const flat = world.map((w) => {
    const d = w.clone().sub(origin);
    return new THREE.Vector2(d.dot(right), d.dot(up));
  });
  const diag = box.getSize(new THREE.Vector3()).length();
  const pts = simplify(flat, Math.max(0.05, diag * 0.004));
  if (pts.length < 2) return null;

  // Run the ends well past the model so the cut always exits — a stroke that stops
  // just short of the silhouette would otherwise leave the halves joined by a sliver.
  const ext = diag;
  const head = pts[0].clone().add(pts[0].clone().sub(pts[1]).normalize().multiplyScalar(ext));
  const tail = pts[pts.length - 1].clone().add(pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize().multiplyScalar(ext));
  const line = [head, ...pts, tail];
  const norms = pointNormals(line);

  const half = Math.max(0.02, kerf / 2);
  const left = line.map((p, i) => p.clone().addScaledVector(norms[i], half));
  const rightSide = line.map((p, i) => p.clone().addScaledVector(norms[i], -half));
  const shape = new THREE.Shape([...left, ...rightSide.reverse()]);
  const depth = diag * 2 + 10;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  // ExtrudeGeometry builds in local XY with +Z depth; place that frame on the cutting
  // plane, pushed back half its depth so the slab straddles the whole model.
  const frame = new THREE.Matrix4().makeBasis(right, up, dir).setPosition(origin.clone().addScaledVector(dir, -depth / 2));
  geo.applyMatrix4(frame);
  return { geometry: posOnly(geo), frame, plane2d: line, normals2d: norms };
}

/** Cut `geometry` along a drawn stroke. Returns the resulting pieces (2+ when the line
    actually separates the part), or null when the stroke missed / left it in one piece. */
export function penCut(geometry: THREE.BufferGeometry, stroke: CutStroke, opts?: { kerf?: number }): CutResult | null {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!.clone();
  const built = buildCutter(stroke, opts?.kerf ?? 0.2, box);
  if (!built) return null;

  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  const modelBrush = new Brush(posOnly(geometry), CSG_MAT);
  modelBrush.updateMatrixWorld(true);
  const cutBrush = new Brush(built.geometry, CSG_MAT);
  cutBrush.updateMatrixWorld(true);
  const res = evaluator.evaluate(modelBrush, cutBrush, SUBTRACTION);
  const cut = res.geometry;
  if (!cut.getAttribute("position")?.count) return null;

  const parts = splitConnectedParts(cut).map(posOnly);
  if (parts.length < 2) return null;
  return finishPieces(parts);
}

/** Shared tail of every cut: colour-code the pieces and merge a display geometry.
    Pieces stay WHERE THEY ARE — a freehand cut reads as "the part is now in two",
    and scattering them across the plate would hide whether the cut went where the
    user meant. Laying out for print is the plate system's job, one button later. */
function finishPieces(parts: THREE.BufferGeometry[]): CutResult {
  const pieces: SplitPiece[] = parts.map((g, i) => {
    g.computeBoundingBox();
    const s = g.boundingBox!.getSize(new THREE.Vector3());
    return { geometry: g, color: "#" + pieceColor(i, parts.length).getHexString(), dims: { x: r1(s.x), y: r1(s.y), z: r1(s.z) } };
  });
  const coloured = parts.map((g, i) => {
    const cg = posOnly(g);
    const n = (cg.getAttribute("position") as THREE.BufferAttribute).count;
    const c = pieceColor(i, parts.length);
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return cg;
  });
  const merged = mergeAll(coloured);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  const ms = merged.boundingBox!.getSize(new THREE.Vector3());
  return { pieces, geometry: merged, dims: { x: r1(ms.x), y: r1(ms.y), z: r1(ms.z) } };
}

/** Concatenate position(+color) buffers. mergeGeometries needs matching attribute
    sets; these are built here so they always match, and a hand roll avoids pulling
    the whole BufferGeometryUtils module into this chunk. */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nPos = 0;
  for (const g of list) nPos += (g.getAttribute("position") as THREE.BufferAttribute).count;
  const pos = new Float32Array(nPos * 3);
  const col = new Float32Array(nPos * 3);
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const c = g.getAttribute("color") as THREE.BufferAttribute | undefined;
    pos.set(p.array as Float32Array, o * 3);
    if (c) col.set(c.array as Float32Array, o * 3);
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface ConnectorOpts {
  /** Pin diameter (mm). 4–6 mm suits most FDM parts; smaller snaps off. */
  diameter?: number;
  /** How far the pin stands out of the face (mm). */
  depth?: number;
  /** Printed gap per side between pin and socket (mm) — the printer's reality. */
  clearance?: number;
  /** Cap on how many pins a single cut face gets. */
  maxPerFace?: number;
}

const DEF: Required<ConnectorOpts> = { diameter: 5, depth: 4, clearance: 0.2, maxPerFace: 3 };

/** Solid-inside test: cast a ray and count crossings — odd means inside. Raycast
    through the BVH directly rather than a Mesh, because a Mesh carries a material and
    the default FrontSide silently drops every exit face, which counts every interior
    point as outside (it did: connectors found nowhere to go). DoubleSide is the whole
    point of a crossing count. Built on a clone — MeshBVH indexes the geometry it is
    given, and these same buffers go on to be CSG operands. */
function makeInside(geometry: THREE.BufferGeometry): (p: THREE.Vector3) => boolean {
  const g = geometry.clone();
  const bvh = new MeshBVH(g);
  const dir = new THREE.Vector3(0.5773, 0.5774, 0.5775).normalize(); // nothing axis-aligned to graze
  const ray = new THREE.Ray(new THREE.Vector3(), dir);
  return (p: THREE.Vector3) => {
    ray.origin.copy(p);
    return bvh.raycast(ray, THREE.DoubleSide).length % 2 === 1;
  };
}

/** Where a pin can actually live: on the cut face, with enough meat on BOTH sides to
    hold a peg and a socket without breaking through the surface. */
function viableSites(
  candidates: { pos: THREE.Vector3; axis: THREE.Vector3 }[],
  inside: (p: THREE.Vector3) => boolean,
  axial: number,
  lateral: number,
  maxCount: number,
  minSpacing: number,
): { pos: THREE.Vector3; axis: THREE.Vector3 }[] {
  const ok = candidates.filter((c) => {
    if (!inside(c.pos)) return false;
    // Along the pin: enough depth to bury the peg's root one way and sink the socket
    // the other. Sideways: only the hole's radius plus a wall — asking for the peg's
    // full LENGTH of material sideways banned every site within a pin-length of any
    // surface, which on a normal-thickness part is all of them.
    for (const s of [axial, -axial]) if (!inside(c.pos.clone().addScaledVector(c.axis, s))) return false;
    const side = new THREE.Vector3(c.axis.y, c.axis.z, c.axis.x).cross(c.axis).normalize();
    const side2 = new THREE.Vector3().crossVectors(c.axis, side).normalize();
    for (const v of [side, side2]) {
      if (!inside(c.pos.clone().addScaledVector(v, lateral))) return false;
      if (!inside(c.pos.clone().addScaledVector(v, -lateral))) return false;
    }
    return true;
  });
  if (!ok.length) return [];
  // Farthest-point picking: after the first site, each new pin goes as far from the
  // ones already placed as the face allows. Taking candidates in generated order
  // clustered every pin in one corner, which registers the joint but does nothing
  // to stop it pivoting.
  const picked = [ok[0]];
  while (picked.length < maxCount) {
    let best: { pos: THREE.Vector3; axis: THREE.Vector3 } | null = null;
    let bestD = 0;
    for (const c of ok) {
      const d = Math.min(...picked.map((q) => q.pos.distanceTo(c.pos)));
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best || bestD < minSpacing) break;
    picked.push(best);
  }
  return picked;
}

/** A cylinder standing on `pos`, running `len` along `axis` from `from` along it. */
function cylinder(pos: THREE.Vector3, axis: THREE.Vector3, radius: number, from: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, len, 24, 1);
  // CylinderGeometry runs along +Y; stand it along `axis`, centred at from + len/2.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
  const m = new THREE.Matrix4().compose(pos.clone().addScaledVector(axis, from + len / 2), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return posOnly(g);
}

/** Candidate pin sites on a PLANAR cut: a grid over the face, axis = plane normal. */
export function planeSites(plane: { point: THREE.Vector3; normal: THREE.Vector3 }, box: THREE.Box3, step: number): { pos: THREE.Vector3; axis: THREE.Vector3 }[] {
  const n = plane.normal.clone().normalize();
  const u0 = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const u = new THREE.Vector3().crossVectors(u0, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z) / 2;
  const out: { pos: THREE.Vector3; axis: THREE.Vector3 }[] = [];
  // Centre-out ordering: the middle of a face is the strongest place for a pin, and
  // the picker takes the first viable candidates it meets.
  const steps: number[] = [0];
  for (let d = step; d <= reach; d += step) steps.push(d, -d);
  for (const a of steps) for (const b of steps) out.push({ pos: plane.point.clone().addScaledVector(u, a).addScaledVector(v, b), axis: n.clone() });
  return out;
}

/** Give a set of already-cut pieces mating pins. `sites` describes the cut surface;
 *  for each one the piece on the −axis side grows a peg and the piece on the +axis
 *  side gets the matching socket. Returns new geometries (input untouched); pieces
 *  that gain nothing come back as they were. */
export function addConnectors(
  pieces: THREE.BufferGeometry[],
  original: THREE.BufferGeometry,
  sites: { pos: THREE.Vector3; axis: THREE.Vector3 }[],
  opts?: ConnectorOpts,
): { pieces: THREE.BufferGeometry[]; added: number; diameter: number } {
  const o = { ...DEF, ...opts };
  const inside = makeInside(original);
  const WALL = 1.2; // material left around a socket so it doesn't blow out the side
  // A pin that doesn't fit isn't a reason to give up on registration — try smaller
  // ones before reporting none. A 5 mm peg has no business in a 12 mm-thick part,
  // but a 3 mm one holds it perfectly well.
  let r = o.diameter / 2;
  let depth = o.depth;
  let chosen: { pos: THREE.Vector3; axis: THREE.Vector3 }[] = [];
  for (const scale of [1, 0.65, 0.45]) {
    r = (o.diameter * scale) / 2;
    depth = Math.max(1.5, o.depth * scale);
    chosen = viableSites(sites, inside, depth + 1, r + WALL, o.maxPerFace, r * 4);
    if (chosen.length) break;
  }
  if (!chosen.length) return { pieces, added: 0, diameter: 0 };

  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  const out = pieces.map((g) => posOnly(g));
  // Which piece owns a point — the one whose surface contains it. Probed just off
  // the cut surface so a point exactly ON the kerf can't match both sides.
  const owner = (p: THREE.Vector3): number => {
    for (let i = 0; i < out.length; i++) {
      const test = makeInsideCached(out[i]);
      if (test(p)) return i;
    }
    return -1;
  };
  let added = 0;
  for (const site of chosen) {
    const probe = depth * 0.6 + 0.4;
    const iPeg = owner(site.pos.clone().addScaledVector(site.axis, -probe));
    const iSock = owner(site.pos.clone().addScaledVector(site.axis, probe));
    if (iPeg < 0 || iSock < 0 || iPeg === iSock) continue;
    // Peg: buried a little so it fuses to its own piece rather than floating on it.
    const peg = cylinder(site.pos, site.axis, r, -depth * 0.5, depth * 0.5 + depth);
    // Socket: wider by the print clearance, deeper by a hair so the peg bottoms out
    // on air rather than jamming before the faces meet.
    const sock = cylinder(site.pos, site.axis, r + o.clearance, -depth * 0.5, depth * 0.5 + depth + 0.4);
    const pegBrush = new Brush(peg, CSG_MAT); pegBrush.updateMatrixWorld(true);
    const sockBrush = new Brush(sock, CSG_MAT); sockBrush.updateMatrixWorld(true);
    const a = new Brush(out[iPeg], CSG_MAT); a.updateMatrixWorld(true);
    const b = new Brush(out[iSock], CSG_MAT); b.updateMatrixWorld(true);
    // Replacing the entries means the next owner() probe builds against the UPDATED
    // pieces — the cache is keyed by geometry object, so new geometry, new test.
    out[iPeg] = posOnly(evaluator.evaluate(a, pegBrush, ADDITION).geometry);
    out[iSock] = posOnly(evaluator.evaluate(b, sockBrush, SUBTRACTION).geometry);
    added++;
  }
  return { pieces: out, added, diameter: added ? r * 2 : 0 };
}

// Inside-tests are per-geometry and get hit once per candidate site; building the BVH
// each time made the site search quadratic on big meshes.
const insideCache = new WeakMap<THREE.BufferGeometry, (p: THREE.Vector3) => boolean>();
function makeInsideCached(g: THREE.BufferGeometry): (p: THREE.Vector3) => boolean {
  let f = insideCache.get(g);
  if (!f) { f = makeInside(g); insideCache.set(g, f); }
  return f;
}

/** Pin sites for a freehand cut: sample along the drawn line, at a few depths through
 *  the model, with the axis being the line's own normal at that point. */
export function strokeSites(stroke: CutStroke, box: THREE.Box3, step: number): { pos: THREE.Vector3; axis: THREE.Vector3 }[] {
  const dir = new THREE.Vector3(...stroke.viewDir).normalize();
  const world = stroke.pts.map((p) => new THREE.Vector3(...p));
  if (world.length < 2) return [];
  const diag = box.getSize(new THREE.Vector3()).length();
  const sites: { pos: THREE.Vector3; axis: THREE.Vector3 }[] = [];
  // Walk the polyline at `step` intervals; at each stop probe a few depths along the
  // view direction (the cut runs the whole way through, so pins can sit anywhere).
  const depths: number[] = [0];
  for (let d = step; d <= diag / 2; d += step) depths.push(d, -d);
  // Walk the polyline by ARC LENGTH. A hand-drawn stroke arrives as hundreds of
  // samples a fraction of a millimetre apart; carrying a per-segment offset across
  // segments shorter than the step drifted out of range and produced almost no
  // sites at all (pins then had "nowhere to go" on parts with plenty of room).
  let travelled = 0;
  let nextAt = 0;
  for (let i = 1; i < world.length; i++) {
    const seg = world[i].clone().sub(world[i - 1]);
    const segLen = seg.length();
    if (segLen < 1e-6) continue;
    const t = seg.clone().normalize();
    const n = new THREE.Vector3().crossVectors(dir, t).normalize();
    while (nextAt <= travelled + segLen) {
      const base = world[i - 1].clone().addScaledVector(t, nextAt - travelled);
      for (const d of depths) sites.push({ pos: base.clone().addScaledVector(dir, d), axis: n.clone() });
      nextAt += step;
    }
    travelled += segLen;
  }
  return sites;
}

/** Re-colour + re-merge pieces after connectors were added. */
export function repack(parts: THREE.BufferGeometry[]): CutResult {
  return finishPieces(parts.map(posOnly));
}
