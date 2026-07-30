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

import { MESH_SOLIDS } from "./meshSolids";

export type Vec2 = [number, number];
/** A cross-section at `z` (0..1 of the solid's height), as the closed loops a slicer would
 *  lay down there — usually one, but a hollow or many-part cut has several. Within a
 *  non-stepped solid every section MUST carry the same loops with the same point counts, so
 *  consecutive sections can be interpolated per-vertex. */
export type Section = {
  z: number;
  loops: Vec2[][];
  /** The first `fill` loops are outer boundaries and get filled; the rest are holes inside
   *  them and are only stroked. Absent means every loop is an outer boundary. */
  fill?: number;
};
export type Solid = {
  /** Sections sorted by z, first at 0 and last at 1. */
  sections: Section[];
  /** Height in plate units (1 = the bed's width), so tall things tower and plates are flat. */
  height: number;
  /** Layers to print. Proportional to height — a name tag is a few, a vase is many. */
  layers: number;
  /** Closed loops drawn only on the TOP layer: raised lettering, etc. */
  topLoops?: Vec2[][];
  /** Mesh-sliced: one section per printed layer, snapped to rather than interpolated.
   *  Real slices change loop COUNT from layer to layer, so there is nothing to lerp. */
  stepped?: boolean;
};

/* ---------- builders ---------- */

/** A constant cross-section extruded straight up — how flat parts actually print. */
function prism(poly: Vec2[], height: number, layers: number, topLoops?: Vec2[][]): Solid {
  return { sections: [{ z: 0, loops: [poly] }, { z: 1, loops: [poly] }], height, layers, topLoops };
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
  return { sections: profile.map(([z, r]) => ({ z, loops: [ring(Math.max(r, 0.004))] })), height, layers };
}

/** Is `p` inside the closed polygon `poly`? Crossing count along +x. */
function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** Decode a solid sliced from a real mesh by tools/stl-to-solid.mjs: layers separated by
 *  `|`, loops by `;`, coordinates as integers in thousandths of the bed width. */
export function fromLayers(enc: string, height: number): Solid {
  const sections: Section[] = enc.split("|").map((l, i, all) => {
    const loops = l.split(";").filter(Boolean).map((s) => {
      const n = s.split(",");
      const poly: Vec2[] = [];
      for (let k = 0; k + 1 < n.length; k += 2) poly.push([+n[k] / 1000, +n[k + 1] / 1000]);
      return poly;
    });
    /* Split outer boundaries from holes so the layer can be FILLED and still read as the
       part rather than a blob: a Benchy hull is a ring, and filling it whole would flood the
       cockpit. Nesting depth, not size — an island can sit inside a hole inside an island.
       Done once at decode, never per frame. */
    const outer: Vec2[][] = [], holes: Vec2[][] = [];
    for (const loop of loops) {
      let depth = 0;
      for (const other of loops) if (other !== loop && inside(loop[0], other)) depth++;
      (depth % 2 ? holes : outer).push(loop);
    }
    return { z: i / Math.max(1, all.length - 1), loops: [...outer, ...holes], fill: outer.length };
  });
  return { sections, height, layers: Math.max(1, sections.length - 1), stepped: true };
}

/** A layer's closed loops. The first `fill` are outer boundaries; the rest are holes. */
export type Slice = { loops: Vec2[][]; fill: number };

/** A solid's cross-section at `t` (0..1 of its height). */
export function sliceAt(s: Solid, t: number): Slice {
  const secs = s.sections;
  const of = (sec: Section): Slice => ({ loops: sec.loops, fill: sec.fill ?? sec.loops.length });
  if (s.stepped) {
    const i = Math.max(0, Math.min(secs.length - 1, Math.round(t * (secs.length - 1))));
    return of(secs[i]);
  }
  if (t <= secs[0].z) return of(secs[0]);
  for (let i = 1; i < secs.length; i++) {
    if (t <= secs[i].z) {
      const a = secs[i - 1], b = secs[i];
      const span = b.z - a.z;
      const f = span > 1e-9 ? (t - a.z) / span : 0;
      const loops = a.loops.map((loop, li) => {
        const to = b.loops[li] ?? loop;
        return loop.map((p, k) => {
          const q = to[k] ?? p;
          return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f] as Vec2;
        });
      });
      return { loops, fill: a.fill ?? loops.length };
    }
  }
  return of(secs[secs.length - 1]);
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

/** The "Phone stand" template, built the way the template builds it and printed the way you
 *  would actually print it: standing on its base.
 *
 *  Same numbers as cad/templates.ts, so what prints on the launchpad is the part behind the
 *  template card rather than a doodle that resembles one. The old version was a ten-point
 *  outline extruded flat, which read as a random polygon.
 *
 *  Cross-sections, bottom to top: the base and seat floor as one block growing backwards;
 *  then the lip and the leaning support as separate islands, the lip split IN TWO by the
 *  cable slot cut through it; then the support alone, drifting back as it rises. The 1-to-3
 *  and 3-to-1 island changes are why this is `stepped` — there is no per-vertex path from
 *  one to the next. */
const PHONE_STAND: Solid = (() => {
  const W = 70, SEAT = 22, ANG = 62, T = 9, LIP = 14, L = 78, SLOT = 14;   // template defaults
  const a = (ANG * Math.PI) / 180;
  const h = T / Math.sin(a);                       // horizontal cut of the leaning thickness
  const D = SEAT + T;
  const H = T + L * Math.sin(a);                   // overall height, standing
  const back = D + h - T / Math.tan(a);            // where the outer face meets the bed
  const slope = (D + L * Math.cos(a) - back) / H;  // both faces of the support are parallel
  const maxX = back + slope * H;
  const lipX = T * 0.66;
  const slotX = T * 0.66 + 10;                     // how far the cable notch reaches back
  const slotZ = T + LIP + 1;
  const sy0 = (W - SLOT) / 2, sy1 = sy0 + SLOT;

  const LAYERS = 30;
  const S = Math.max(maxX, W) / 0.56;              // longest horizontal dim -> 0.56 of the bed
  const px = (x: number): number => 0.5 + (x - maxX / 2) / S;
  const py = (y: number): number => 0.5 + (y - W / 2) / S;
  const box = (x0: number, x1: number, y0: number, y1: number): Vec2[] =>
    [[px(x0), py(y0)], [px(x1), py(y0)], [px(x1), py(y1)], [px(x0), py(y1)]];

  const sections: Section[] = [];
  for (let i = 0; i < LAYERS; i++) {
    const z = H * ((i + 0.5) / LAYERS);
    const xOut = back + slope * z;
    const loops: Vec2[][] = [];
    if (z < T) {
      // Base and seat floor, with the cable channel notched into the front edge.
      loops.push(z < slotZ
        ? [[px(0), py(0)], [px(xOut), py(0)], [px(xOut), py(W)], [px(0), py(W)],
           [px(0), py(sy1)], [px(slotX), py(sy1)], [px(slotX), py(sy0)], [px(0), py(sy0)]]
        : box(0, xOut, 0, W));
    } else {
      if (z < T + LIP) {                           // the slot cuts the lip clean in two
        loops.push(box(0, lipX, 0, sy0));
        loops.push(box(0, lipX, sy1, W));
      }
      loops.push(box(D + slope * (z - T), xOut, 0, W));
    }
    loops.sort((p, q) => {
      const area = (l: Vec2[]) => Math.abs((l[2][0] - l[0][0]) * (l[2][1] - l[0][1]));
      return area(q) - area(p);
    });
    sections.push({ z: i / (LAYERS - 1), loops });
  }
  return { sections, height: H / S, layers: LAYERS - 1, stepped: true };
})();

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
          { z: 0, loops: [finned(0.085)] }, { z: 0.16, loops: [finned(0.085)] },
          { z: 0.19, loops: [body(0.085)] }, { z: 0.60, loops: [body(0.085)] },
          { z: 0.78, loops: [body(0.062)] }, { z: 1, loops: [body(0.006)] },
        ],
        height: 0.62, layers: 30,
      };
    })(),
  },
  {
    name: "3DBenchy",
    // Sliced from the real mesh. The hand-drawn version before it was a six-point hull with
    // a box and a stub on top: it read as "a boat", which is exactly what it was.
    solid: fromLayers(MESH_SOLIDS.benchy.enc, MESH_SOLIDS.benchy.height),
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
        { z: 0, loops: [rectAt(0.46, 0.20, 0.5, 0.5)] },
        { z: 0.20, loops: [rectAt(0.46, 0.20, 0.5, 0.5)] },
        { z: 0.205, loops: [rectAt(0.13, 0.20, 0.36, 0.5)] },
        { z: 0.62, loops: [rectAt(0.13, 0.20, 0.36, 0.5)] },
        { z: 1, loops: [rectAt(0.13, 0.20, 0.64, 0.5)] },
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
        { z: 0, loops: [rectAt(0.46, 0.26, 0.5, 0.5)] },
        { z: 0.17, loops: [rectAt(0.46, 0.26, 0.5, 0.5)] },
        { z: 0.175, loops: [rectAt(0.11, 0.26, 0.33, 0.5)] },
        { z: 1, loops: [rectAt(0.11, 0.26, 0.33, 0.5)] },
      ],
      height: 0.28, layers: 16,
    },
  },
  {
    name: "cable clip",
    solid: prism(centred([[.32,.24],[.68,.24],[.68,.38],[.46,.38],[.46,.62],[.68,.62],[.68,.76],[.32,.76]]), 0.085, 7),
  },
  {
    name: "phone stand",
    solid: PHONE_STAND,
  },
  {
    name: "bone dragon",
    // Sliced from the real mesh, coiled flat on the bed the way a print-in-place skeleton
    // comes off it. The hand-drawn predecessor was a serpentine ribbon of 15 spine points
    // and read as a lightning bolt: a vertebra, a rib and a horn are separate islands, and
    // no single tapered outline is ever going to be a dragon.
    solid: fromLayers(MESH_SOLIDS.boneDragon.enc, MESH_SOLIDS.boneDragon.height),
  },
];
