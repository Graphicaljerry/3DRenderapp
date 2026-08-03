import * as THREE from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { zipSync, strToU8 } from "fflate";
import { meshOf } from "./stl";

// Our geometry is authored Z-up in millimetres (matching slicers), so NO
// reorientation is applied on export.
//
// This module is loaded on demand (export menus / engine.export are async) so
// fflate + the exporters stay out of the first-load bundle. STL serialization
// lives in ./stl — it runs on every mesh commit, so it stays eager.

export { geometryToSTL } from "./stl";

export function geometryToOBJ(geometry: THREE.BufferGeometry): Blob {
  const text = new OBJExporter().parse(meshOf(geometry));
  return new Blob([text], { type: "model/obj" });
}

// ---- Per-part colour → filament mapping ----------------------------------------
// A part the user painted in the Objects panel carries a hex colour. On export, every
// DISTINCT colour becomes one filament slot (1-based). Unpainted parts share a neutral
// default filament so a painted part never accidentally inherits another part's colour.
// Bambu Studio / OrcaSlicer read the per-object extruder (project 3MF) or the object's
// base material (core 3MF) to pre-assign each part to the matching filament.
const DEFAULT_FILAMENT = "#D9D9D9"; // neutral gray for anything left unpainted

/** Normalise a hex colour to upper-case #RRGGBB, or "" if absent/invalid. */
function normHex(c?: string): string {
  if (!c) return "";
  const m = /^#?([0-9a-fA-F]{6})$/.exec(c.trim());
  return m ? `#${m[1].toUpperCase()}` : "";
}

/** Ordered filament palette (slot 1..N) + a colour→slot lookup for a set of parts.
 *  Whole-part colours are folded FIRST (so existing per-part slot numbering is stable),
 *  then any per-face PAINT palette colours join the SAME palette — a painted-red region
 *  and a whole-red part resolve to the identical filament slot (keyed on normalised hex). */
function buildFilaments(parts: { color?: string; paintPalette?: string[] }[]): { palette: string[]; slotOf: (c?: string) => number; painted: boolean } {
  const anyUnpainted = parts.some((p) => !normHex(p.color));
  const slot = new Map<string, number>();
  const palette: string[] = [];
  if (anyUnpainted) { palette.push(DEFAULT_FILAMENT); slot.set("", 1); } // slot 1 = default filament
  const add = (raw?: string) => { const c = normHex(raw); if (!c || slot.has(c)) return; palette.push(c); slot.set(c, palette.length); };
  for (const p of parts) add(p.color);                              // whole-part colours first
  for (const p of parts) for (const c of p.paintPalette ?? []) add(c); // then painted-region colours
  const distinctPainted = palette.length - (anyUnpainted ? 1 : 0);
  return { palette, slotOf: (c?: string) => slot.get(normHex(c)) ?? 1, painted: distinctPainted > 0 };
}

/** Bambu/Orca per-triangle MMU paint code for a WHOLE (unsplit) triangle painted the
 *  1-indexed filament slot `slot` (slot == the AMS slot shown in Bambu's palette, no
 *  offset). Returns "" for slot ≤ 0 → the exporter then writes NO paint_color attribute,
 *  so the triangle falls back to the object's base extruder.
 *
 *  Encoding (verified against BambuStudio TriangleSelector::serialize + Model.cpp
 *  get_triangle_as_string): a leaf triangle's segmentation bitstream is emitted then read
 *  back 4 bits at a time with each hex nibble PREPENDED, so the string is reversed vs
 *  emission (root nibble = rightmost char). Whole-triangle cases:
 *    slot 1 → "4", slot 2 → "8", slot K≥3 → hex(K−3) + "C"  (e.g. 3→"0C", 4→"1C", 18→"0FC").
 *  Writing "C0" instead of "0C" decodes as a split node → garbage, so order matters. */
export function encodePaintColorWhole(slot: number): string {
  if (slot <= 0) return "";
  if (slot === 1) return "4"; // leaf state 1: bits 0,0,1,0 → nibble 0b0100
  if (slot === 2) return "8"; // leaf state 2: bits 0,0,0,1 → nibble 0b1000
  // leaf state n≥3: marker nibble 0xC, then the prefix code of (n−3); string is reversed,
  // so it reads as <remainder-nibble><F…F><C>.
  let v = slot - 3;
  let prefix = "";
  while (v >= 15) { prefix = "F" + prefix; v -= 15; }
  prefix = v.toString(16).toUpperCase() + prefix;
  return prefix + "C";
}

/** Bambu/Orca project filament settings — the file the slicer reads to show the AMS
 *  slots pre-loaded with the exact colours the user painted. Parallel arrays, one entry
 *  per slot; we fill the print-relevant ones and let the slicer default the rest. */
function projectSettingsConfig(palette: string[]): string {
  const n = palette.length;
  const rep = <T,>(v: T) => Array.from({ length: n }, () => v);
  return JSON.stringify({
    filament_colour: palette,
    filament_type: rep("PLA"),
    filament_settings_id: rep("Generic PLA"),
    filament_ids: rep("GFL99"),
    version: "01.10.01.50",
    from: "Moldable",
  }, null, 1);
}

/** One solid on its way into a 3MF. Everything except the geometry is optional, so a
 *  bare mesh and a painted, named, plated part go through the same writer. */
export interface Solid3MF {
  geometry: THREE.BufferGeometry;
  name?: string;
  /** Whole-part colour → the object's filament slot. */
  color?: string;
  /** Per-triangle paint: 1-based index into `paintPalette`, 0 = unpainted. */
  paint?: Uint8Array;
  paintPalette?: string[];
  /** Which build plate this belongs on. Absent = the only plate. */
  plate?: number;
}

export interface Write3MFOpts {
  /** Declare this many plates even when some are empty, so the layout round-trips. */
  plateCount?: number;
  /** Bed size. Supplying it turns on the side-by-side plate layout; without it, parts
   *  are written where they already are. */
  bed?: { x: number; y: number };
  plateNames?: Record<number, string>;
  /** Document title in the slicer's file info. */
  title?: string;
}

/**
 * THE 3MF writer. Every export in the app comes through here, because the alternative
 * — a "simple" writer beside a "full" one — is how object names, part colours and
 * per-face paint quietly disappeared from ordinary single-model exports.
 *
 * What one file carries:
 *  - a real named <object> per solid, so slicers list them separately for arranging,
 *    painting and per-part settings;
 *  - the palette as core-3MF <basematerials> with displaycolor, which ANY conformant
 *    reader (PrusaSlicer, Cura, Windows 3D Viewer) uses to show the right colours;
 *  - the Bambu/Orca project dialect on top: `Metadata/model_settings.config` names each
 *    object and pins it to a filament slot, per-triangle `paint_color` carries MMU
 *    painting, and `project_settings.config` pre-loads the AMS with the exact colours.
 *    The slicer only parses that config when the root model carries BambuStudio
 *    application metadata, so it is always emitted.
 *  - plates, when a bed is given: `<plate>` blocks map objects onto plater_ids, AND the
 *    plates are laid out side by side in world coordinates one bed-width apart, so even
 *    a reader that ignores the config lands each part on the right plate. Each plate's
 *    group is centred on the bed and dropped to z = 0; relative placement within a plate
 *    survives.
 */
export function write3MF(solids: Solid3MF[], opts: Write3MFOpts = {}): Blob {
  const { palette, slotOf, painted } = buildFilaments(solids);
  const plateOf = (s: Solid3MF) => s.plate ?? 1;
  const laidOut = !!opts.bed;

  // Per-plate group bounds → one shared translation per plate.
  const shift = (() => {
    if (!opts.bed) return () => [0, 0, 0] as [number, number, number];
    const bed = opts.bed;
    const stride = bed.x * 1.2;
    const groups = new Map<number, { min: THREE.Vector3; max: THREE.Vector3 }>();
    for (const s of solids) {
      s.geometry.computeBoundingBox();
      const bb = s.geometry.boundingBox!;
      const g = groups.get(plateOf(s));
      if (!g) groups.set(plateOf(s), { min: bb.min.clone(), max: bb.max.clone() });
      else { g.min.min(bb.min); g.max.max(bb.max); }
    }
    return (plate: number): [number, number, number] => {
      const g = groups.get(plate)!;
      return [
        (plate - 1) * stride + bed.x / 2 - (g.min.x + g.max.x) / 2,
        bed.y / 2 - (g.min.y + g.max.y) / 2,
        -g.min.z,
      ];
    };
  })();

  const objects: string[] = [];
  const items: string[] = [];
  const settingsObjects: string[] = [];
  const assembleItems: string[] = [];
  const instancesByPlate = new Map<number, string[]>();
  // A single <basematerials> resource holds the palette; objects point at it by pindex.
  const MAT_ID = solids.length + 1;

  solids.forEach((part, pi) => {
    const g = part.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const idx = g.index;
    const verts: string[] = [];
    for (let i = 0; i < pos.count; i++) verts.push(`<vertex x="${f(pos.getX(i))}" y="${f(pos.getY(i))}" z="${f(pos.getZ(i))}"/>`);
    const ex = slotOf(part.color); // object's base filament slot (1 = default); triangles fall back to it
    // Per-face MMU paint: triangle t → paint palette index part.paint[t] (0 = unpainted) →
    // that palette colour's filament slot → Bambu's paint_color code. paint_color binds
    // POSITIONALLY to triangle document order, so the paint index MUST use the same t as
    // the emitted <triangle> order (idx-driven or non-indexed — both step t by one triangle).
    const paint = part.paint, pal = part.paintPalette;
    const paintAttr = (t: number): string => {
      if (!paint || !pal) return "";
      const pi2 = paint[t]; // 1-based index into the paint palette, 0 = unpainted
      if (!pi2) return "";
      const s = slotOf(pal[pi2 - 1]);
      return s && s !== ex ? ` paint_color="${encodePaintColorWhole(s)}"` : "";
    };
    const tris: string[] = [];
    if (idx) { let t = 0; for (let i = 0; i < idx.count; i += 3, t++) tris.push(`<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"${paintAttr(t)}/>`); }
    else { let t = 0; for (let i = 0; i < pos.count; i += 3, t++) tris.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"${paintAttr(t)}/>`); }

    const id = pi + 1;
    const plate = plateOf(part);
    const safe = xml(part.name ?? `Part ${id}`);
    const matAttr = painted ? ` pid="${MAT_ID}" pindex="${ex - 1}"` : "";
    const [tx, ty, tz] = shift(plate);
    const transform = `1 0 0 0 1 0 0 0 1 ${f(tx)} ${f(ty)} ${f(tz)}`;
    objects.push(`<object id="${id}" type="model" name="${safe}"${matAttr}><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(laidOut ? `<item objectid="${id}" transform="${transform}" printable="1"/>` : `<item objectid="${id}" printable="1"/>`);
    settingsObjects.push(
      `  <object id="${id}">\n    <metadata key="name" value="${safe}"/>\n    <metadata key="extruder" value="${ex}"/>\n    <part id="1" subtype="normal_part">\n      <metadata key="name" value="${safe}"/>\n      <metadata key="extruder" value="${ex}"/>\n    </part>\n  </object>`,
    );
    if (!instancesByPlate.has(plate)) instancesByPlate.set(plate, []);
    instancesByPlate.get(plate)!.push(
      `    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${100 + id}"/>\n    </model_instance>`,
    );
    assembleItems.push(`   <assemble_item object_id="${id}" instance_id="0" transform="${transform}" offset="0 0 0" />`);
  });

  // Every plate the user created is declared — empty ones included, so the layout round-trips.
  const plateBlocks: string[] = [];
  const lastPlate = Math.max(opts.plateCount ?? 1, ...solids.map(plateOf));
  for (let n = 1; n <= lastPlate; n++) {
    const label = xml(opts.plateNames?.[n] ?? "");
    plateBlocks.push(
      `  <plate>\n    <metadata key="plater_id" value="${n}"/>\n    <metadata key="plater_name" value="${label}"/>\n    <metadata key="locked" value="false"/>\n${(instancesByPlate.get(n) ?? []).join("\n")}\n  </plate>`,
    );
  }
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${settingsObjects.join("\n")}
${plateBlocks.join("\n")}
  <assemble>
${assembleItems.join("\n")}
  </assemble>
</config>`;

  const baseMats = painted
    ? `<basematerials id="${MAT_ID}">${palette.map((c, i) => `<base name="Filament ${i + 1}" displaycolor="${c}FF"/>`).join("")}</basematerials>`
    : "";
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">BambuStudio-01.10.01.50</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${xml(opts.title ?? "Moldable model")}</metadata>
 <resources>${baseMats}${objects.join("")}</resources>
 <build>${items.join("")}</build>
</model>`;
  const extras: Record<string, string> = { "Metadata/model_settings.config": modelSettings };
  // Painted parts → hand Bambu/Orca the exact filament colours so the AMS slots open
  // pre-loaded, and each object is already assigned to its slot via the extruder above.
  if (painted) extras["Metadata/project_settings.config"] = projectSettingsConfig(palette);
  return zip3mf(model, extras);
}

/** One multi-plate PROJECT 3MF that Bambu Studio / OrcaSlicer open with the plates
 *  intact — the closest thing to handing the slicer your whole plate layout at once. */
export function platesToProject3MF(
  parts: Solid3MF[],
  plateCount: number,
  bed: { x: number; y: number },
  plateNames?: Record<number, string>,
): Blob {
  return write3MF(parts, { plateCount, bed, plateNames, title: "Moldable multi-plate project" });
}

function zip3mf(model: string, extras?: Record<string, string>): Blob {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  };
  for (const [path, text] of Object.entries(extras ?? {})) files[path] = strToU8(text);
  const zipped = zipSync(files);
  return new Blob([zipped as unknown as BlobPart], { type: "model/3mf" });
}

/** A single solid. Still goes through write3MF, so a plain export is not a poorer file
 *  than a plate export — it just has one object on one plate. */
export function geometryTo3MF(geometry: THREE.BufferGeometry, about?: Omit<Solid3MF, "geometry" | "plate">): Blob {
  return write3MF([{ geometry, ...about }], { title: about?.name });
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
/** XML attribute text. Names come from project titles the user typed. */
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));

/** Bundle several already-exported model files into one .zip (for "export each piece
 *  as a separate STL/3MF"). Keys are the in-zip filenames. */
export async function zipModelFiles(files: Record<string, Blob>): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, blob] of Object.entries(files)) entries[name] = new Uint8Array(await blob.arrayBuffer());
  return new Blob([zipSync(entries) as unknown as BlobPart], { type: "application/zip" });
}
