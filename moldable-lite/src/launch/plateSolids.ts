/* Solids for the launchpad backdrop, and the slicing + isometric projection that print
   them layer by layer.

   This replaced a set of 2D side PROFILES drawn flat on a top-down plate, which was
   physically false: a vase printed upright presents a ring from above, not a vase
   outline, so every tall object was drawn in a view it could never be printed in. Here
   each object is a real solid, oriented the way it would actually go on the bed, sliced
   at its own layer height and stacked in isometric — so the silhouette that emerges is
   the object, and a flat part genuinely prints in few layers while a tall one takes many.

   Deliberately Canvas 2D and not three.js: the projection is three multiplies, the whole
   file is geometry, and the entry screen must not pull a WebGL context or a renderer into
   the critical path. */

export type Vec2 = [number, number];
/** A cross-section at `z` (0..1 of the solid's height). Every section of one solid MUST
 *  have the same point count so consecutive sections can be interpolated per-vertex. */
export type Section = { z: number; poly: Vec2[] };
export type Solid = {
  /** Sections sorted by z, first at 0 and last at 1. */
  sections: Section[];
  /** Height in plate units (1 = the bed's width), so tall things tower and plates are flat. */
  height: number;
  /** Layers to print. Proportional to height — a name tag is a few, a vase is many. */
  layers: number;
  /** Closed loops drawn only on the TOP layer: raised lettering, etc. */
  topLoops?: Vec2[][];
};

/* ---------- builders ---------- */

/** A constant cross-section extruded straight up — how flat parts actually print. */
function prism(poly: Vec2[], height: number, layers: number, topLoops?: Vec2[][]): Solid {
  return { sections: [{ z: 0, poly }, { z: 1, poly }], height, layers, topLoops };
}

/** A solid of revolution from a [z, radius] profile, centred on the bed. */
function revolve(profile: [number, number][], sides: number, height: number, layers: number): Solid {
  const ring = (r: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      out.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
    }
    return out;
  };
  return { sections: profile.map(([z, r]) => ({ z, poly: ring(Math.max(r, 0.004)) })), height, layers };
}

/** Interpolate a solid's cross-section at `t` (0..1 of its height). */
export function sliceAt(s: Solid, t: number): Vec2[] {
  const secs = s.sections;
  if (t <= secs[0].z) return secs[0].poly;
  for (let i = 1; i < secs.length; i++) {
    if (t <= secs[i].z) {
      const a = secs[i - 1], b = secs[i];
      const span = b.z - a.z;
      const f = span > 1e-9 ? (t - a.z) / span : 0;
      return a.poly.map((p, k) => [p[0] + (b.poly[k][0] - p[0]) * f, p[1] + (b.poly[k][1] - p[1]) * f] as Vec2);
    }
  }
  return secs[secs.length - 1].poly;
}

/* ---------- isometric projection ---------- */

/** Bed geometry in screen space: `cx,cy` is the bed's CENTRE, `w` its projected width. */
export type IsoView = { cx: number; cy: number; w: number };

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Plate coords (x,y in 0..1 across the bed, z up in the same units) -> screen pixels.
 *  True isometric: the two bed axes leave the origin at ±30 degrees and z is straight up,
 *  so a cube reads as a cube and no vanishing point is implied. */
export function iso(view: IsoView, x: number, y: number, z: number): Vec2 {
  const u = x - 0.5, v = y - 0.5;
  return [
    view.cx + (u - v) * COS30 * view.w,
    view.cy + (u + v) * SIN30 * view.w - z * view.w,
  ];
}

/* ---------- the objects ---------- */
/* Each is oriented the way it would really be placed on the bed: flat parts lie down and
   print in a handful of layers, tall parts stand up and take many. Everything is centred
   on the bed — an object parked off to one side reads as a mistake, and the name tag in
   particular was noticeably off-centre in the previous version. */

/** Centre a polygon's bounding box on the bed. */
function centred(poly: Vec2[]): Vec2[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const dx = 0.5 - (x0 + x1) / 2, dy = 0.5 - (y0 + y1) / 2;
  return poly.map(([x, y]) => [x + dx, y + dy] as Vec2);
}

/** 12-tooth gear footprint. */
const GEAR_POLY: Vec2[] = (() => {
  const pts: Vec2[] = [];
  const TEETH = 12, RO = 0.30, RI = 0.235;
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

/** "JERRY" as raised bars on the tag's top face — 3x5 grid glyphs, y UP in grid space. */
const NAME_TEXT = "JERRY";
const GLYPHS: Record<string, [number, number, number, number][]> = {
  J: [[2, 1, 3, 5], [0, 0, 3, 1], [0, 1, 1, 2]],
  E: [[0, 0, 1, 5], [1, 0, 3, 1], [1, 2, 2.6, 3], [1, 4, 3, 5]],
  R: [[0, 0, 1, 5], [1, 4, 2.6, 5], [2, 3, 3, 4], [1, 2, 2.6, 3], [2, 0, 3, 2]],
  Y: [[0, 4, 1, 5], [0.6, 3, 1.6, 4], [1.4, 3, 2.4, 4], [2, 4, 3, 5], [1.2, 0, 2, 3]],
};
const TAG_W = 0.62, TAG_D = 0.24;
const NAME_BARS: Vec2[][] = (() => {
  const letters = NAME_TEXT.split("");
  const CW = 3, GAP = 1;
  const total = letters.length * CW + (letters.length - 1) * GAP;
  const x0 = 0.5 - TAG_W / 2 + 0.05, x1 = 0.5 + TAG_W / 2 - 0.05;
  const y0 = 0.5 - TAG_D / 2 + 0.05, y1 = 0.5 + TAG_D / 2 - 0.05;
  const sx = (x1 - x0) / total, sy = (y1 - y0) / 5;
  const out: Vec2[][] = [];
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

/** A rectangle centred anywhere on the bed — lets a solid's footprint STEP as it rises
 *  (plate, then arm) rather than only taper. */
const rectAt = (w: number, d: number, cx: number, cy: number): Vec2[] => [
  [cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2],
  [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2],
];
const rect = (w: number, d: number): Vec2[] => [
  [0.5 - w / 2, 0.5 - d / 2], [0.5 + w / 2, 0.5 - d / 2],
  [0.5 + w / 2, 0.5 + d / 2], [0.5 - w / 2, 0.5 + d / 2],
];
/** A rounded-ish n-gon, used where a circle is wanted without 40 points. */
const disc = (r: number, sides = 20, cx = 0.5, cy = 0.5): Vec2[] => {
  const out: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
};

export const SOLIDS: { name: string; solid: Solid }[] = [
  // ---- tall, printed standing: these are why isometric matters ----
  {
    name: "vase",
    // Circular from above (which is the honest top view) and unmistakably a vase in iso.
    solid: revolve([[0, 0.15], [0.10, 0.17], [0.42, 0.25], [0.66, 0.19], [0.86, 0.13], [0.95, 0.16], [1, 0.165]], 22, 0.60, 30),
  },
  {
    name: "rocket",
    solid: (() => {
      const body = (r: number) => disc(r, 18);
      // Fins live in the lowest fifth: the section grows three tabs, then loses them.
      const finned = (r: number): Vec2[] => {
        const base = disc(r, 18);
        return base.map((p, i) => (i % 6 === 0 ? [0.5 + (p[0] - 0.5) * 2.15, 0.5 + (p[1] - 0.5) * 2.15] as Vec2 : p));
      };
      return {
        sections: [
          { z: 0, poly: finned(0.085) }, { z: 0.16, poly: finned(0.085) },
          { z: 0.19, poly: body(0.085) }, { z: 0.60, poly: body(0.085) },
          { z: 0.78, poly: body(0.062) }, { z: 1, poly: body(0.006) },
        ],
        height: 0.62, layers: 30,
      };
    })(),
  },
  {
    name: "benchy",
    solid: {
      // Hull -> cabin -> funnel. Point counts match across sections by construction.
      sections: [
        { z: 0, poly: centred([[.20,.42],[.62,.36],[.80,.44],[.80,.58],[.62,.66],[.20,.60]]) },
        { z: 0.42, poly: centred([[.16,.40],[.64,.34],[.84,.44],[.84,.58],[.64,.68],[.16,.62]]) },
        { z: 0.46, poly: centred([[.38,.42],[.60,.40],[.66,.45],[.66,.56],[.60,.61],[.38,.59]]) },
        { z: 0.74, poly: centred([[.38,.42],[.60,.40],[.66,.45],[.66,.56],[.60,.61],[.38,.59]]) },
        { z: 0.78, poly: centred([[.44,.46],[.52,.455],[.55,.48],[.55,.52],[.52,.545],[.44,.54]]) },
        { z: 1, poly: centred([[.44,.46],[.52,.455],[.55,.48],[.55,.52],[.52,.545],[.44,.54]]) },
      ],
      height: 0.34, layers: 22,
    },
  },

  // ---- flat, printed lying down: few layers, and that contrast is the rhythm ----
  {
    name: "gear",
    solid: prism(GEAR_POLY, 0.075, 7),
  },
  {
    name: "name tag",
    solid: prism(rect(TAG_W, TAG_D), 0.045, 5, NAME_BARS),
  },
  {
    name: "wall hook",
    // Back plate flat on the bed, arm rising off it and leaning over at the tip — the
    // orientation you would actually choose, and the one where it reads as a HOOK.
    // Flat on its side it was an indistinguishable C next to the bracket and the clip.
    // Paired sections 0.005 apart make the footprint STEP rather than taper.
    solid: {
      sections: [
        { z: 0, poly: rectAt(0.46, 0.20, 0.5, 0.5) },
        { z: 0.20, poly: rectAt(0.46, 0.20, 0.5, 0.5) },
        { z: 0.205, poly: rectAt(0.13, 0.20, 0.36, 0.5) },
        { z: 0.62, poly: rectAt(0.13, 0.20, 0.36, 0.5) },
        { z: 1, poly: rectAt(0.13, 0.20, 0.64, 0.5) },
      ],
      height: 0.30, layers: 18,
    },
  },
  {
    name: "L-bracket",
    // Standing: one leg flat on the bed, the other rising. Same reason as the hook —
    // the distinguishing feature of a bracket is the right angle standing UP.
    solid: {
      sections: [
        { z: 0, poly: rectAt(0.46, 0.26, 0.5, 0.5) },
        { z: 0.17, poly: rectAt(0.46, 0.26, 0.5, 0.5) },
        { z: 0.175, poly: rectAt(0.11, 0.26, 0.33, 0.5) },
        { z: 1, poly: rectAt(0.11, 0.26, 0.33, 0.5) },
      ],
      height: 0.28, layers: 16,
    },
  },
  {
    name: "hex key",
    solid: prism(centred([[.22,.26],[.80,.26],[.80,.40],[.36,.40],[.36,.84],[.22,.84]]), 0.055, 5),
  },
  {
    name: "cable clip",
    solid: prism(centred([[.32,.24],[.68,.24],[.68,.38],[.46,.38],[.46,.62],[.68,.62],[.68,.76],[.32,.76]]), 0.085, 7),
  },
  {
    name: "phone stand",
    // Lying on its side — the orientation that needs no supports, and the one a slicer
    // would suggest. Printed standing it would be a tower of overhang.
    solid: prism(centred([[.20,.80],[.20,.66],[.30,.66],[.30,.60],[.22,.60],[.60,.20],[.72,.28],[.44,.66],[.74,.66],[.74,.80]]), 0.13, 10),
  },
  {
    name: "articulated dragon",
    // Flat, segmented, as print-in-place articulated models actually come off the bed:
    // the top view IS the recognisable thing, so this is the one orientation where the
    // shape and the physics agree.
    solid: (() => {
      const N = 15;
      const upper: Vec2[] = [], lower: Vec2[] = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const x = 0.14 + t * 0.72;
        const y = 0.5 + Math.sin(t * Math.PI * 1.5) * 0.115;      // serpentine spine
        // Body tapers head-to-tail; the segment bumps are a GENTLE ripple. Alternating
        // hard scallops (1.7x / 0.6x) turned the outline into a lightning bolt.
        const taper = 1 - t * 0.7;
        const head = i <= 1 ? 2.1 : i === 2 ? 1.35 : 1;          // wedge head
        const ripple = 1 + 0.2 * Math.cos(i * Math.PI);
        const half = 0.058 * taper * head * ripple;
        upper.push([x, y - half]);
        lower.push([x, y + half]);
      }
      return prism([...upper, ...lower.reverse()], 0.055, 6);
    })(),
  },
];
