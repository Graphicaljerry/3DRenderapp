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

/** Ordered filament palette (slot 1..N) + a colour→slot lookup for a set of parts. */
function buildFilaments(parts: { color?: string }[]): { palette: string[]; slotOf: (c?: string) => number; painted: boolean } {
  const anyUnpainted = parts.some((p) => !normHex(p.color));
  const slot = new Map<string, number>();
  const palette: string[] = [];
  if (anyUnpainted) { palette.push(DEFAULT_FILAMENT); slot.set("", 1); } // slot 1 = default filament
  for (const p of parts) {
    const c = normHex(p.color);
    if (!c || slot.has(c)) continue;
    palette.push(c);
    slot.set(c, palette.length);
  }
  const distinctPainted = palette.length - (anyUnpainted ? 1 : 0);
  return { palette, slotOf: (c?: string) => slot.get(normHex(c)) ?? 1, painted: distinctPainted > 0 };
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

/** Minimal core-3MF (OPC zip). Carries mm units, unlike STL. */
/** Several positioned solids → ONE 3MF with a real <object> per part, named — slicers
 *  (Bambu/Orca/Prusa) list them separately for arranging, painting, per-part settings.
 *  A painted part carries its colour as a core-3MF base material (displaycolor), so any
 *  conformant reader shows it in the right colour. */
export function geometriesTo3MF(parts: { geometry: THREE.BufferGeometry; name: string; color?: string }[]): Blob {
  const { palette, slotOf, painted } = buildFilaments(parts);
  const objects: string[] = [];
  const items: string[] = [];
  // A single <basematerials> resource holds the palette; objects point at it by pindex.
  const MAT_ID = parts.length + 1;
  parts.forEach((part, pi) => {
    const g = part.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const idx = g.index;
    const verts: string[] = [];
    for (let i = 0; i < pos.count; i++) verts.push(`<vertex x="${f(pos.getX(i))}" y="${f(pos.getY(i))}" z="${f(pos.getZ(i))}"/>`);
    const tris: string[] = [];
    if (idx) for (let i = 0; i < idx.count; i += 3) tris.push(`<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"/>`);
    else for (let i = 0; i < pos.count; i += 3) tris.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
    const id = pi + 1;
    const safe = part.name.replace(/[<>&"]/g, "_");
    const matAttr = painted ? ` pid="${MAT_ID}" pindex="${slotOf(part.color) - 1}"` : "";
    objects.push(`<object id="${id}" type="model" name="${safe}"${matAttr}><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
  });
  const baseMats = painted
    ? `<basematerials id="${MAT_ID}">${palette.map((c, i) => `<base name="Filament ${i + 1}" displaycolor="${c}FF"/>`).join("")}</basematerials>`
    : "";
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>${baseMats}${objects.join("")}</resources>
 <build>${items.join("")}</build>
</model>`;
  return zip3mf(model);
}

/** One multi-plate PROJECT 3MF that Bambu Studio / OrcaSlicer open with the plates
 *  intact — the closest thing to handing the slicer your whole plate layout at once.
 *
 *  How it works (the Bambu/Orca project dialect of 3MF):
 *  - `Metadata/model_settings.config` declares every <plate> (plater_id) and maps each
 *    object onto one via <model_instance>; an <assemble> section restates placements.
 *  - The slicer only parses that config when the root model carries BambuStudio
 *    application metadata — without it, it falls back to "geometry only".
 *  - Plates live side by side in world coords (a row along +X, one bed-width apart plus
 *    a logical gap), so even a strict positional reader lands parts on the right plate.
 *  Parts keep their relative placement per plate; each plate's group is centred on its
 *  bed and dropped to z=0. */
export function platesToProject3MF(
  parts: { geometry: THREE.BufferGeometry; name: string; plate: number; color?: string }[],
  plateCount: number,
  bed: { x: number; y: number },
  plateNames?: Record<number, string>,
): Blob {
  const { palette, slotOf, painted } = buildFilaments(parts);
  const stride = bed.x * 1.2;
  // Per-plate group bounds → one shared translation per plate (relative layout survives).
  const groups = new Map<number, { min: THREE.Vector3; max: THREE.Vector3 }>();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const bb = part.geometry.boundingBox!;
    const g = groups.get(part.plate);
    if (!g) groups.set(part.plate, { min: bb.min.clone(), max: bb.max.clone() });
    else {
      g.min.min(bb.min);
      g.max.max(bb.max);
    }
  }
  const shift = (plate: number): [number, number, number] => {
    const g = groups.get(plate)!;
    return [
      (plate - 1) * stride + bed.x / 2 - (g.min.x + g.max.x) / 2,
      bed.y / 2 - (g.min.y + g.max.y) / 2,
      -g.min.z,
    ];
  };

  const objects: string[] = [];
  const items: string[] = [];
  const settingsObjects: string[] = [];
  const assembleItems: string[] = [];
  const instancesByPlate = new Map<number, string[]>();
  parts.forEach((part, pi) => {
    const g = part.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const idx = g.index;
    const verts: string[] = [];
    for (let i = 0; i < pos.count; i++) verts.push(`<vertex x="${f(pos.getX(i))}" y="${f(pos.getY(i))}" z="${f(pos.getZ(i))}"/>`);
    const tris: string[] = [];
    if (idx) for (let i = 0; i < idx.count; i += 3) tris.push(`<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"/>`);
    else for (let i = 0; i < pos.count; i += 3) tris.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
    const id = pi + 1;
    const safe = part.name.replace(/[<>&"]/g, "_");
    const [tx, ty, tz] = shift(part.plate);
    const transform = `1 0 0 0 1 0 0 0 1 ${f(tx)} ${f(ty)} ${f(tz)}`;
    objects.push(`<object id="${id}" type="model" name="${safe}"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}" transform="${transform}" printable="1"/>`);
    const ex = slotOf(part.color); // filament slot this painted part prints on (1 = default)
    settingsObjects.push(
      `  <object id="${id}">\n    <metadata key="name" value="${safe}"/>\n    <metadata key="extruder" value="${ex}"/>\n    <part id="1" subtype="normal_part">\n      <metadata key="name" value="${safe}"/>\n      <metadata key="extruder" value="${ex}"/>\n    </part>\n  </object>`,
    );
    if (!instancesByPlate.has(part.plate)) instancesByPlate.set(part.plate, []);
    instancesByPlate.get(part.plate)!.push(
      `    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${100 + id}"/>\n    </model_instance>`,
    );
    assembleItems.push(`   <assemble_item object_id="${id}" instance_id="0" transform="${transform}" offset="0 0 0" />`);
  });

  // Every plate the user created is declared — empty ones included, so the layout round-trips.
  const plateBlocks: string[] = [];
  for (let n = 1; n <= Math.max(plateCount, ...parts.map((x) => x.plate)); n++) {
    const label = (plateNames?.[n] ?? "").replace(/[<>&"]/g, "_");
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

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">BambuStudio-01.10.01.50</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Moldable multi-plate project</metadata>
 <resources>${objects.join("")}</resources>
 <build>${items.join("")}</build>
</model>`;
  const extras: Record<string, string> = { "Metadata/model_settings.config": modelSettings };
  // Painted parts → hand Bambu/Orca the exact filament colours so the AMS slots open
  // pre-loaded, and each object is already assigned to its slot via the extruder above.
  if (painted) extras["Metadata/project_settings.config"] = projectSettingsConfig(palette);
  return zip3mf(model, extras);
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

export function geometryTo3MF(geometry: THREE.BufferGeometry): Blob {
  const g = geometry.index ? geometry : geometry.clone();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const idx = g.index;

  const verts: string[] = [];
  for (let i = 0; i < pos.count; i++) {
    verts.push(
      `<vertex x="${f(pos.getX(i))}" y="${f(pos.getY(i))}" z="${f(pos.getZ(i))}"/>`,
    );
  }
  const tris: string[] = [];
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      tris.push(`<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"/>`);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      tris.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
    }
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>${verts.join("")}</vertices>
    <triangles>${tris.join("")}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
  return new Blob([zipped as unknown as BlobPart], { type: "model/3mf" });
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Bundle several already-exported model files into one .zip (for "export each piece
 *  as a separate STL/3MF"). Keys are the in-zip filenames. */
export async function zipModelFiles(files: Record<string, Blob>): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, blob] of Object.entries(files)) entries[name] = new Uint8Array(await blob.arrayBuffer());
  return new Blob([zipSync(entries) as unknown as BlobPart], { type: "application/zip" });
}
