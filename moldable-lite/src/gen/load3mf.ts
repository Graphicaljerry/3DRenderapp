// 3MF reader. This is the format MakerWorld, Printables and every Bambu/Orca export
// actually hand you — an STL download is the exception now, not the rule — so without
// this, "open the model I already have" fails on the most common file there is.
//
// A 3MF is a zip holding one XML model file. The parts that matter for geometry:
//
//   <model unit="millimeter">            units are DECLARED, unlike STL's bare numbers
//     <resources>
//       <object id="1"><mesh>
//         <vertices><vertex x="" y="" z=""/>…</vertices>
//         <triangles><triangle v1="" v2="" v3=""/>…</triangles>
//       </mesh></object>
//       <object id="2"><components>        an assembly: other objects, each posed
//         <component objectid="1" transform="…"/>
//       </components></object>
//     </resources>
//     <build><item objectid="2" transform="…"/></build>   what is actually on the plate
//   </model>
//
// Only what `<build>` places is real: a multi-part plate lists several items, and a
// resource nothing references is a spare part the file happens to carry. Reading the
// resources instead of the build is how a reader ends up showing pieces that were never
// meant to be on the plate.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MeshLoad } from "./loadMesh";

/** Millimetres per unit, for every unit 3MF allows. Files in the wild really do use
 *  `micron` (Bambu's internal exports) and `inch`, and getting this wrong is a model a
 *  thousand times too big rather than a subtly wrong one. */
const UNIT_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  meter: 1000,
  inch: 25.4,
  foot: 304.8,
};

/** True when these bytes are a 3MF — a zip whose model part is where 3MF puts it.
 *  Needed because a stored blob has lost its filename by the time it is re-read. */
export async function looksLike3MF(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (!(head[0] === 0x50 && head[1] === 0x4b)) return false; // not a zip at all
  try {
    const { unzipSync } = await import("fflate");
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    return !!modelPath(zip);
  } catch {
    return false;
  }
}

/** Where the model XML lives. Nearly always "3D/3dmodel.model", but the spec only
 *  promises that SOMETHING under 3D/ ends in .model, and producers do differ. */
function modelPath(zip: Record<string, Uint8Array>): string | null {
  if (zip["3D/3dmodel.model"]) return "3D/3dmodel.model";
  return Object.keys(zip).find((k) => /^3D\/.*\.model$/i.test(k)) ?? null;
}

/** 3MF writes a 4×3 matrix row-major and multiplies row-vectors by it, so the numbers
 *  land transposed from what THREE.Matrix4.set expects. Getting this backwards is the
 *  classic 3MF bug: single-object files look right (identity) and every assembly comes
 *  out scrambled. */
function parseTransform(s: string | null): THREE.Matrix4 | null {
  if (!s) return null;
  const n = s.trim().split(/\s+/).map(Number);
  if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return null;
  return new THREE.Matrix4().set(
    n[0], n[3], n[6], n[9],
    n[1], n[4], n[7], n[10],
    n[2], n[5], n[8], n[11],
    0, 0, 0, 1,
  );
}

interface Res {
  mesh?: { pos: Float32Array };
  parts?: { id: string; xf: THREE.Matrix4 | null }[];
}

/** Read a 3MF into one geometry in the app's convention: millimetres, centred on the
 *  plate, sitting on Z=0 — the same shape the STL and GLB loaders hand back, so an
 *  imported MakerWorld model flows through measuring, printability, cutting, text,
 *  fasteners and export without any of them knowing where it came from. */
export async function threeMfToGeometry(blob: Blob): Promise<MeshLoad & { itemCount: number }> {
  const { unzipSync } = await import("fflate");
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const path = modelPath(zip);
  if (!path) throw new Error("that .3mf has no model inside it (the zip is missing 3D/3dmodel.model)");
  const xml = new TextDecoder().decode(zip[path]);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("the model inside that .3mf isn't readable XML");

  const model = doc.documentElement;
  const scale = UNIT_MM[(model.getAttribute("unit") ?? "millimeter").toLowerCase()] ?? 1;

  // Every resource, mesh and assembly alike, indexed by id.
  const res = new Map<string, Res>();
  for (const o of Array.from(doc.getElementsByTagName("object"))) {
    const id = o.getAttribute("id");
    if (!id) continue;
    const comps = o.getElementsByTagName("component");
    if (comps.length) {
      res.set(id, {
        parts: Array.from(comps).flatMap((c) => {
          const oid = c.getAttribute("objectid");
          return oid ? [{ id: oid, xf: parseTransform(c.getAttribute("transform")) }] : [];
        }),
      });
      continue;
    }
    const vs = o.getElementsByTagName("vertex");
    const ts = o.getElementsByTagName("triangle");
    if (!vs.length || !ts.length) continue;
    // Non-indexed from the start: everything downstream (BVH picking, per-face paint,
    // the 3MF writer) works on flat triangle soup, and converting later costs a copy.
    const vx = new Float32Array(vs.length * 3);
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      vx[i * 3] = Number(v.getAttribute("x")) * scale;
      vx[i * 3 + 1] = Number(v.getAttribute("y")) * scale;
      vx[i * 3 + 2] = Number(v.getAttribute("z")) * scale;
    }
    const pos = new Float32Array(ts.length * 9);
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const idx = [Number(t.getAttribute("v1")), Number(t.getAttribute("v2")), Number(t.getAttribute("v3"))];
      for (let k = 0; k < 3; k++) {
        const j = idx[k] * 3;
        pos[i * 9 + k * 3] = vx[j];
        pos[i * 9 + k * 3 + 1] = vx[j + 1];
        pos[i * 9 + k * 3 + 2] = vx[j + 2];
      }
    }
    res.set(id, { mesh: { pos } });
  }

  // Walk the build. Assemblies nest, so this recurses — with a depth cap, because a
  // malformed file can reference itself and a browser tab that hangs on an import is
  // worse than one that says the file is broken.
  const out: THREE.BufferGeometry[] = [];
  const emit = (id: string, xf: THREE.Matrix4 | null, depth: number) => {
    if (depth > 12) return;
    const r = res.get(id);
    if (!r) return;
    if (r.mesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(r.mesh.pos.slice(), 3));
      if (xf) g.applyMatrix4(xf);
      out.push(g);
      return;
    }
    for (const p of r.parts ?? []) {
      const next = p.xf ? (xf ? xf.clone().multiply(p.xf) : p.xf.clone()) : xf;
      emit(p.id, next, depth + 1);
    }
  };
  const items = Array.from(doc.getElementsByTagName("item"));
  for (const it of items) {
    const oid = it.getAttribute("objectid");
    if (oid) emit(oid, parseTransform(it.getAttribute("transform")), 0);
  }
  // A file with no <build> is legal-ish and does happen; falling back to every mesh
  // resource beats refusing to open it.
  if (!out.length) for (const [id, r] of res) if (r.mesh) emit(id, null, 0);
  if (!out.length) throw new Error("that .3mf has no printable geometry in it");

  const merged = out.length === 1 ? out[0] : mergeGeometries(out, false);
  if (!merged) throw new Error("that .3mf has parts this reader can't combine");
  if (out.length > 1) for (const g of out) g.dispose();

  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  merged.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  const size = new THREE.Vector3();
  merged.boundingBox!.getSize(size);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { geometry: merged, dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) }, itemCount: out.length };
}

/** The same triangles as a binary STL, so a 3MF can take the STL route into the CAD
 *  kernel and come out an editable solid — which is the difference between "I can look
 *  at my MakerWorld model" and "I can tell the AI to put two M4 holes in it". */
export function geometryToStl(g: THREE.BufferGeometry): Blob {
  const pos = g.getAttribute("position");
  const tris = pos.count / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  let o = 84;
  for (let i = 0; i < tris; i++) {
    a.fromBufferAttribute(pos as THREE.BufferAttribute, i * 3);
    b.fromBufferAttribute(pos as THREE.BufferAttribute, i * 3 + 1);
    c.fromBufferAttribute(pos as THREE.BufferAttribute, i * 3 + 2);
    n.copy(ab.subVectors(b, a).cross(ac.subVectors(c, a))).normalize();
    dv.setFloat32(o, n.x, true); dv.setFloat32(o + 4, n.y, true); dv.setFloat32(o + 8, n.z, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Blob([buf], { type: "model/stl" });
}
