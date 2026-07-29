/* Plate art: the part profiles the launchpad backdrop prints, and the toolpath maths
   that turns one into perimeter + infill moves. Pure geometry, no React and no canvas —
   split out of App.tsx so it can be unit-tested directly (a self-crossing inner wall is
   invisible in a screenshot until someone notices the tail). */

const GEAR: [number, number][] = (() => {
  const pts: [number, number][] = [];
  const TEETH = 12, RO = 0.30, RI = 0.24;
  for (let i = 0; i < TEETH; i++) {
    const a0 = (i / TEETH) * Math.PI * 2;
    const step = (Math.PI * 2) / TEETH / 4;
    for (const [k, r] of [[0, RI], [1, RO], [2, RO], [3, RI]] as [number, number][]) {
      const a = a0 + k * step;
      pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
    }
  }
  return pts;
})();

const NAME_TEXT = "JERRY";
// Per letter: bars on a 0..3 x 0..5 grid, [x0,y0,x1,y1].
const GLYPHS: Record<string, [number, number, number, number][]> = {
  // Grid Y is UP (by=0 is the baseline, by=5 the cap height) because the renderer maps
  // y1 - by*sy. The hook was written at by 3..5, which put it at the CAP — an upside-down
  // J. It belongs on the baseline.
  J: [[2, 1, 3, 5], [0, 0, 3, 1], [0, 1, 1, 2]],
  E: [[0, 0, 1, 5], [1, 0, 3, 1], [1, 2, 2.6, 3], [1, 4, 3, 5]],
  R: [[0, 0, 1, 5], [1, 4, 2.6, 5], [2, 3, 3, 4], [1, 2, 2.6, 3], [2, 0, 3, 2]],
  Y: [[0, 4, 1, 5], [0.6, 3, 1.6, 4], [1.4, 3, 2.4, 4], [2, 4, 3, 5], [1.2, 0, 2, 3]],
};
const NAMEPLATE: [number, number][] = (() => {
  // The plate outline only — the letter bars ride on top as extra closed loops that
  // buildToolpath() walks after it (see NAME_BARS).
  // Shifted right of 0.40: the backdrop fades out under the text column, and a plate
  // starting at 0.14 put the J in the faded band where it was barely legible.
  return [[.40, .38], [.97, .38], [.97, .62], [.40, .62]] as [number, number][];
})();
/** Letter bars for the nameplate, in plate-normalised coords. */
const NAME_BARS: [number, number][][] = (() => {
  const letters = NAME_TEXT.split("");
  const CW = 3, GAP = 1;                       // glyph width + spacing, in grid units
  const totalW = letters.length * CW + (letters.length - 1) * GAP;
  const x0 = 0.435, x1 = 0.935, y0 = 0.415, y1 = 0.585;
  const sx = (x1 - x0) / totalW, sy = (y1 - y0) / 5;
  const out: [number, number][][] = [];
  letters.forEach((ch, i) => {
    const ox = i * (CW + GAP);
    for (const [bx0, by0, bx1, by1] of GLYPHS[ch] ?? []) {
      out.push([
        [x0 + (ox + bx0) * sx, y1 - by0 * sy],
        [x0 + (ox + bx1) * sx, y1 - by0 * sy],
        [x0 + (ox + bx1) * sx, y1 - by1 * sy],
        [x0 + (ox + bx0) * sx, y1 - by1 * sy],
      ]);
    }
  });
  return out;
})();

/** Recognisable part PROFILES in plate-normalised coords — closed outlines.
 *  Profiles, not top-down footprints: viewed from above a hook and a bracket are both
 *  rectangles, and the whole point is that you can tell what is being printed. */
/** Display names aligned with FOOTPRINTS — the printer HUD names what it is making. */
export const FOOTPRINT_NAMES = [
  "wall hook", "phone stand", "gear", "cable clip", "name tag",
  "articulated dragon", "rocket", "benchy", "hex key", "L-bracket", "vase",
] as const;

/** Recognisable part PROFILES in plate-normalised coords — closed outlines, y DOWN.
 *  Profiles, not top-down footprints: viewed from above a hook and a bracket are both
 *  rectangles, and the whole point is that you can tell what is being printed.
 *  Weighted towards things people print to USE, plus the two toys the hobby is famous
 *  for (the articulated dragon and a Benchy). */
export const FOOTPRINTS: [number, number][][] = [
  // wall hook — wall plate down the left, arm forward along the bottom, tip turned up.
  // (The previous outline had the arm meeting the plate mid-height and read as a U.)
  // Plate deliberately much taller than the upturned tip — equal legs read as a U.
  [[.26,.10],[.40,.10],[.40,.70],[.66,.70],[.66,.44],[.80,.44],[.80,.86],[.26,.86]],
  // phone stand — wedge with a lip at the foot and a cable slot behind it
  [[.20,.80],[.20,.66],[.30,.66],[.30,.60],[.22,.60],[.60,.20],[.72,.28],[.44,.66],
   [.74,.66],[.74,.80]],
  GEAR,
  // cable clip — a C that opens to the right
  [[.32,.24],[.68,.24],[.68,.38],[.46,.38],[.46,.62],[.68,.62],[.68,.76],[.32,.76]],
  // "JERRY" nameplate — the thing half of 3D printing actually is: a name on a
  // keychain, a desk sign, a label for someone.
  NAMEPLATE,
  // articulated dragon — the print-in-place model the hobby is known for. Side
  // profile: horned head, arched neck, raised wing, four legs, tapering tail.
  // The neck is the whole trick: without a genuinely THIN neck the head merges into
  // the body and the outline reads as a fish with a dorsal fin.
  [[.06,.42],[.16,.34],[.21,.22],[.29,.34],[.40,.42],[.47,.32],[.56,.08],[.74,.20],
   [.66,.36],[.80,.42],[.90,.52],[.97,.66],[.86,.60],[.70,.55],[.68,.74],[.57,.74],
   [.55,.60],[.44,.62],[.42,.76],[.31,.76],[.33,.58],[.43,.50],[.13,.49]],
  // rocket — nose cone, body, two swept fins, nozzle
  [[.50,.10],[.58,.32],[.58,.64],[.74,.82],[.74,.88],[.61,.80],[.61,.90],[.39,.90],
   [.39,.80],[.26,.88],[.26,.82],[.42,.64],[.42,.32]],
  // 3DBenchy — the calibration boat everyone has printed. Pointed bow, deck, cabin
  // box and funnel.
  [[.14,.56],[.30,.44],[.44,.44],[.44,.30],[.52,.30],[.52,.20],[.60,.20],[.60,.30],
   [.70,.30],[.70,.44],[.84,.44],[.86,.62],[.72,.76],[.30,.76]],
  // hex key — a plain L, the shape of the tool in every printer's toolkit
  [[.22,.26],[.80,.26],[.80,.40],[.36,.40],[.36,.84],[.22,.84]],
  // L-bracket with a diagonal gusset
  [[.24,.18],[.38,.18],[.38,.40],[.62,.62],[.80,.62],[.80,.78],[.24,.78]],
  // vase — flared rim, PINCHED neck, wide belly, tapered foot. Without the pinch at
  // the neck the silhouette is just a hexagon.
  [[.40,.14],[.60,.14],[.55,.26],[.72,.46],[.68,.68],[.56,.86],[.44,.86],[.32,.68],
   [.28,.46],[.45,.26]],
];

// Tooth-by-tooth gear: recognisable at a glance and the one curved profile in the set.


/* A nameplate. Letters are stroked as 7-segment-ish bars on a 3x5 grid and then
   OUTLINED as a single closed loop around the plate — the toolpath is a plate with
   the letters cut through it, which is exactly how you would print a keychain tag.
   Kept as one outline (not per-letter islands) so it plays through the same
   perimeter → infill machinery as everything else. */

/** Extra closed loops printed after a part's own outline (nameplate lettering). */
export /** Extra closed loops printed after a part's own outline, keyed by the PROFILE, not by
 *  an index. It used to be `{ 5: NAME_BARS }`, and adding shapes shifted the nameplate
 *  from slot 5 to slot 4 — so the lettering attached to the katana, the katana's own
 *  outline was overwritten by the nameplate rectangle, and slot 4 became an empty
 *  polygon that printed nothing at all. Keying on the array itself cannot drift. */
const EXTRA_BY_PROFILE = new Map<[number, number][], [number, number][][]>([[NAMEPLATE, NAME_BARS]]);
export function extraLoopsFor(profile: [number, number][]): [number, number][][] {
  return EXTRA_BY_PROFILE.get(profile) ?? [];
}

export type Pt = { x: number; y: number };
/** One continuous nozzle move. `travel` moves are non-extruding (no bead drawn);
 *  `wall` marks perimeter/lettering strokes, drawn heavier than infill. */
export type Move = { a: Pt; b: Pt; travel: boolean; wall?: boolean };



/** Diagonal zig-zag infill: scanlines at 45°, paired into spans inside the polygon,
 *  alternating direction so the nozzle snakes instead of teleporting between rows. */
export function infillLines(poly: Pt[], spacing: number): [Pt, Pt][] {
  const C = Math.cos(-Math.PI / 4), S = Math.sin(-Math.PI / 4);
  const rot = (p: Pt): Pt => ({ x: p.x * C - p.y * S, y: p.x * S + p.y * C });
  const unrot = (p: Pt): Pt => ({ x: p.x * C + p.y * S, y: -p.x * S + p.y * C });
  const r = poly.map(rot);
  let lo = Infinity, hi = -Infinity;
  for (const p of r) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  const rows: [Pt, Pt][] = [];
  let flip = false;
  for (let y = lo + spacing; y < hi; y += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const span: [Pt, Pt] = [unrot({ x: xs[i], y }), unrot({ x: xs[i + 1], y })];
      rows.push(flip ? [span[1], span[0]] : span);
    }
    flip = !flip;
  }
  return rows;
}

/** Offset a closed polygon OUTWARD by `d`, with a mitre limit at sharp corners.
 *  Outward on purpose: this is the look the launchpad had at v259 — a double contour
 *  with the hatch meeting it — which the original code produced by accident (its
 *  "inset" ran outward in canvas space) and which read better than every corrected
 *  inward scheme tried since. Outward is also structurally kinder: it cannot collapse
 *  in thin FEATURES (blades, tails), only pinch at narrow exterior NOTCHES, which the
 *  crossing harness checks per shape. */
function offsetOut(poly: Pt[], d: number): Pt[] {
  const n = poly.length;
  if (n < 3) return poly;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    area2 += p.x * q.y - q.x * p.y;
  }
  const s = area2 > 0 ? 1 : -1;   // outward normal in canvas (y-down) space
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const ex = q.x - p.x, ey = q.y - p.y;
    const L = Math.hypot(ex, ey) || 1;
    const nx = (ey / L) * s, ny = (-ex / L) * s;
    lines.push({ px: p.x + nx * d, py: p.y + ny * d, dx: ex / L, dy: ey / L });
  }
  const out: Pt[] = [];
  const LIMIT = Math.abs(d) * 2.5;
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i];
    const den = A.dx * B.dy - A.dy * B.dx;
    let mitred: Pt | null = null;
    if (Math.abs(den) > 1e-9) {
      const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
      const q = { x: A.px + A.dx * t, y: A.py + A.dy * t };
      if (Math.hypot(q.x - poly[i].x, q.y - poly[i].y) <= LIMIT) mitred = q;
    }
    if (mitred) { out.push(mitred); continue; }
    // ROUND JOIN. The old fallback emitted one point, and the chord it created CUT THE
    // CORNER — at a needle tip (the katana's point, a shark fin) that chord passes
    // through the source polygon, so the ring crossed the profile it was wrapping.
    // Arc points all sit at exactly |d| from the vertex; chords of that circle at
    // <=40 degree steps stay at >=0.94|d| from it, which cannot reach the source.
    const vx = poly[i].x, vy = poly[i].y;
    // End of the previous edge's offset segment = this vertex pushed along the PREVIOUS
    // edge's normal; start of this edge's = the vertex along THIS edge's normal.
    const prevLen = Math.hypot(vx - poly[(i - 1 + n) % n].x, vy - poly[(i - 1 + n) % n].y);
    const pPrev = { x: A.px + A.dx * prevLen, y: A.py + A.dy * prevLen };
    const a0 = Math.atan2(pPrev.y - vy, pPrev.x - vx);
    const a1 = Math.atan2(B.py - vy, B.px - vx);
    let diff = a1 - a0;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steps = Math.max(1, Math.ceil(Math.abs(diff) / 0.7));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + (diff * k) / steps;
      out.push({ x: vx + Math.cos(ang) * Math.abs(d), y: vy + Math.sin(ang) * Math.abs(d) });
    }
  }
  return out;
}

/** Remove self-intersection loops from an offset ring. At a narrow exterior notch the
 *  two offset edges cross and the offset curve carries a small twisted loop; cutting
 *  the loop at the intersection point makes the ring BRIDGE the notch — which is what
 *  the eye expects a printed outer wall to do. Classic offset-curve cleanup: find a
 *  crossing pair, splice in the intersection, drop everything between, repeat. */
function untwist(ringIn: Pt[]): Pt[] {
  let ring = ringIn;
  for (let guard = 0; guard < 12; guard++) {
    const n = ring.length;
    let cut: { i: number; j: number; p: Pt } | null = null;
    outer: for (let i = 0; i < n && !cut; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
        const a = ring[i], b = ring[(i + 1) % n], c = ring[j], d = ring[(j + 1) % n];
        const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
        if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) continue;
        cut = { i, j, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
        break outer;
      }
    }
    if (!cut) return ring;
    // Keep the LARGER side of the cut (the ring), drop the twisted loop. Two candidate
    // polygons share the intersection point; the loop is the short one.
    const one: Pt[] = [...ring.slice(0, cut.i + 1), cut.p, ...ring.slice(cut.j + 1)];
    const two: Pt[] = [cut.p, ...ring.slice(cut.i + 1, cut.j + 1)];
    ring = one.length >= two.length ? one : two;
  }
  return ring;
}

/** The full toolpath for one part, in the v259 double-contour style: an outer RING one
 *  wall outside the profile, the profile itself, then infill hatched across the ring's
 *  whole interior — so the hatch runs up to the ring and visually CONNECTS to both
 *  contours instead of floating in a moat. Lettering islands print last. */
export function buildToolpath(poly: Pt[], wall: number, spacing: number, extra: Pt[][] = []): Move[] {
  const moves: Move[] = [];
  const loop = (pts: Pt[]) => {
    for (let i = 0; i < pts.length; i++) moves.push({ a: pts[i], b: pts[(i + 1) % pts.length], travel: false, wall: true });
  };
  const ring = untwist(offsetOut(poly, wall));
  const insideOf = (shape: Pt[]) => (q: Pt): boolean => {
    let c = false;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      const a = shape[i], b = shape[j];
      if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const distTo = (shape: Pt[]) => (q: Pt): number => {
    let m = Infinity;
    for (let i = 0; i < shape.length; i++) {
      const a = shape[i], b = shape[(i + 1) % shape.length];
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L)) : 0;
      m = Math.min(m, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy));
    }
    return m;
  };

  loop(ring);
  moves.push({ a: ring[0], b: poly[0], travel: true });
  loop(poly);

  // Hatch the PROFILE's interior, stopping AT the inner contour: the span tip lands
  // ~0.35 wall from the outline, which with the stroke widths in the renderer means
  // the infill bead just touches the wall bead — connected, never crossing into the
  // moat between the two contours. (An earlier iteration hatched out to the ring and
  // the hatch visibly sliced through the inner outline; not clean.)
  const inPoly = insideOf(poly), distPoly = distTo(poly);
  const CLEAR = wall * 0.35;
  let cursor = poly[0];
  for (const [a, b] of (extra.length ? [] : infillLines(poly, spacing))) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(L / (wall * 0.4)));
    let s0 = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const clear = inPoly(q) && distPoly(q) >= CLEAR;
      if (clear && s0 < 0) s0 = t;
      if ((!clear || k === steps) && s0 >= 0) {
        const t1 = clear ? t : (k - 1) / steps;
        if ((t1 - s0) * L >= spacing * 0.6) {
          const p0 = { x: a.x + (b.x - a.x) * s0, y: a.y + (b.y - a.y) * s0 };
          const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
          moves.push({ a: cursor, b: p0, travel: true });
          moves.push({ a: p0, b: p1, travel: false });
          cursor = p1;
        }
        s0 = -1;
      }
    }
  }
  for (const isle of extra) {
    moves.push({ a: cursor, b: isle[0], travel: true });
    loop(isle);
    cursor = isle[0];
  }
  return moves;
}
