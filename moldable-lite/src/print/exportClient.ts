import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { zipSync, strToU8 } from "fflate";

// Our geometry is authored Z-up in millimetres (matching slicers), so NO
// reorientation is applied on export.

function meshOf(geometry: THREE.BufferGeometry): THREE.Mesh {
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

export function geometryToSTL(geometry: THREE.BufferGeometry): Blob {
  const dv = new STLExporter().parse(meshOf(geometry), { binary: true }) as unknown as DataView;
  return new Blob([dv as unknown as BlobPart], { type: "model/stl" });
}

export function geometryToOBJ(geometry: THREE.BufferGeometry): Blob {
  const text = new OBJExporter().parse(meshOf(geometry));
  return new Blob([text], { type: "model/obj" });
}

/** Minimal core-3MF (OPC zip). Carries mm units, unlike STL. */
/** Several positioned solids → ONE 3MF with a real <object> per part, named — slicers
 *  (Bambu/Orca/Prusa) list them separately for arranging, painting, per-part settings. */
export function geometriesTo3MF(parts: { geometry: THREE.BufferGeometry; name: string }[]): Blob {
  const objects: string[] = [];
  const items: string[] = [];
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
    objects.push(`<object id="${id}" type="model" name="${safe}"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>${objects.join("")}</resources>
 <build>${items.join("")}</build>
</model>`;
  return zip3mf(model);
}

function zip3mf(model: string): Blob {
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
