// DEV-only pipeline probe: every import here is resolved by Vite, so bare specifiers
// (wawoff2, opentype.js) behave exactly as they will in the shipped bundle.
import { loadGoogleFont } from "./fonts";
import { buildTextGeometry, TEXT_DEFAULT } from "./geometry";

export async function selftest(family = "Bebas Neue", text = "MOLD") {
  const log: string[] = [];
  const t0 = performance.now();
  const font = await loadGoogleFont(family);
  log.push(`font ${Math.round(performance.now() - t0)}ms glyphs=${font.glyphs.length}`);
  const t1 = performance.now();
  const g = buildTextGeometry(font, { ...TEXT_DEFAULT, text, size: 12, depth: 3, bevel: 0.4 });
  log.push(`geom ${Math.round(performance.now() - t1)}ms`);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const t2 = performance.now();
  buildTextGeometry(await loadGoogleFont(family), { ...TEXT_DEFAULT, text, size: 12, depth: 3, bevel: 0 });
  log.push(`rebuild(cached font) ${Math.round(performance.now() - t2)}ms`);
  return {
    log,
    verts: g.getAttribute("position").count,
    size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map((n) => +n.toFixed(2)),
    minZ: +bb.min.z.toFixed(3),
    centredX: +((bb.min.x + bb.max.x) / 2).toFixed(3),
  };
}
