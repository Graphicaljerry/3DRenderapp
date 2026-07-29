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
export const FOOTPRINTS: [number, number][][] = [
  // wall hook — a J: back plate down the left, throat, and the upturned tip
  [[.30,.16],[.44,.16],[.44,.62],[.56,.70],[.68,.62],[.68,.40],[.80,.40],[.80,.66],
   [.58,.84],[.30,.72]],
  // phone stand — wedge with a lip at the foot and a cable slot behind it
  [[.20,.80],[.20,.66],[.30,.66],[.30,.60],[.22,.60],[.60,.20],[.72,.28],[.44,.66],
   [.74,.66],[.74,.80]],
  GEAR,
  // cable clip — a C that opens to the right
  [[.32,.24],[.68,.24],[.68,.38],[.46,.38],[.46,.62],[.68,.62],[.68,.76],[.32,.76]],
  // "JERRY" nameplate — the thing half of 3D printing actually is: a name on a
  // keychain, a desk sign, a label for someone.
  NAMEPLATE,
  // ---- The models people actually print. Chosen from download counts on MakerWorld /
  // Printables / Thingiverse and then filtered on ONE question: can you name it from a
  // flat outline? Anything that only reads in 3D (a Benchy from above is a blob) or
  // needs interior islands to be legible was dropped, as were an articulated dragon,
  // snowflake, elephant, snake and axolotl whose silhouettes did not survive the test.
  // katana — the most-downloaded print-in-place model class on MakerWorld
  [[0.156,0.848],[0.376,0.658],[0.409,0.697],[0.432,0.677],[0.403,0.640],[0.683,0.412],[0.830,0.254],[0.900,0.115],[0.813,0.186],[0.643,0.372],[0.451,0.535],[0.364,0.600],[0.334,0.563],[0.311,0.583],[0.344,0.622],[0.124,0.812]],
  // flexi shark
  [[0.130,0.500],[0.240,0.380],[0.400,0.365],[0.470,0.180],[0.510,0.375],[0.680,0.425],[0.720,0.360],[0.748,0.435],[0.800,0.455],[0.900,0.140],[0.855,0.480],[0.905,0.700],[0.800,0.545],[0.740,0.585],[0.630,0.605],[0.400,0.605],[0.430,0.800],[0.300,0.600],[0.220,0.580],[0.160,0.555]],
  // flexi T-rex — forelimbs omitted, they vanish at this scale
  [[0.130,0.300],[0.185,0.185],[0.290,0.155],[0.345,0.265],[0.450,0.205],[0.575,0.235],[0.680,0.300],[0.795,0.385],[0.900,0.500],[0.775,0.480],[0.695,0.555],[0.640,0.710],[0.620,0.820],[0.495,0.855],[0.550,0.755],[0.580,0.600],[0.465,0.560],[0.375,0.495],[0.320,0.400],[0.265,0.340],[0.140,0.385]],
  // rubber duck
  [[0.130,0.365],[0.230,0.305],[0.270,0.210],[0.345,0.145],[0.425,0.225],[0.435,0.335],[0.520,0.400],[0.645,0.455],[0.775,0.525],[0.875,0.400],[0.815,0.585],[0.735,0.705],[0.565,0.775],[0.385,0.745],[0.285,0.640],[0.255,0.500],[0.245,0.400],[0.155,0.415]],
  // christmas tree — the tier step-in is what stops it being a triangle
  [[0.520,0.100],[0.665,0.385],[0.605,0.385],[0.755,0.585],[0.685,0.585],[0.855,0.765],[0.585,0.765],[0.585,0.865],[0.455,0.865],[0.455,0.765],[0.185,0.765],[0.355,0.585],[0.285,0.585],[0.435,0.385],[0.375,0.385]],
  // sitting cat. The tail is a straight raised sweep, not the researched curl: a
  // curled tip needs the inner edge to double back across the outer edge's line, and
  // no placement of those four points makes that loop simple — an automated search
  // over the plausible range found zero non-self-intersecting configurations. The
  // straight tail is provably simple and still reads as a cat.
  [[0.235,0.145],[0.290,0.250],[0.355,0.130],[0.400,0.270],[0.400,0.360],[0.480,0.450],[0.585,0.545],[0.665,0.650],[0.720,0.560],[0.860,0.280],[0.800,0.500],[0.775,0.655],[0.775,0.755],[0.715,0.835],[0.545,0.850],[0.300,0.845],[0.285,0.690],[0.290,0.530],[0.265,0.400],[0.210,0.335],[0.195,0.260]],
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

/** The full toolpath for one part: ONE perimeter, then infill at a uniform margin,
 *  then any lettering islands — in slicer order, with travel moves between runs.
 *
 *  Deliberately no second perimeter. These profiles are small and full of features a
 *  wall or two wide (the katana's blade, the cat's tail, the T-rex's legs), so an inner
 *  wall can never be valid everywhere — and every partial strategy tried (mitre limits,
 *  clearance thresholds, dropping unfit segments) left FRAGMENTS: stubs that start and
 *  stop arbitrarily and read as broken linework rather than a printed wall. One clean
 *  perimeter with a consistent infill margin looks like a deliberate first layer; the
 *  wall-versus-infill hierarchy comes from stroke weight instead (see Move.wall).
 */
export function buildToolpath(poly: Pt[], wall: number, spacing: number, extra: Pt[][] = []): Move[] {
  const moves: Move[] = [];
  const loop = (pts: Pt[]) => {
    for (let i = 0; i < pts.length; i++) moves.push({ a: pts[i], b: pts[(i + 1) % pts.length], travel: false, wall: true });
  };
  const inside = (q: Pt): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const distToOutline = (q: Pt): number => {
    let m = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L)) : 0;
      m = Math.min(m, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy));
    }
    return m;
  };

  loop(poly);

  // Infill: exact scanline spans against the outline, each span clipped by sampling to
  // a SINGLE uniform clearance. One number, measured from one thing — the ragged look
  // came from margins measured partly to the outline and partly to wall fragments.
  const CLEAR = wall * 1.35;
  let cursor = poly[0];
  for (const [a, b] of (extra.length ? [] : infillLines(poly, spacing))) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(L / (wall * 0.75)));
    let s0 = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const clear = inside(q) && distToOutline(q) >= CLEAR;
      if (clear && s0 < 0) s0 = t;
      if ((!clear || k === steps) && s0 >= 0) {
        const t1 = clear ? t : (k - 1) / steps;
        if ((t1 - s0) * L >= spacing * 0.7) {
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
  // Lettering on a nameplate: separate closed loops walked last, each reached by a
  // travel move, exactly as a slicer orders disconnected islands on one layer.
  for (const isle of extra) {
    moves.push({ a: cursor, b: isle[0], travel: true });
    loop(isle);
    cursor = isle[0];
  }
  return moves;
}
