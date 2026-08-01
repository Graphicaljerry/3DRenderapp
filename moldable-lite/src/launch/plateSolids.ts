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

/** A rounded-ish n-gon, used where a circle is wanted without 40 points. Lives with the
 *  builders because module-init consts (GEAR_SOLID) need it before the parts section. */
const disc = (r: number, sides = 20, cx = 0.5, cy = 0.5): Vec2[] => {
  const out: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
};

/** A constant cross-section extruded straight up — how flat parts actually print. */
function prism(poly: Vec2[], height: number, layers: number, topLoops?: Vec2[][], holes: Vec2[][] = []): Solid {
  const loops = [poly, ...holes];
  return { sections: [{ z: 0, loops, fill: 1 }, { z: 1, loops, fill: 1 }], height, layers, topLoops };
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

/** 12-tooth gear footprint. Flanks taper (tip narrower than root) — square-cut teeth
 *  read as a sprocket. */
const GEAR_POLY: Vec2[] = (() => {
  const pts: Vec2[] = [];
  const TEETH = 12, RO = 0.30, RI = 0.235;
  for (let i = 0; i < TEETH; i++) {
    const a0 = (i / TEETH) * Math.PI * 2;
    const step = (Math.PI * 2) / TEETH / 4;
    for (const [k, r] of [[0, RI], [1.25, RO], [1.75, RO], [3, RI]] as [number, number][]) {
      const a = a0 + k * step;
      pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
    }
  }
  return pts;
})();

/** The gear's shaft bore with its keyway, as ONE clean loop: an arc that opens at the
 *  top and squares off into the key slot. The old version appended the slot's corners
 *  after a full circle, which self-intersected — on screen the middle was a blob. */
const GEAR_BORE: Vec2[] = (() => {
  const r = 0.078, kw = 0.022, kd = 0.026, N = 28;
  const half = Math.asin(kw / r);                 // half-angle the slot removes from the arc
  const start = Math.PI / 2 + half;               // left slot edge, sweeping the long way round
  const sweep = Math.PI * 2 - 2 * half;           // ends at the right slot edge
  const out: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    const a = start + (i / N) * sweep;
    out.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
  }
  out.push([0.5 + kw, 0.5 + r + kd], [0.5 - kw, 0.5 + r + kd]);
  return out;
})();

/** Bore + keyway through everything, five round lightening holes, and a counterbored
 *  hub: the top quarter swaps the bore loop for a wider recess circle, so the finished
 *  part sinks around the shaft the way a real gear's hub does. Same loop and point
 *  counts either side of the step, so the two-percent transition band lerps cleanly. */
const GEAR_SOLID: Solid = (() => {
  const holes = [0, 1, 2, 3, 4].map((i) => {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 10;
    return disc(0.046, 20, 0.5 + Math.cos(a) * 0.168, 0.5 + Math.sin(a) * 0.168);
  });
  const lower = [GEAR_POLY, GEAR_BORE, ...holes];
  const upper = [GEAR_POLY, disc(0.112, GEAR_BORE.length), ...holes];
  return {
    sections: [
      { z: 0, loops: lower, fill: 1 }, { z: 0.72, loops: lower, fill: 1 },
      { z: 0.76, loops: upper, fill: 1 }, { z: 1, loops: upper, fill: 1 },
    ],
    height: 0.075, layers: 8,
  };
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

/* ---------- helpers for the parts built from real millimetres ---------- */

/** A rectangle with radiused corners, in whatever units the caller is working in. Every
 *  functional part below uses this rather than a bare rect: a printed bracket or plate has
 *  rounded corners, and drawn square they all read as the same anonymous slab. */
const roundRect = (x0: number, y0: number, x1: number, y1: number, r: number, seg = 4): Vec2[] => {
  const rr = Math.max(0, Math.min(r, Math.min(x1 - x0, y1 - y0) / 2));
  const out: Vec2[] = [];
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  arc(x1 - rr, y0 + rr, -Math.PI / 2);
  arc(x1 - rr, y1 - rr, 0);
  arc(x0 + rr, y1 - rr, Math.PI / 2);
  arc(x0 + rr, y0 + rr, Math.PI);
  return out;
};

/** Assemble a stepped solid from a per-layer loop builder working in millimetres.
 *  `bounds` is the model's [x0,y0,x1,y1] footprint and `mmH` its height; the part is scaled
 *  so its longest horizontal dimension is `target` of the bed and centred there. */
function fromMM(
  layers: number,
  mmH: number,
  bounds: [number, number, number, number],
  target: number,
  build: (z: number) => { outer: Vec2[][]; holes?: Vec2[][] },
): Solid {
  const [bx0, by0, bx1, by1] = bounds;
  const S = Math.max(bx1 - bx0, by1 - by0) / target;
  const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
  const map = (poly: Vec2[]): Vec2[] => poly.map(([x, y]) => [0.5 + (x - mx) / S, 0.5 + (y - my) / S]);
  const sections: Section[] = [];
  for (let i = 0; i < layers; i++) {
    // Sample the MIDDLE of each layer band: a plane exactly on a face of the model cuts a
    // zero-thickness feature and yields a degenerate loop.
    const { outer, holes = [] } = build(mmH * ((i + 0.5) / layers));
    sections.push({
      z: i / Math.max(1, layers - 1),
      loops: [...outer.map(map), ...holes.map(map)],
      fill: outer.length,
    });
  }
  return { sections, height: mmH / S, layers: Math.max(1, layers - 1), stepped: true };
}

/** The "Wall hook" template: a 30 x 70 plate with two screw holes and a J-hook that reaches
 *  34 mm out over a 10 mm inner radius. Printed flat on its back, which is what the template
 *  says and what needs no supports.
 *
 *  The old version was three stacked rectangles that stepped sideways. It had no curve
 *  anywhere, so it read as a stack of blocks — you could not tell it from the bracket.
 *  Here the J is the template's own arc pair: both arcs are concentric, so the cross-section
 *  is one interval whose ends sweep as the layers rise. That sweep IS the hook. */
const WALL_HOOK: Solid = (() => {
  const PW = 30, PH = 70, PT = 4, HW = 18, REACH = 34, RIN = 10, TIP = 16, T = 6, HOLE = 4.4;
  const ROUT = RIN + T;
  const holeY = PH / 2 - 8;
  const aC = -T / 2 + ROUT, bC = REACH - ROUT;   // both arcs of the J share this centre
  const shelf = REACH - T;                       // where the tip's underside begins
  return fromMM(20, PT + REACH, [-PW / 2, -PH / 2, PW / 2, PH / 2], 0.62, (z) => {
    if (z < PT) {
      return {
        outer: [roundRect(-PW / 2, -PH / 2, PW / 2, PH / 2, 3, 3)],
        holes: [disc(HOLE / 2, 12, 0, holeY), disc(HOLE / 2, 12, 0, -holeY)],
      };
    }
    const b = z - PT;
    let lo: number, hi: number;
    if (b <= bC) { lo = -T / 2; hi = T / 2; }                      // the stem, straight out
    else {
      lo = aC - Math.sqrt(Math.max(0, ROUT * ROUT - (b - bC) ** 2));
      hi = b <= shelf ? aC - Math.sqrt(Math.max(0, RIN * RIN - (b - bC) ** 2)) : aC + TIP;
    }
    return { outer: [roundRect(-HW / 2, lo, HW / 2, hi, Math.min(2.5, (hi - lo) / 2), 2)] };
  });
})();

/** An L-bracket with the things that make one legible: a radiused inside corner, rounded
 *  outer corners, and screw holes in both legs. The old one was two bare rectangles meeting
 *  at a hard right angle — structurally the least informative shape available. */
const L_BRACKET: Solid = (() => {
  const LEG = 58, W = 40, T = 5, FR = 15, HOLE = 5, R = 6, H = 52;
  const hx = [24, 42];                    // screw centres along the flat leg
  const hz = [24, 42];                    // and up the standing leg
  const hy = W / 2;
  return fromMM(22, H, [0, 0, LEG, W], 0.58, (z) => {
    if (z < T) {
      return {
        outer: [roundRect(0, 0, LEG, W, R, 3)],
        holes: hx.map((x) => disc(HOLE / 2, 12, x, hy)),
      };
    }
    // The standing leg, thickened at its foot by a quarter-round fillet into the flat leg.
    const fil = z < T + FR ? T + FR - Math.sqrt(Math.max(0, FR * FR - (T + FR - z) ** 2)) : T;
    // Round the top corners off in the last R of height, the same way the flat leg is round.
    const cap = z > H - R ? R - Math.sqrt(Math.max(0, R * R - (z - (H - R)) ** 2)) : 0;
    const outer = [roundRect(0, cap, fil, W - cap, Math.min(2.5, fil / 2), 2)];
    // Through-holes across the standing leg read as slots that open and close with height.
    const holes: Vec2[][] = [];
    for (const zc of hz) {
      const half = Math.sqrt(Math.max(0, (HOLE / 2) ** 2 - (z - zc) ** 2));
      if (half > 0.2) holes.push(roundRect(-1, hy - half, T + 1, hy + half, 0, 1));
    }
    return { outer, holes };
  });
})();

/** The "Cable clip" template: a 2.5 mm base with two screw tabs and a C-ring for a 6 mm
 *  cable, snap opening at the top. Printed base down, as the template builds it.
 *
 *  The old one was a rectilinear C traced by hand. A real clip is a ring, and a ring sliced
 *  horizontally gives two bands whose width changes every layer — that variation is the
 *  whole reason it reads as round rather than as a bent rectangle. */
const CABLE_CLIP: Solid = (() => {
  const CABLE = 6, WALL = 2.4, LEN = 12, BASE = 2.5, TAB = 9, SCREW = 3.4;
  const rIn = CABLE / 2 + 0.15, rOut = rIn + WALL, cz = BASE + rIn;
  const half = rOut + TAB, gap = (CABLE * 0.72) / 2;
  const H = cz + rOut;
  /* 26 layers over 11 mm, not the dozen the part's size suggests. The ring's cross-section
     is a thin band, and at a coarse pitch the bands sit far enough apart in the isometric
     that they read as loose slats instead of a curved wall. */
  return fromMM(26, H, [-half, -LEN / 2, half, LEN / 2], 0.56, (z) => {
    if (z < BASE) {
      return {
        outer: [roundRect(-half, -LEN / 2, half, LEN / 2, 2, 3)],
        holes: [disc(SCREW / 2, 12, -(rOut + TAB / 2), 0), disc(SCREW / 2, 12, rOut + TAB / 2, 0)],
      };
    }
    const d = z - cz;
    const xo = Math.sqrt(Math.max(0, rOut * rOut - d * d));
    if (xo <= 0.05) return { outer: [] };
    const xi = Math.abs(d) < rIn ? Math.sqrt(rIn * rIn - d * d) : 0;
    const band = (a: number, b: number) => roundRect(a, -LEN / 2, b, LEN / 2, 0, 1);
    // Above the cable's centre the snap opening splits the ring whatever the wall is doing.
    const cut = d > 0 ? Math.max(xi, gap) : xi;
    return { outer: cut > 0 ? [band(-xo, -cut), band(cut, xo)] : [band(-xo, xo)] };
  });
})();

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
  const S = Math.max(maxX, W) / 0.52;              // longest horizontal dim -> 0.52 of the bed
  /* Turned 180 degrees on the bed so the seat and lip face the FRONT. Built the other way
     round the stand looked away from you, up the back-left of the plate, and the one face
     that says "phone stand" — the seat, the lip, the cable slot — was the hidden one. */
  const px = (x: number): number => 0.5 - (x - maxX / 2) / S;
  const py = (y: number): number => 0.5 - (y - W / 2) / S;
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
    // Bore, keyway, lightening holes, counterbored hub. A toothed disc with a solid
    // middle is a cog in a diagram; the bore is what says it goes on a shaft.
    solid: GEAR_SOLID,
  },
  {
    name: "name tag",
    solid: prism(rect(TAG_W, TAG_D), 0.045, 5, NAME_BARS),
  },
  { name: "wall hook", solid: WALL_HOOK },
  { name: "L-bracket", solid: L_BRACKET },
  { name: "cable clip", solid: CABLE_CLIP },
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
