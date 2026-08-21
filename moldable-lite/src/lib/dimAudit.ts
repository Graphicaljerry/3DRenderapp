// Did the build honour the sizes the user actually typed?
//
// The build loop can only detect a thrown kernel error. A program that builds cleanly at
// 50 mm when the request said 60 was accepted, stamped as a version, and reported in the
// same confident tone as a correct one — the exact failure that costs the most trust,
// because the reader finds out from a print that doesn't fit. This audit closes the gap
// for the figures we can know: explicit dimensions written in the request (and in an
// approved plan, whose text rides in the request on the plan path).
//
// It is a CAUTION, not a gate. A figure counts as honoured if it shows up in the overall
// size, in a defaultParams value, or as a literal in the program (a hole spacing is real
// but is neither a bounding-box axis nor always a parameter). Only a number that appears
// NOWHERE is worth interrupting the user's flow over — a soft check that is right beats
// a strict one that cries wolf on every clearance figure.

import { extractParams } from "../cad/params";

/** Explicit lengths in the text, normalised to mm. "60 mm", "6cm", '2.5 in', 2" — the
 *  units people actually type. Bare numbers are NOT dimensions ("make 3 holes"). */
export function requestedMm(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|in\b|inch(?:es)?|")/gi;
  // A RELATIVE figure is a delta, not a target — "10 mm wider" means +10, and 10 will
  // rightly appear nowhere in the result. The -er suffix is the whole distinction:
  // "2 mm thick" is checkable, "2 mm thicker" is not.
  const REL_AFTER = /^\s*(?:wider|narrower|taller|shorter|longer|thicker|thinner|deeper|shallower|higher|lower|bigger|smaller|larger|more|less|extra|closer|further|apart from)\b/i;
  const REL_BEFORE = /\b(?:by|another|add|remove|grow|shrink|extend|reduce|widen|raise|lower|deepen|thicken)\s*$/i;
  const toMm = (v: number, u: string) => (u.startsWith("c") ? v * 10 : u.startsWith("i") || u === '"' ? v * 25.4 : v);
  // Dimension CHAINS first: in "30 x 20 x 5 mm" the one trailing unit belongs to every
  // member, and reading only the 5 made the receipt confirm a third of what was asked.
  const chain = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|in\b|inch(?:es)?|")/gi;
  const claimed: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = chain.exec(text))) {
    claimed.push([m.index, m.index + m[0].length]);
    for (const g of [m[1], m[2], m[3]]) {
      const v = parseFloat(g ?? "");
      if (Number.isFinite(v) && v > 0) out.push(toMm(v, m[4].toLowerCase()));
    }
  }
  while ((m = re.exec(text))) {
    if (claimed.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    const v = parseFloat(m[1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (REL_AFTER.test(text.slice(m.index + m[0].length)) || REL_BEFORE.test(text.slice(0, m.index))) continue;
    out.push(toMm(v, m[2].toLowerCase()));
  }
  return [...new Set(out.map((v) => Math.round(v * 1000) / 1000))];
}

/** null = every requested figure is accounted for (or none were given);
 *  otherwise one sentence naming what is missing, ready to append to the reply. */
export function dimensionAudit(
  requestText: string,
  dims: { x: number; y: number; z: number },
  code: string,
): string | null {
  const asked = requestedMm(requestText);
  if (!asked.length) return null;

  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.2, a * 0.01);
  const sizes = [dims.x, dims.y, dims.z];
  const params = Object.values(extractParams(code) ?? {});
  // Literals last: the weakest evidence, but a real hole spacing lives here. Comments
  // are stripped first so a figure that only survives as prose doesn't count.
  const bare = code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const literals = (bare.match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);

  const missing = asked.filter(
    (v) => ![...sizes, ...params].some((h) => near(v, h)) && !literals.some((h) => near(v, Math.abs(h))),
  );
  if (!missing.length) return null;
  const list = missing
    .slice(0, 3)
    .map((v) => `${Math.round(v * 100) / 100} mm`)
    .join(", ");
  return `⚠ You asked for ${list} and I don't see ${missing.length === 1 ? "it" : "those"} anywhere in the result — check the size before printing, or tell me to fix it.`;
}
