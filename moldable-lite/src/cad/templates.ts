// Template gallery: curated parametric parts that build with ZERO API spend.
// Each template is a plain replicad program (same contract as AI output), so the
// whole app — live param sliders, direct edits, history, every export — just works.
// Verified against the real OCCT kernel; see docs/HANDOFF.md conventions.
//
// Kernel conventions the geometry below relies on (probed):
//   sketchOnPlane("XZ"): drawing (x,y) → (X,Z), extrude(w) spans y ∈ [-w, 0]
//   sketchOnPlane("YZ"): drawing (x,y) → (Y,Z), extrude(w) spans x ∈ [0, w]
//   sketchOnPlane("XY"): extrude goes +Z; makeBaseBox is XY-centred, z from 0

export interface Template {
  id: string;
  name: string;
  blurb: string; // one line on the card
  summary: string; // the chat line after it builds
  /** "cad" builds locally from `code` — instant, free, every dimension a live slider.
   *  "mesh" hands `prompt` to the generative engine: organic shapes CAD can't hold. */
  kind: "cad" | "mesh";
  code?: string;   // cad only
  prompt?: string; // mesh only
}

// Thumbnails are real in-app renders (assets/templates/<id>.webp), captured by the
// Playwright harness described in docs/HANDOFF.md. Missing files degrade to a cube mark.
const thumbs = import.meta.glob<string>("../assets/templates/*.webp", { eager: true, import: "default" });
export function templateThumb(id: string): string | undefined {
  return thumbs[`../assets/templates/${id}.webp`];
}

export const TEMPLATES: Template[] = [
  {
    id: "phone-stand",
    name: "Phone stand",
    blurb: "Angled desk stand with a cable slot",
    kind: "cad",
    summary:
      "A desk phone stand — 70 mm wide, leaning back 62°, with a lip to hold the phone and a slot for the charging cable. Drag the sliders to fit your phone, or just ask for changes.",
    code: `const defaultParams = { width: 70, seatDepth: 22, angle: 62, thickness: 9, lipHeight: 14, supportLength: 78, cableSlotWidth: 14 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { draw, makeBaseBox } = replicad;
  const a = (Math.min(80, Math.max(35, p.angle)) * Math.PI) / 180;
  const t = Math.max(4, p.thickness);
  const lip = Math.max(4, p.lipHeight);
  const seat = Math.max(t, p.seatDepth);
  const L = Math.max(30, p.supportLength);
  const D = seat + t; // support's inner face starts behind the seat
  const h = t / Math.sin(a); // horizontal cut of the leaning support's thickness
  const topIn = [D + L * Math.cos(a), t + L * Math.sin(a)];
  const back = D + h - t / Math.tan(a); // where the support's outer face meets the bed
  const profile = draw([0, 0])
    .lineTo([back, 0])
    .lineTo([topIn[0] + h, topIn[1]])
    .lineTo([topIn[0], topIn[1]])
    .lineTo([D, t])
    .lineTo([t * 0.66, t])
    .lineTo([t * 0.66, t + lip])
    .lineTo([0, t + lip])
    .close();
  let stand = profile.sketchOnPlane("XZ").extrude(p.width);
  // Charging-cable slot: a notch through the lip and the seat floor under it.
  const slotW = Math.min(p.width - 8, Math.max(6, p.cableSlotWidth));
  const slot = makeBaseBox(t * 0.66 + 12, slotW, t + lip + 2)
    .translate([(t * 0.66 + 12) / 2 - 2, -p.width / 2, -1]);
  return stand.cut(slot);
}`,
  },
  {
    id: "box-with-lid",
    name: "Box with lid",
    blurb: "Rounded box + friction-fit lid",
    kind: "cad",
    summary:
      "A 60 × 40 × 30 mm inside-dimension box with a friction-fit lid (printed beside it). clearance sets how snug the lid plug fits — 0.2 mm is a good FDM default. Want to try the lid on? Open the Objects panel and tap **Separate 2 parts** — then move the lid onto the box and tap **Check fit**.",
    code: `const defaultParams = { innerWidth: 60, innerDepth: 40, innerHeight: 30, wall: 2, lidThickness: 2.5, plugHeight: 5, clearance: 0.2, cornerRadius: 4 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRoundedRectangle } = replicad;
  const wall = Math.max(1.2, p.wall);
  const r = Math.max(wall + 0.5, p.cornerRadius);
  const outerW = p.innerWidth + 2 * wall;
  const outerD = p.innerDepth + 2 * wall;
  const outerH = p.innerHeight + wall;
  const box = drawRoundedRectangle(outerW, outerD, r)
    .sketchOnPlane("XY")
    .extrude(outerH)
    .shell(wall, (f) => f.inPlane("XY", outerH));
  const plug = drawRoundedRectangle(p.innerWidth - 2 * p.clearance, p.innerDepth - 2 * p.clearance, Math.max(0.4, r - wall - p.clearance))
    .sketchOnPlane("XY", p.lidThickness)
    .extrude(Math.max(2, p.plugHeight));
  const lid = drawRoundedRectangle(outerW, outerD, r)
    .sketchOnPlane("XY")
    .extrude(p.lidThickness)
    .fuse(plug)
    .translate([outerW + 12, 0, 0]);
  return box.fuse(lid);
}`,
  },
  {
    id: "desk-hook",
    name: "Headphone desk hook",
    blurb: "Thumbscrew clamps it to any desk",
    kind: "cad",
    summary:
      "A headphone hook that clamps to your desk with a printed thumbscrew — wind it up and the pad presses against the underside, so one hook fits any desktop from 15 to 45 mm and never slips. Drop the arm lower or lengthen the hook with the sliders.",
    code: `const defaultParams = { deskThickness: 25, clampDepth: 45, width: 22, thickness: 6, armDrop: 40, hookLength: 40, lipHeight: 12, screwDiameter: 12, screwTravel: 16 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRectangle, drawCircle, makeCylinder } = replicad;
  const t = Math.max(4, p.thickness);
  const D = Math.max(15, p.clampDepth);
  const drop = Math.max(10, p.armDrop);
  const H = Math.max(15, p.hookLength);
  const lip = Math.max(4, p.lipHeight);
  const travel = Math.max(6, p.screwTravel);          // how far the screw can wind up
  const throat = Math.max(10, p.deskThickness) + travel; // the jaw opening the desk sits in
  const boss = Math.max(8, p.screwDiameter) + 2 * 3;   // wall around the screw thread
  const rect = (w, h, cx, cz) => drawRectangle(w, h).translate(cx, cz);
  // Side profile: front face down the desk edge, top jaw on the desktop, bottom jaw
  // carrying the screw boss, then the hanger bar and its lip.
  const profile = rect(t, throat + drop + 2 * t, t / 2, (throat - drop) / 2)
    .fuse(rect(D + t, t, (t - D) / 2, throat + t / 2))
    .fuse(rect(0.8 * D + t, boss, (t - 0.8 * D) / 2, -boss / 2))
    .fuse(rect(H + t, t, (H + t) / 2, -(drop + t / 2)))
    .fuse(rect(t, lip + t, H + t / 2, -drop + (lip - t) / 2));
  let hook = profile.sketchOnPlane("XZ").extrude(p.width);
  // Screw hole up through the bottom boss. Printed M-thread is unreliable, so this is
  // a clearance bore for the printed screw below (or an M6 bolt and a nut).
  const bore = Math.max(6, p.screwDiameter);
  const cx = -(0.8 * D) / 2;
  hook = hook.cut(makeCylinder(bore / 2, boss + 4, [cx, -p.width / 2, -boss - 2], [0, 0, 1]));
  // The thumbscrew itself, printed beside the hook: a knurled-ish flanged knob + shaft.
  const knob = drawCircle(bore / 2 + 5).sketchOnPlane("XY").extrude(6)
    .fuse(makeCylinder(bore / 2 - 0.25, travel + 8, [0, 0, 6], [0, 0, 1]))
    .fuse(makeCylinder(bore / 2 + 2, 2.5, [0, 0, travel + 12], [0, 0, 1])) // pressure pad
    .translate([cx, p.width / 2 + bore + 12, 0]);
  return hook.fuse(knob);
}`,
  },
  {
    id: "bag-clip",
    name: "Squeeze bag clip",
    blurb: "Pinch the tails, jaws open, let go to grip",
    kind: "cad",
    summary:
      "A squeeze-to-open bag clip — pinch the two tails behind the loop and the jaws spring apart; let go and the padded tips clamp back onto the bag. One piece, prints flat, no assembly. A bigger loop makes a softer squeeze; more teeth grip a slipperier bag.",
    code: `const defaultParams = { jawLength: 52, tailLength: 20, width: 16, thickness: 3, springRadius: 6, mouth: 2, gripLength: 16, teeth: 4 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawCircle, drawRoundedRectangle } = replicad;
  const t = Math.max(2.2, p.thickness);
  const J = Math.max(24, p.jawLength);
  const T = Math.max(8, p.tailLength);
  const R = Math.max(3.5, p.springRadius);   // loop radius — this sets the spring rate
  const g = Math.max(1.2, p.mouth);          // gap at the tips, where the bag is pinched
  const grip = Math.min(J - 8, Math.max(6, p.gripLength));
  const yJaw = R + t / 2;                    // jaw centreline, tangent to the loop
  const padH = R - g / 2;                    // pad closing the mouth to the tip gap
  // A UNION of whole primitives — circles and rectangles — never a traced outline: every
  // boundary closes by construction, which is what keeps the solid watertight.
  let s2 = drawCircle(R + t).cut(drawCircle(R));
  s2 = s2.fuse(drawRoundedRectangle(J, t, t * 0.35).translate(J / 2, yJaw))
         .fuse(drawRoundedRectangle(J, t, t * 0.35).translate(J / 2, -yJaw))
         .fuse(drawRoundedRectangle(T, t, t * 0.35).translate(-T / 2 - R, yJaw))
         .fuse(drawRoundedRectangle(T, t, t * 0.35).translate(-T / 2 - R, -yJaw));
  if (padH > 0.4) {
    // Contact at the TIPS, like a clothes peg: the pads bring the faces together there
    // while the rest of the jaw stays open, so the squeeze has somewhere to go.
    s2 = s2.fuse(drawRoundedRectangle(grip, padH, 0.6).translate(J - grip / 2, g / 2 + padH / 2))
           .fuse(drawRoundedRectangle(grip, padH, 0.6).translate(J - grip / 2, -(g / 2 + padH / 2)));
  }
  const n = Math.min(8, Math.max(0, Math.round(p.teeth)));
  for (let i = 0; i < n; i++) {
    const x = J - grip + 3 + (i * Math.max(0, grip - 6)) / Math.max(1, n - 1);
    s2 = s2.fuse(drawRoundedRectangle(1.3, 1.1, 0.3).translate(x, g / 2 - 0.1))
           .fuse(drawRoundedRectangle(1.3, 1.1, 0.3).translate(x, -(g / 2 - 0.1)));
  }
  return s2.sketchOnPlane("XY").extrude(Math.max(8, p.width));
}`,
  },
  {
    id: "pen-holder",
    name: "Twisted pen holder",
    blurb: "Faceted desk pot with a spiral twist",
    kind: "cad",
    summary:
      "A desk pen pot with a twist — a faceted column that rotates as it rises, so it throws a different edge at you from every angle. Change the number of sides, how far it twists, or how tall it stands with the sliders.",
    code: `const defaultParams = { sides: 7, diameter: 82, height: 105, twist: 55, wall: 3, floor: 4 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawPolysides } = replicad;
  const n = Math.min(12, Math.max(3, Math.round(p.sides)));
  const r = Math.max(18, p.diameter / 2);
  const H = Math.max(40, p.height);
  const wall = Math.max(1.8, Math.min(r - 6, p.wall));
  const floor = Math.max(2.4, Math.min(H - 10, p.floor));
  // The twist is the extrusion's own, so the facets stay true ruled surfaces — the
  // inner bore twists by the SAME angle or the wall would vary in thickness as it rises.
  const twist = p.twist;
  const outer = drawPolysides(r, n, 0).sketchOnPlane("XY").extrude(H, { twistAngle: twist });
  const bore = drawPolysides(r - wall, n, 0).sketchOnPlane("XY", floor).extrude(H, { twistAngle: twist });
  return outer.cut(bore);
}`,
  },
  {
    id: "tolerance-coupon",
    name: "Tolerance test coupon",
    blurb: "Measure YOUR printer's real fit",
    kind: "cad",
    summary:
      "A fit-calibration coupon: six ⌀10 mm holes, each cut with a per-side gap from 0.05 to 0.55 mm (notches above a hole count its step: 1 notch = 0.05 mm, then +0.1 mm per extra notch) plus a ⌀10 test peg. Print it, push the peg into each hole, and note the TIGHTEST one it firmly fits — enter that number in Settings → Printer → Fit calibration, and every future snug/press/loose fit uses your printer's reality.",
    code: `const defaultParams = { pegDiameter: 10, startClearance: 0.05, step: 0.1, holes: 6, thickness: 6 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { makeBaseBox, makeCylinder } = replicad;
  const d = Math.max(4, p.pegDiameter);
  const n = Math.min(8, Math.max(3, Math.round(p.holes)));
  const t = Math.max(3, p.thickness);
  const pitch = d + 8;
  const W = n * pitch + 6;
  const H = d + 14;
  let plate = makeBaseBox(W, H, t);
  for (let i = 0; i < n; i++) {
    const cx = (i - (n - 1) / 2) * pitch;
    const c = p.startClearance + p.step * i;
    // c is the PER-SIDE gap, so the hole grows by 2c across the diameter — this is the
    // same number Settings and every future fit use.
    plate = plate.cut(makeCylinder(d / 2 + c, t + 2, [cx, 0, -1], [0, 0, 1]));
    // Notch code above each hole: 1 notch = the start clearance, +1 per step.
    for (let k = 0; k <= i; k++) {
      const nx = cx + (k - i / 2) * 1.8;
      plate = plate.cut(makeBaseBox(1, 2.4, 1.4).translate([nx, H / 2 - 0.8, t - 1.2]));
    }
  }
  // The test peg, printed beside the plate: same nominal size as the holes, with a
  // grip flange so it's easy to push and pull.
  const peg = makeCylinder(d / 2, t + 6, [-(W / 2 + d / 2 + 6), 0, 3], [0, 0, 1])
    .fuse(makeCylinder(d / 2 + 3, 3, [-(W / 2 + d / 2 + 6), 0, 0], [0, 0, 1]));
  return plate.fuse(peg);
}`,
  },
  // ---- Generative (AI mesh) templates -------------------------------------------
  // Organic shapes a parametric kernel cannot hold: these hand a well-formed prompt to
  // the mesh engine rather than building locally, so they cost a generation — the card
  // says so. Prompts are written the way the engines actually reward: subject first,
  // then silhouette, then the print constraints (flat base, no thin spurs).
  {
    id: "mesh-cat",
    name: "Sitting cat",
    blurb: "Smooth stylised cat figurine",
    kind: "mesh",
    summary: "A sitting cat figurine — smooth stylised forms, tail curled around the front paws.",
    prompt: "A stylised sitting cat figurine, smooth rounded forms, ears alert, tail curled around the front paws, flat stable base, no thin fragile parts, single solid piece for 3D printing",
  },
  {
    id: "mesh-dragon",
    name: "Dragon head trophy",
    blurb: "Wall-mount dragon bust",
    kind: "mesh",
    summary: "A dragon head wall trophy — horns swept back, flat mounting plate behind.",
    prompt: "A dragon head wall trophy mount, mouth closed, horns swept back along the skull, scaled brow ridges, flat vertical mounting plate at the back of the neck, chunky printable detail, single solid piece",
  },
  {
    id: "mesh-skull-planter",
    name: "Skull planter",
    blurb: "Hollow skull pot for succulents",
    kind: "mesh",
    summary: "A skull planter — the cranium opens into a bowl for a small succulent.",
    prompt: "A human skull planter, the top of the cranium opened into a smooth bowl cavity for a small succulent, stylised low detail, flat base so it stands level, thick walls, single solid piece for 3D printing",
  },
  {
    id: "mesh-knight",
    name: "Chess knight",
    blurb: "Carved horse-head knight",
    kind: "mesh",
    summary: "A chess knight — carved horse head on a round stepped base.",
    prompt: "A chess knight piece, carved horse head with a flowing mane, angled muzzle, round stepped base, classic Staunton proportions, smooth surfaces, single solid piece for 3D printing",
  },
  {
    id: "mesh-fox",
    name: "Low-poly fox",
    blurb: "Faceted origami-style fox",
    kind: "mesh",
    summary: "A low-poly fox — sharp flat facets, sitting with the tail wrapped round.",
    prompt: "A low-poly faceted fox, sitting pose with a big bushy tail wrapped around the paws, sharp flat triangular facets like folded paper, pointed ears and snout, flat base, single solid piece for 3D printing",
  },
  {
    id: "mesh-octopus",
    name: "Octopus desk buddy",
    blurb: "Curled tentacles, chunky and cute",
    kind: "mesh",
    summary: "An octopus desk ornament — round head, eight curled tentacles as the feet.",
    prompt: "A cute chunky octopus ornament, large round smooth head, big friendly eyes, eight thick tentacles curling outward and downward to form a stable base, no thin tips, single solid piece for 3D printing",
  },
];
