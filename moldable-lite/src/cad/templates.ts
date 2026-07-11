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
  code: string;
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
    id: "cable-clip",
    name: "Cable clip",
    blurb: "Snap-in clip with screw tabs",
    summary:
      "A cable clip for a 6 mm cable — the cable snaps in through the top opening, and the two tabs take 3 mm screws (or double-sided tape). Tune cableDiameter to your cable.",
    code: `const defaultParams = { cableDiameter: 6, wall: 2.4, length: 12, baseThickness: 2.5, tabLength: 9, screwHoleDiameter: 3.4 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawCircle, drawRectangle, makeCylinder } = replicad;
  const rIn = p.cableDiameter / 2 + 0.15; // FDM: cables should snap in, not fight
  const wall = Math.max(1.6, p.wall);
  const base = Math.max(1.6, p.baseThickness);
  const rOut = rIn + wall;
  const cz = base + rIn; // cable centre: cable rests on the base
  const opening = p.cableDiameter * 0.72; // narrower than the cable → snap fit
  const ring = drawCircle(rOut)
    .cut(drawCircle(rIn))
    .translate(0, cz)
    .cut(drawRectangle(opening, rOut + 2).translate(0, cz + (rOut + 2) / 2));
  const baseW = 2 * (rOut + Math.max(4, p.tabLength));
  const profile = ring.fuse(drawRectangle(baseW, base).translate(0, base / 2));
  let clip = profile.sketchOnPlane("XZ").extrude(p.length);
  const holeX = rOut + Math.max(4, p.tabLength) / 2;
  const hole = (x) => makeCylinder(p.screwHoleDiameter / 2, base + 2, [x, -p.length / 2, -1], [0, 0, 1]);
  return clip.cut(hole(-holeX)).cut(hole(holeX));
}`,
  },
  {
    id: "wall-hook",
    name: "Wall hook",
    blurb: "J-hook on a screw-mount plate",
    summary:
      "A wall hook — a 30 × 70 mm back plate with two screw holes and a rounded J-hook that reaches 34 mm out. Prints flat on its back, no supports.",
    code: `const defaultParams = { plateWidth: 30, plateHeight: 70, plateThickness: 4, hookWidth: 18, hookReach: 34, innerRadius: 10, tipHeight: 16, thickness: 6, screwHoleDiameter: 4.4 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRoundedRectangle, drawCircle, draw } = replicad;
  const t = Math.max(3, p.thickness);
  const rIn = Math.max(3, p.innerRadius);
  const rOut = rIn + t;
  const reach = Math.max(rOut + 2, p.hookReach);
  const tip = Math.max(4, p.tipHeight);
  const holeY = p.plateHeight / 2 - 8;
  const plate = drawRoundedRectangle(p.plateWidth, p.plateHeight, 3)
    .cut(drawCircle(p.screwHoleDiameter / 2).translate(0, holeY))
    .cut(drawCircle(p.screwHoleDiameter / 2).translate(0, -holeY))
    .sketchOnPlane("XY")
    .extrude(p.plateThickness);
  // J profile in the YZ plane: drawing x = up the plate, drawing y = out of the wall.
  const u0 = -t / 2;
  const profile = draw([u0, -1])
    .lineTo([u0, reach - rOut])
    .threePointsArc(rOut, rOut, 0.2929 * rOut, 0.7071 * rOut)
    .lineTo([u0 + rOut + tip, reach])
    .lineTo([u0 + rOut + tip, reach - t])
    .lineTo([u0 + rOut, reach - t])
    .threePointsArc(-rIn, -rIn, -0.7071 * rIn, -0.2929 * rIn)
    .lineTo([u0 + t, -1])
    .close();
  const hook = profile
    .sketchOnPlane("YZ")
    .extrude(p.hookWidth)
    .translate([-p.hookWidth / 2, 0, p.plateThickness]); // profile starts at v=-1 → embeds 1 mm into the plate
  return plate.fuse(hook);
}`,
  },
  {
    id: "box-with-lid",
    name: "Box with lid",
    blurb: "Rounded box + friction-fit lid",
    summary:
      "A 60 × 40 × 30 mm inside-dimension box with a friction-fit lid (printed beside it). clearance sets how snug the lid plug fits — 0.2 mm is a good FDM default.",
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
    blurb: "Clamps a desk edge, no screws",
    summary:
      "A headphone hook that clamps over a desk edge — set deskThickness to your desktop (it adds 0.4 mm clearance) and it grips with no screws. The lower arm hangs headphones or a bag.",
    code: `const defaultParams = { deskThickness: 25, clampDepth: 45, width: 22, thickness: 6, armDrop: 40, hookLength: 40, lipHeight: 12, clearance: 0.4 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRectangle } = replicad;
  const t = Math.max(4, p.thickness);
  const dt = p.deskThickness + p.clearance; // the desk slides in here
  const D = Math.max(15, p.clampDepth);
  const drop = Math.max(10, p.armDrop);
  const H = Math.max(15, p.hookLength);
  const lip = Math.max(4, p.lipHeight);
  const rect = (w, h, cx, cz) => drawRectangle(w, h).translate(cx, cz);
  const profile = rect(t, dt + drop + 2 * t, t / 2, (dt - drop) / 2) // front face wrapping the edge
    .fuse(rect(D + t, t, (t - D) / 2, dt + t / 2)) // top jaw, resting on the desk
    .fuse(rect(0.7 * D + t, t, (t - 0.7 * D) / 2, -t / 2)) // bottom jaw, under the desk
    .fuse(rect(H + t, t, (H + t) / 2, -(drop + t / 2))) // hanger bar
    .fuse(rect(t, lip + t, H + t / 2, -drop + (lip - t) / 2)); // lip so things can't slide off
  return profile.sketchOnPlane("XZ").extrude(p.width);
}`,
  },
  {
    id: "plant-pot",
    name: "Plant pot",
    blurb: "Tapered pot with drainage holes",
    summary:
      "A tapered plant pot — 95 mm across the top, 85 mm tall, with four drainage holes in the floor. Resize it with the sliders; wall and floor stay printable.",
    code: `const defaultParams = { topDiameter: 95, bottomDiameter: 65, height: 85, wall: 2.4, floor: 3.5, drainHoles: 4, drainHoleDiameter: 8 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { draw, makeCylinder } = replicad;
  const rT = Math.max(15, p.topDiameter / 2);
  const rB = Math.min(rT, Math.max(12, p.bottomDiameter / 2));
  const wall = Math.max(1.6, p.wall);
  const floor = Math.max(2, p.floor);
  const profile = draw([0, 0])
    .lineTo([rB, 0])
    .lineTo([rT, p.height])
    .lineTo([rT - wall, p.height])
    .lineTo([rB - wall, floor])
    .lineTo([0, floor])
    .close();
  let pot = profile.sketchOnPlane("XZ").revolve();
  const n = Math.min(8, Math.max(1, Math.round(p.drainHoles)));
  const ringR = Math.max(0, rB - wall - p.drainHoleDiameter / 2 - 2) * 0.6;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI;
    pot = pot.cut(makeCylinder(p.drainHoleDiameter / 2, floor + 2, [Math.cos(ang) * ringR, Math.sin(ang) * ringR, -1], [0, 0, 1]));
  }
  return pot;
}`,
  },
  {
    id: "coaster",
    name: "Coaster",
    blurb: "Hex coaster with a drip recess",
    summary:
      "A hexagonal coaster, 95 mm across, with a raised rim and a shallow recess to catch drips. sides changes the shape (6 = hex, 8 = octagon…), rimWidth and recessDepth tune the rest.",
    code: `const defaultParams = { diameter: 95, height: 8, rimWidth: 5, recessDepth: 2, sides: 6 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawPolysides } = replicad;
  const n = Math.min(12, Math.max(3, Math.round(p.sides)));
  const h = Math.max(3, p.height);
  const recess = Math.min(h - 2, Math.max(0.6, p.recessDepth));
  const R = p.diameter / 2;
  const rIn = Math.max(10, R - Math.max(2, p.rimWidth));
  const body = drawPolysides(R, n).fillet(3).sketchOnPlane("XY").extrude(h);
  const pocket = drawPolysides(rIn, n).fillet(3).sketchOnPlane("XY", h - recess).extrude(recess + 1);
  return body.cut(pocket).chamfer(0.8, (e) => e.inPlane("XY", h));
}`,
  },
  {
    id: "bag-clip",
    name: "Bag clip",
    blurb: "Slide-on clip keeps bags fresh",
    summary:
      "A slide-on bag clip — fold the bag over, slide the clip on. 90 mm long with a 1.6 mm slot and a flared mouth so it starts easily. Print a few!",
    code: `const defaultParams = { length: 90, slotGap: 1.6, wall: 3, slotDepth: 14, flare: 2 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRoundedRectangle, draw } = replicad;
  const wall = Math.max(2, p.wall);
  const gap = Math.max(0.8, p.slotGap);
  const depth = Math.max(6, p.slotDepth);
  const W = gap + 2 * wall;
  const H = depth + wall;
  const flare = Math.max(0.5, p.flare);
  const mouth = draw([-gap / 2 - flare, H / 2 + 1])
    .lineTo([gap / 2 + flare, H / 2 + 1])
    .lineTo([gap / 2, H / 2 - 2.5 * flare])
    .lineTo([-gap / 2, H / 2 - 2.5 * flare])
    .close();
  const profile = drawRoundedRectangle(W, H, Math.min(1.5, wall * 0.5))
    .cut(drawRoundedRectangle(gap, depth * 2, 0.4).translate(0, H / 2)) // slot, overshooting the top
    .cut(mouth);
  return profile.sketchOnPlane("YZ").extrude(p.length);
}`,
  },
  {
    id: "cable-winder",
    name: "Earbud / cable winder",
    blurb: "Bone-shaped tidy for loose cables",
    summary:
      "A pocket cable winder — wrap earbuds or a spare cable around the waist, and the 4.5 mm hole takes a keyring. length and notchDepth set how much cable it swallows.",
    code: `const defaultParams = { length: 78, width: 32, thickness: 5, notchWidth: 26, notchDepth: 9, cornerRadius: 6, keyringHoleDiameter: 4.5 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRoundedRectangle, drawCircle } = replicad;
  const nw = Math.min(p.length - 20, Math.max(8, p.notchWidth));
  const nd = Math.min(p.width / 2 - 5, Math.max(3, p.notchDepth));
  const notch = drawRoundedRectangle(nw, 2 * nd, Math.min(nd * 0.9, nw / 2 - 0.5));
  return drawRoundedRectangle(p.length, p.width, p.cornerRadius)
    .cut(notch.translate(0, p.width / 2))
    .cut(notch.translate(0, -p.width / 2))
    .cut(drawCircle(p.keyringHoleDiameter / 2).translate(p.length / 2 - 7, 0))
    .sketchOnPlane("XY")
    .extrude(Math.max(2.5, p.thickness));
}`,
  },
  {
    id: "spacer",
    name: "Washer / spacer",
    blurb: "Any size, chamfered, in seconds",
    summary:
      "A 12 mm washer/spacer with a 5.3 mm bore (M5 clearance) and a chamfered top edge. Three sliders — outer, bore, height — cover almost any spacing job.",
    code: `const defaultParams = { outerDiameter: 12, boreDiameter: 5.3, height: 6 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { makeCylinder } = replicad;
  const rOut = Math.max(2, p.outerDiameter / 2);
  const rIn = Math.min(rOut - 1, Math.max(0.75, p.boreDiameter / 2));
  const h = Math.max(1, p.height);
  return makeCylinder(rOut, h, [0, 0, 0], [0, 0, 1])
    .cut(makeCylinder(rIn, h + 2, [0, 0, -1], [0, 0, 1]))
    .chamfer(Math.min(0.6, h / 4, (rOut - rIn) / 3), (e) => e.inPlane("XY", h));
}`,
  },
];
