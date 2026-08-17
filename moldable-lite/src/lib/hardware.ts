// Real-world hardware the printed part has to fit around: bearings, nuts, washers,
// extrusion, board outlines, pins, rail, connectors.
//
// This exists because asking the model to look a dimension up mid-generation fails
// quietly. A web search costs seconds the user watches tick by, and when it comes back
// empty the model doesn't stop — it writes a number that reads like a spec and isn't
// one. A 608 pocket bored to 21.5 instead of 22 is a part you only discover is wrong
// after the print. A table can be checked once; a guess can't be checked at all.
//
// EVERY FIGURE HERE IS THE NOMINAL PART DIMENSION — the size of the metal, straight
// off the standard or the datasheet. Nothing is pre-clearanced. A 608's outer diameter
// is 22 mm because ISO 15 says so; that 22 is a press fit into machined steel and would
// be an unprintable interference fit in PLA, which is exactly why the fit decision does
// not live here. Diameters go through bore() in fit.ts on the way to geometry, and the
// user's Tolerance coupon decides what 22 means on their machine. Bake a clearance in
// here and it gets applied twice.
//
// `verified` is the trust field, and it is inverted on purpose: an entry with no
// `verified` key had every number below it confirmed against a published standard, a
// manufacturer drawing, or an official mechanical drawing. `verified: false` means at
// least one figure in that row could not be confirmed, and the note says which one and
// why. There is no third state — nothing was added because it looked plausible. Rows
// that could not be sourced at all were left out rather than filled in, so gaps in this
// table are real gaps, not oversights.
//
// Licensing: these are dimensions transcribed from published standards (ISO 15,
// ISO 4032 / DIN 934, DIN 985, DIN 125 / ISO 7089, ISO 2338, EN 60715), from vendor
// datasheets, and from the open mechanical drawings the boards' own makers publish.
// Nothing was lifted from a GPL parts library — measurements of a standard part are
// facts about the part, and the ones below were re-derived from the source documents
// so this file carries no copyleft with it.

/** Shared spine of every row. `verified` is absent on a confirmed entry and can only
 *  be set to false — see the header for why there is no `verified: true`. */
export interface Part {
  id: string;
  label: string;
  /** Extra names lookupHardware() answers to, beyond id and label. */
  aka?: string[];
  /** Present only when a figure in this row is unconfirmed. Read the note. */
  verified?: false;
  note?: string;
}

// ---------------------------------------------------------------------------
// Deep-groove ball bearings
// ---------------------------------------------------------------------------
// Designations follow ISO 15: the last two digits times five give the bore for the
// 60xx/62xx/68xx/69xx families (6201 → 12 mm), while the 6xx miniatures (608, 623)
// spell the bore out directly. The MR series is a metric miniature line outside ISO 15
// and its width changes with the closure — an open MR105 is 3 mm wide, the shielded
// MR105ZZ everyone actually buys is 4. The number below is the ZZ.
//
// For the ISO families the seal code does not move the envelope: 608, 608ZZ and
// 608-2RS are all 8×22×7, so a pocket cut to this table takes whichever the user has.
//
// A bearing's OD is a press fit in a metal housing. In printed plastic that same press
// fit splits the boss; the working approach is a pocket at nominal with fit.ts holding
// the allowance, and a shoulder that touches only the OUTER race so the bore stays free
// to turn.
//
// source: https://us.misumi-ec.com/blog/ball-bearings/deep-groove/6201-ball-bearings-12x32x10mm-z-zz-2rs/
// source: https://www.qualitybearingsonline.com/6802-skf-deep-groove-bearings-15x24x5mm/
// source: https://bearingsdirect.com/mr105-zz-precision-mini-ball-bearing-5x10x4-shielded-l-1050zz/

export interface Bearing extends Part {
  d: number;        // bore (shaft) diameter
  D: number;        // outer diameter — the pocket
  B: number;        // width
  flangeD?: number; // flanged types: flange outer diameter
  flangeT?: number; // flanged types: flange thickness
}

export const BEARINGS: Bearing[] = [
  { id: "623", label: "623", d: 3, D: 10, B: 4, aka: ["623zz", "623-2rs"] },
  { id: "624", label: "624", d: 4, D: 13, B: 5, aka: ["624zz", "624-2rs"] },
  { id: "625", label: "625", d: 5, D: 16, B: 5, aka: ["625zz", "625-2rs"] },
  { id: "626", label: "626", d: 6, D: 19, B: 6, aka: ["626zz", "626-2rs"] },
  { id: "608", label: "608", d: 8, D: 22, B: 7, aka: ["608zz", "608-2rs", "skate bearing", "skateboard bearing"], note: "the skateboard bearing — the one most makers own" },
  { id: "6000", label: "6000", d: 10, D: 26, B: 8, aka: ["6000zz", "6000-2rs"] },
  { id: "6001", label: "6001", d: 12, D: 28, B: 8, aka: ["6001zz", "6001-2rs"] },
  { id: "6002", label: "6002", d: 15, D: 32, B: 9, aka: ["6002zz", "6002-2rs"] },
  { id: "6200", label: "6200", d: 10, D: 30, B: 9, aka: ["6200zz", "6200-2rs"] },
  { id: "6201", label: "6201", d: 12, D: 32, B: 10, aka: ["6201zz", "6201-2rs"] },
  { id: "6802", label: "6802", d: 15, D: 24, B: 5, aka: ["6802zz", "6802-2rs"], note: "thin-section — 5 mm wide, so the boss around it needs the depth, not the part" },
  { id: "6902", label: "6902", d: 15, D: 28, B: 7, aka: ["6902zz", "6902-2rs"] },
  { id: "mr105", label: "MR105ZZ", d: 5, D: 10, B: 4, aka: ["mr105", "mr105zz", "mr105-2rs"], note: "B is the shielded ZZ; the open MR105 is 3 mm wide" },
  { id: "mr126", label: "MR126ZZ", d: 6, D: 12, B: 4, aka: ["mr126", "mr126zz", "mr126-2rs"], note: "B is the shielded ZZ; the open MR126 is 3 mm wide" },
  {
    id: "f688", label: "F688ZZ", d: 8, D: 16, B: 5, flangeD: 18, flangeT: 1.1,
    aka: ["f688", "f688zz", "mf688zz"],
    verified: false,
    note: "8×16×5 agrees across every distributor; the ⌀18 flange and 1.1 mm flange thickness came from one distributor spec sheet, not an AMASS/NMB drawing — measure the flange before you rely on it locating anything",
  },
];

// ---------------------------------------------------------------------------
// Hex nuts
// ---------------------------------------------------------------------------
// A captive-nut pocket is cut from `s` and `m`: a hexagonal (or slotted) recess the
// across-flats wide and the thickness deep, so the nut drops in and the screw pulls it
// against the far wall instead of spinning. `e` is the across-corners and it is the
// number that decides whether the pocket clears the corners at all — it is the minimum
// per the standard, so a real nut is never bigger than this.
//
// DIN 934 and ISO 4032 are the same nut up to M4 and diverge above it: ISO raised the
// height to buy thread engagement, so an ISO M5 is 4.7 mm where the DIN M5 is 4.0.
// Bagged maker hardware is sold as either, often mislabelled. `m` below is the ISO 4032
// maximum and `mDin934` the older figure — cut the pocket to `m` and both nuts sit in
// it; cut it to `mDin934` and half the world's M5 nuts stand proud.
//
// `nyloc` is the TOTAL height of the DIN 985 nylon-insert version including the collar,
// which is what a pocket has to swallow. The nylon ring is why it is so much taller
// than the plain nut, and why a pocket sized for a plain M5 will not take a nyloc.
//
// source: https://fullerfasteners.com/tech/iso-4032-specifications-hex-regular-nuts/
// source: https://www.westfieldfasteners.co.uk/Standards/Nut_Hex_M.pdf
// source: https://www.westfieldfasteners.co.uk/Standards/Nut-HexNy-M.pdf

export interface HexNut extends Part {
  thread: number;   // nominal thread diameter
  s: number;        // width across flats (max) — the pocket width
  e: number;        // width across corners (min per standard)
  m: number;        // thickness, ISO 4032 max — the pocket depth
  mDin934?: number; // DIN 934 thickness where it differs from ISO 4032
  nyloc?: number;   // DIN 985 nylon-insert nut, total height including the collar
}

export const HEX_NUTS: HexNut[] = [
  { id: "m2", label: "M2", thread: 2, s: 4, e: 4.32, m: 1.6 },
  { id: "m2_5", label: "M2.5", thread: 2.5, s: 5, e: 5.45, m: 2.0 },
  { id: "m3", label: "M3", thread: 3, s: 5.5, e: 6.01, m: 2.4, nyloc: 4.0 },
  { id: "m4", label: "M4", thread: 4, s: 7, e: 7.66, m: 3.2, nyloc: 5.0 },
  { id: "m5", label: "M5", thread: 5, s: 8, e: 8.79, m: 4.7, mDin934: 4.0, nyloc: 5.0 },
  { id: "m6", label: "M6", thread: 6, s: 10, e: 11.05, m: 5.2, mDin934: 5.0, nyloc: 6.0 },
  { id: "m8", label: "M8", thread: 8, s: 13, e: 14.38, m: 6.8, mDin934: 6.5, nyloc: 8.0 },
];
// M2 and M2.5 carry no nyloc figure: DIN 985 is catalogued from M3 up and the sub-M3
// lock nuts on sale are unstandardised, so there is nothing here to be right about.

// ---------------------------------------------------------------------------
// Square nuts
// ---------------------------------------------------------------------------
// The square nut is the better captive nut when the pocket is a slot rather than a
// hexagon — two flat walls hold it against the driving torque and it cannot rotate into
// a corner the way a hex nut does in a sloppy hex recess.
//
// Two standards, and the thickness is the whole difference: DIN 562 is the thin one
// (the flat nut that hides inside a 3 mm wall), DIN 557 the regular. Same across-flats.
//
// source: https://fullerfasteners.com/tech/din-562-specifications-sqaure-thin-nuts/
// source: https://fullerfasteners.com/tech/din-557-specifications-square-nuts/

export interface SquareNut extends Part {
  thread: number;
  standard: "DIN 562" | "DIN 557";
  s: number; // across flats (max) — the slot width
  m: number; // thickness (max) — the slot depth
}

export const SQUARE_NUTS: SquareNut[] = [
  { id: "sq_m3_562", label: "M3 square (thin)", thread: 3, standard: "DIN 562", s: 5.5, m: 1.8, aka: ["m3 square nut", "m3 square"] },
  { id: "sq_m4_562", label: "M4 square (thin)", thread: 4, standard: "DIN 562", s: 7, m: 2.2, aka: ["m4 square nut", "m4 square"] },
  { id: "sq_m5_562", label: "M5 square (thin)", thread: 5, standard: "DIN 562", s: 8, m: 2.7, aka: ["m5 square nut", "m5 square"] },
  { id: "sq_m6_562", label: "M6 square (thin)", thread: 6, standard: "DIN 562", s: 10, m: 3.2, aka: ["m6 square nut", "m6 square"] },
  { id: "sq_m5_557", label: "M5 square", thread: 5, standard: "DIN 557", s: 8, m: 4.0, aka: ["m5 square nut din 557", "m5 din 557"] },
  { id: "sq_m6_557", label: "M6 square", thread: 6, standard: "DIN 557", s: 10, m: 5.0, aka: ["m6 square nut din 557", "m6 din 557"] },
  // A bare "M5 square nut" resolves to the DIN 562 thin one above: it is the shallower
  // pocket, so a part cut for it is the one that still fits if the user turns up with
  // the other. The DIN 557 rows answer only when the standard is named.
];
// DIN 557 M3 and M4 are missing on purpose — the M5/M6 rows above came out of a
// published table and the smaller two did not, so they are not here.

// ---------------------------------------------------------------------------
// Plain washers
// ---------------------------------------------------------------------------
// Form A, the ordinary punched washer. `od` sets how wide a counterbore or a boss face
// has to be before the washer overhangs it, and `t` is what the screw loses in grip
// length. Note `bore` runs well over the thread — an M5 washer's hole is 5.3 — which is
// the difference between a washer and a spacer.
//
// DIN 125 A and ISO 7089 are dimensionally the same washer at these sizes.
//
// source: https://fullerfasteners.com/tech/din-125-specifications-flat-washer-normal-series/
// source: https://www.engineersedge.com/hardware/metric_flat_washers_specification_din_125_13690.htm

export interface Washer extends Part {
  thread: number;
  bore: number; // inner diameter
  od: number;   // outer diameter
  t: number;    // thickness
}

export const WASHERS: Washer[] = [
  {
    id: "w_m2", label: "M2 washer", thread: 2, bore: 2.2, od: 5, t: 0.3,
    verified: false,
    note: "the 2.2 bore is confirmed; the ⌀5 outer and 0.3 thickness were not found in a published table this session",
  },
  { id: "w_m2_5", label: "M2.5 washer", thread: 2.5, bore: 2.7, od: 6, t: 0.5 },
  { id: "w_m3", label: "M3 washer", thread: 3, bore: 3.2, od: 7, t: 0.5 },
  { id: "w_m4", label: "M4 washer", thread: 4, bore: 4.3, od: 9, t: 0.8 },
  { id: "w_m5", label: "M5 washer", thread: 5, bore: 5.3, od: 10, t: 1.0 },
  { id: "w_m6", label: "M6 washer", thread: 6, bore: 6.4, od: 12, t: 1.6 },
  { id: "w_m8", label: "M8 washer", thread: 8, bore: 8.4, od: 16, t: 1.6 },
];

// ---------------------------------------------------------------------------
// Aluminium extrusion
// ---------------------------------------------------------------------------
// Four numbers do the work when you print a bracket for extrusion:
//
//  slot      the THROAT — the narrowest part of the opening, what a drop-in nut has to
//            pass through and what a printed tab has to be thinner than. On V-slot the
//            face itself opens wider (a 45° vee) before it necks to this.
//  slotInner the widest part of the channel behind the throat, where the nut sits.
//  slotLip   material between the outer face and the roof of that channel — the
//            thickness a T-nut clamps against, so it sets how hard you can pull.
//  slotDepth outer face down to the back of the slot cavity.
//
// The 20-series V-slot rows are read straight off OpenBuilds' own profile DXFs, so the
// throat is 6.25 and not the 6.2 the shops round it to, and the outer corners carry a
// 0.5 mm radius that a snug printed clamp has to allow for.
//
// The 30- and 40-series rows are the honest weak spot. Profile size and slot width are
// universal, but the centre bore is a per-manufacturer decision (a 40-series bore
// pre-drilled for an M8 end tap is not the same hole as the bigger bores some vendors
// extrude), and published slot depths disagree. Those rows are marked; measure before
// you print a part that plugs into the bore.
//
// source: https://raw.githubusercontent.com/richard-scott/OpenBuilds/master/V-Slot%2020x20.dxf
// source: https://raw.githubusercontent.com/richard-scott/OpenBuilds/master/V-Slot%2020x40.dxf
// source: https://us.misumi-ec.com/pdf/fa/2012/p2_0511.pdf

export interface Extrusion extends Part {
  family: "v-slot" | "t-slot";
  w: number;          // profile width
  h: number;          // profile height
  slot: number;       // throat width — the opening a drop-in nut passes through
  slotInner?: number; // channel width behind the throat
  slotLip?: number;   // face to the roof of the channel
  slotDepth?: number; // face to the back of the slot cavity
  bore: number;       // centre bore diameter
  /** Bore centres as [x, y] from the profile's corner, profile spanning w × h. */
  bores: [number, number][];
  cornerR?: number;   // outer corner radius
}

export const EXTRUSIONS: Extrusion[] = [
  {
    id: "2020_v", label: "2020 V-slot", family: "v-slot",
    w: 20, h: 20, slot: 6.25, slotInner: 11.0, slotLip: 1.8, slotDepth: 6.1,
    bore: 4.2, bores: [[10, 10]], cornerR: 0.5,
    aka: ["2020", "2020 vslot", "2020 extrusion", "20x20 v-slot", "v-slot 2020", "openbuilds 2020"],
    note: "the printer-frame default; the ⌀4.2 bore is the M5 end-tap hole and also takes an M3 heat-set insert. A bare \"2020\" resolves here rather than to the T-slot row — it is what a printer owner means, and the two differ only in the throat",
  },
  {
    id: "2040_v", label: "2040 V-slot", family: "v-slot",
    w: 20, h: 40, slot: 6.25, slotInner: 11.0, slotLip: 1.8, slotDepth: 6.1,
    bore: 4.2, bores: [[10, 10], [10, 30]], cornerR: 0.5,
    aka: ["2040", "2040 vslot", "2040 extrusion", "20x40 v-slot", "v-slot 2040"],
    note: "two bores on 20 mm centres, each 10 mm in from a short end",
  },
  {
    id: "2020_t", label: "2020 T-slot", family: "t-slot",
    w: 20, h: 20, slot: 6.0, bore: 4.2, bores: [[10, 10]],
    aka: ["20x20 t-slot", "hfs5-2020", "misumi 2020", "20 series"],
    verified: false,
    note: "6 mm slot and ⌀4.2 bore are Misumi HFS5-2020; slot depth, channel width and corner radius were not confirmed and are omitted rather than guessed",
  },
  {
    id: "2040_t", label: "2040 T-slot", family: "t-slot",
    w: 20, h: 40, slot: 6.0, bore: 4.2, bores: [[10, 10], [10, 30]],
    aka: ["20x40 t-slot", "hfs5-2040", "misumi 2040"],
    verified: false,
    note: "slot and bore inherited from the confirmed 2020 5-series profile; the two-bore layout matches the V-slot 2040 but was not confirmed against a Misumi drawing",
  },
  {
    id: "3030_t", label: "3030 T-slot", family: "t-slot",
    w: 30, h: 30, slot: 8.0, slotDepth: 9.0, bore: 6.8, bores: [[15, 15]],
    aka: ["30x30", "3030", "30 series"],
    verified: false,
    note: "8 mm slot is universal; the ⌀6.8 bore and 9 mm slot depth came from a single vendor page. V-slot 3030 exists with an 8.2 mm throat",
  },
  {
    id: "4040_t", label: "4040 T-slot", family: "t-slot",
    w: 40, h: 40, slot: 8.0, slotDepth: 12.0, bore: 6.8, bores: [[20, 20]],
    aka: ["40x40", "4040", "40 series"],
    verified: false,
    note: "8 mm slot is universal; the centre bore is the real uncertainty — ⌀6.8 (drilled for an M8 end tap) is the common figure but larger bores are sold under the same name. Measure it",
  },
];

// ---------------------------------------------------------------------------
// T-nuts / drop-in nuts
// ---------------------------------------------------------------------------
// These are the least standardised parts in the whole file. Every seller's "M5 drop-in
// T-nut for 2020" is a slightly different lump of zinc-plated steel — bodies between
// 9.7 and 10.3 long, 4.5 and 5 thick, some with a spring ball, some without — and the
// numbers below are the middle of that spread, not a specification.
//
// So all three rows are marked, and the useful thing to design against is not the nut
// at all: it is the slot it sits in, which IS specified (see EXTRUSIONS). A printed
// part that clears the extrusion's throat and channel will accept whatever nut the user
// bought; a part cut to a particular vendor's nut will not.
//
// source: https://www.tnutz.com/product/db-020a-m5/

export interface TSlotNut extends Part {
  thread: number;
  slot: number;      // slot width the nut is made for
  len: number;       // body length along the slot
  width: number;     // body width across the slot
  thickness: number; // body thickness
}

export const TSLOT_NUTS: TSlotNut[] = [
  {
    id: "tnut_m3_20", label: "M3 drop-in T-nut (20 series)", thread: 3, slot: 6,
    len: 10, width: 6, thickness: 5,
    aka: ["m3 t-nut", "m3 tnut", "m3 t nut", "m3 drop-in", "m3 drop-in nut", "m3 t slot nut"],
    verified: false,
    note: "vendor-to-vendor spread of roughly ±0.5 mm on every dimension; design to the slot, not to this",
  },
  {
    id: "tnut_m4_20", label: "M4 drop-in T-nut (20 series)", thread: 4, slot: 6,
    len: 10, width: 6, thickness: 5,
    aka: ["m4 t-nut", "m4 tnut", "m4 t nut", "m4 drop-in", "m4 drop-in nut", "m4 t slot nut"],
    verified: false,
    note: "vendor-to-vendor spread of roughly ±0.5 mm on every dimension; design to the slot, not to this",
  },
  {
    id: "tnut_m5_20", label: "M5 drop-in T-nut (20 series)", thread: 5, slot: 6,
    len: 10, width: 6, thickness: 5,
    aka: ["m5 t-nut", "m5 tnut", "m5 t nut", "m5 drop-in", "m5 drop-in nut", "m5 t slot nut", "t nut"],
    verified: false,
    note: "the common one. Listings quote 10.3×6×5 and 9.7×9.8×4.5 for the same part number family — design to the slot, not to this",
  },
];

// ---------------------------------------------------------------------------
// Single-board computer outlines
// ---------------------------------------------------------------------------
// A case is its hole pattern. `holes` are hole CENTRES as [x, y] millimetres from one
// board corner, with the board lying `length` along x and `width` along y — feed them
// straight into a boss array.
//
// Which corner: for the Raspberry Pi rows it is the corner at the power/microSD end,
// which is the end the holes sit 3.5 mm in from. The remaining 23.5 mm of board past
// the second hole row is the USB/Ethernet end, and getting this backwards puts every
// boss under a port. The Zero's pattern is symmetric, so its origin does not matter.
// The Arduino Uno's origin is the lower-left corner of its official outline drawing,
// USB and barrel jack on the left.
//
// The Pi hole is ⌀2.7 and takes an M2.5 — do not read the 2.7 as a thread size.
//
// source: https://datasheets.raspberrypi.com/rpi5/raspberry-pi-5-mechanical-drawing.pdf
// source: https://datasheets.raspberrypi.com/rpizero/raspberry-pi-zero-mechanical-drawing.pdf
// source: https://raw.githubusercontent.com/newmatik-old/uno/master/UNO-TH_Rev3e_Outlines-CAD.dxf
// source: https://docs.arduino.cc/hardware/nano
// source: https://www.espboards.dev/esp32/esp32-devkitc/

export interface Board extends Part {
  length: number;  // long edge (x)
  width: number;   // short edge (y)
  holeD?: number;  // mounting hole diameter
  /** Hole centres as [x, y] from the datum corner. Empty when the board has none. */
  holes: [number, number][];
  thickness?: number; // PCB thickness where it is published
}

export const BOARDS: Board[] = [
  {
    id: "rpi5", label: "Raspberry Pi 5", length: 85, width: 56, holeD: 2.7,
    holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]],
    aka: ["pi 5", "pi5", "raspberry pi 5", "rpi 5"],
    note: "58 × 49 mm hole rectangle — the same pattern every Pi HAT is drilled to",
  },
  {
    id: "rpi4b", label: "Raspberry Pi 4B", length: 85, width: 56, holeD: 2.7,
    holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]],
    aka: ["pi 4", "pi4", "pi 4b", "raspberry pi 4", "rpi 4", "rpi4b"],
    note: "same outline and hole pattern as the Pi 5 — only the port positions moved",
  },
  {
    id: "rpi3bplus", label: "Raspberry Pi 3B+", length: 85, width: 56, holeD: 2.7,
    holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]],
    aka: ["pi 3", "pi3", "pi 3b+", "pi 3b plus", "raspberry pi 3", "rpi 3"],
    note: "older Pi documentation quotes the hole as ⌀2.75 ±0.05 rather than ⌀2.7; either way it is an M2.5 clearance hole",
  },
  {
    id: "rpizero", label: "Raspberry Pi Zero / Zero 2 W", length: 65, width: 30, holeD: 2.75,
    holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 26.5], [61.5, 26.5]],
    aka: ["pi zero", "pizero", "zero 2 w", "pi zero 2", "pi zero w", "rpi zero"],
    note: "58 × 23 mm hole rectangle; Zero, Zero W and Zero 2 W share one outline",
  },
  {
    id: "uno", label: "Arduino Uno R3", length: 68.6, width: 53.3, holeD: 3.2,
    holes: [[13.97, 2.54], [15.24, 50.8], [66.04, 35.56], [66.04, 7.62]],
    aka: ["uno", "arduino uno", "uno r3", "arduino uno r3", "arduino"],
    note: "holes are on no grid and are not symmetric — that irregularity is the Uno's actual pattern, taken from Arduino's own Rev3e outline DXF (which reads 68.535 × 53.300). The outline is not a plain rectangle: there is a step near the header end that this row does not describe",
  },
  {
    id: "nano", label: "Arduino Nano", length: 45, width: 18, holes: [],
    aka: ["nano", "arduino nano"],
    verified: false,
    note: "45 × 18 is Arduino's published figure. Mounting holes are the uncertainty: the classic Nano has none, some clones and later revisions add four, and sources disagree on whether they are ⌀2 or ⌀3.2 — so none are listed",
  },
  {
    id: "esp32_devkitc", label: "ESP32-DevKitC V4", length: 55.3, width: 28.0, holes: [],
    thickness: 12.9,
    aka: ["devkitc", "esp32 devkitc", "esp32-devkitc"],
    note: "Espressif's own board, and the only ESP32 dev board here with a published outline. Header rows are on 25.4 mm (1\") centres. `thickness` is the overall assembled height, not the PCB",
  },
  {
    id: "esp32_devkit_v1_30", label: "ESP32 DevKit V1 (30-pin)", length: 51.6, width: 28.4, holes: [],
    aka: ["esp32", "esp32 devkit", "devkit v1", "esp32 devkit v1", "doit esp32"],
    verified: false,
    note: "a clone with no datasheet — length is measured, not specified, and varies between batches (51.5–52 mm reported). The reliable number is the 22.86 mm (0.9\") spacing between header rows; size the board slot loose and locate off the headers",
  },
  {
    id: "esp32_devkit_38", label: "ESP32 DevKit (38-pin)", length: 51.6, width: 28.4, holes: [],
    aka: ["esp32 38 pin", "nodemcu-32s", "esp32 devkit 38"],
    verified: false,
    note: "same caveat as the 30-pin and worse — 38-pin boards are sold by several unrelated makers under one name. Only the 22.86 mm (0.9\") header row spacing is dependable",
  },
];

// ---------------------------------------------------------------------------
// Dowel pins
// ---------------------------------------------------------------------------
// ISO 2338 parallel pins, tolerance class m6 — the class you get unless you ask, and
// deliberately OVERSIZE. A 6 mm m6 pin measures 6.006 to 6.015; in metal it goes into a
// 6 mm H7 reamed hole and the interference is the whole point.
//
// None of that survives contact with FDM. A printed hole at 6.000 will not take a
// 6.015 pin without splitting, and a hole loose enough to take it has no location left.
// So `d` is the nominal only, `tolMin`/`tolMax` are there to say how much bigger than
// nominal the real pin is, and the pocket goes through bore() like everything else.
//
// source: https://www.belmey.co.uk/products/ISO%2023%20Dowel%20Pins.pdf
// source: https://www.fastenermart.com/iso-2338-dowel-pins.html

export interface DowelPin extends Part {
  d: number;      // nominal diameter
  tolMin: number; // m6 lower deviation from nominal
  tolMax: number; // m6 upper deviation from nominal
}

export const DOWEL_PINS: DowelPin[] = [
  { id: "dowel_1", label: "⌀1 dowel", d: 1, tolMin: 0.002, tolMax: 0.008 },
  { id: "dowel_1_5", label: "⌀1.5 dowel", d: 1.5, tolMin: 0.002, tolMax: 0.008 },
  { id: "dowel_2", label: "⌀2 dowel", d: 2, tolMin: 0.002, tolMax: 0.008 },
  { id: "dowel_2_5", label: "⌀2.5 dowel", d: 2.5, tolMin: 0.002, tolMax: 0.008 },
  { id: "dowel_3", label: "⌀3 dowel", d: 3, tolMin: 0.002, tolMax: 0.008 },
  { id: "dowel_4", label: "⌀4 dowel", d: 4, tolMin: 0.004, tolMax: 0.012 },
  { id: "dowel_5", label: "⌀5 dowel", d: 5, tolMin: 0.004, tolMax: 0.012 },
  { id: "dowel_6", label: "⌀6 dowel", d: 6, tolMin: 0.004, tolMax: 0.012 },
  { id: "dowel_8", label: "⌀8 dowel", d: 8, tolMin: 0.006, tolMax: 0.015 },
  { id: "dowel_10", label: "⌀10 dowel", d: 10, tolMin: 0.006, tolMax: 0.015 },
];

// ---------------------------------------------------------------------------
// DIN rail
// ---------------------------------------------------------------------------
// The 35 mm top-hat rail, EN/IEC 60715. A printed clip grabs the two outward lips, so
// the numbers that matter are the 35 mm across the lip tips, the 7.5 mm the hat stands
// off the panel, and the 1 mm of steel the clip's jaw has to hook behind. `topWidth` is
// the raised centre section; `lipWidth` is what is left at each side ((35 − 27) / 2),
// and that is the ledge the clip actually holds.
//
// The 15 mm deep variant is the same 35 mm grip in a stiffer section — a clip designed
// for the 7.5 fits both, since only the hat's height changes.
//
// source: https://docs.rs-online.com/066f/A700000014080536.pdf
// source: https://payapress.com/din-rail-standard/

export interface DinRail extends Part {
  width: number;     // across the lip tips
  height: number;    // hat depth off the panel
  thickness: number; // material thickness
  topWidth: number;  // raised centre section width
  lipWidth: number;  // ledge each side
  cornerR?: number;
}

export const DIN_RAILS: DinRail[] = [
  {
    id: "ts35_7_5", label: "DIN rail TS35 / 7.5", width: 35, height: 7.5, thickness: 1.0,
    topWidth: 27, lipWidth: 4, cornerR: 1.25,
    aka: ["din rail", "ts35", "th35", "din 35", "top hat rail", "ts 35/7.5"],
  },
  {
    id: "ts35_15", label: "DIN rail TS35 / 15", width: 35, height: 15, thickness: 1.5,
    topWidth: 27, lipWidth: 4, cornerR: 1.25,
    aka: ["ts35/15", "th35-15", "deep din rail"],
    verified: false,
    note: "the 35 mm grip and 15 mm depth are standard; the 1.5 mm material thickness is the usual stock but EN 60715 permits 1.0 as well, so a clip jaw cut to 1.5 may rattle on a thin rail",
  },
];

// ---------------------------------------------------------------------------
// Connector envelopes
// ---------------------------------------------------------------------------
// Panel cutouts and pass-throughs. This is the thinnest category in the file and it is
// thin for a reason: most maker connectors have no standard behind them, only a
// manufacturer drawing, and the drawings that matter were not reachable to check.
//
// What IS here is what is genuinely specified — USB-C's mating opening comes out of the
// Type-C spec, 2.54 mm and 2.5 mm pitches are pitches, and a "5.5 × 2.1 barrel" is
// named after its own two diameters. What is NOT here: XT30, XT60 and XT90, which were
// asked for and left out. Published figures for those disagree by several millimetres
// and none traced back to an AMASS drawing; a socket printed to the wrong one is a
// socket the battery lead will not go into, so nothing is better than something.
//
// Panel cutouts for USB-C and barrel jacks are deliberately absent too — both depend
// entirely on which part number the user bought (a bare SMD receptacle, a flanged panel
// mount and a threaded bulkhead need three different holes).
//
// source: https://www.usb.org/sites/default/files/USB%20Type-C%20Spec%20R2.0%20-%20August%202019.pdf
// source: https://www.jst-mfg.com/product/pdf/eng/eXH.pdf
// source: https://www.samtec.com/connectors/standard-board-to-board/0100-inch-square-post/terminals

export interface Connector extends Part {
  pitch?: number;   // contact pitch
  pins?: number;
  l?: number;       // envelope length
  w?: number;       // envelope width
  h?: number;       // envelope height
  openingW?: number; // mating opening width, where one is specified
  openingH?: number; // mating opening height
  post?: number;    // square post across-flats, for pin headers
}

export const CONNECTORS: Connector[] = [
  {
    id: "jst_xh2", label: "JST-XH 2-pin", pitch: 2.5, pins: 2, l: 7.3, w: 5.7,
    aka: ["xh2", "jst xh 2", "xhp-2"],
    note: "housing footprint. Height was not confirmed and is omitted; length is 2.5 × (pins − 1) + 4.8",
  },
  {
    id: "jst_xh3", label: "JST-XH 3-pin", pitch: 2.5, pins: 3, l: 9.8, w: 5.7,
    aka: ["xh3", "jst xh 3", "xhp-3"],
    note: "housing footprint; height not confirmed and omitted",
  },
  {
    id: "jst_xh4", label: "JST-XH 4-pin", pitch: 2.5, pins: 4, l: 12.3, w: 5.7,
    aka: ["xh4", "jst xh 4", "xhp-4"],
    note: "housing footprint; height not confirmed and omitted",
  },
  {
    id: "dupont_254", label: "0.1\" header / Dupont", pitch: 2.54, post: 0.635,
    aka: ["dupont", "pin header", "2.54 header", "0.1 header", "berg"],
    note: "pitch and the 0.635 mm (0.025\") square post are the standard part. Crimp-housing outer sizes are not standardised and are not listed — allow the pitch and let the housings sit proud",
  },
  {
    id: "usbc", label: "USB-C receptacle", openingW: 8.34, openingH: 2.56,
    aka: ["usb c", "usb-c", "type c", "type-c"],
    note: "the mating opening from the USB Type-C spec — the hole the plug's tongue enters. A panel cutout has to clear the cable's overmould instead, which is part-specific and not listed here",
  },
  {
    id: "barrel_5521", label: "Barrel jack 5.5 × 2.1", openingW: 5.5, openingH: 2.1,
    aka: ["barrel jack", "dc jack", "5.5x2.1", "dc-005", "dc005"],
    note: "5.5 outer / 2.1 centre pin is the plug interface and is what the name means. The jack body and its panel hole depend on the part — PCB-mount, flanged and threaded-bulkhead versions all differ — so no cutout is given",
  },
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export type HardwareCategory =
  | "bearing" | "hexNut" | "squareNut" | "washer" | "extrusion"
  | "tSlotNut" | "board" | "dowelPin" | "dinRail" | "connector";

export type HardwarePart =
  | Bearing | HexNut | SquareNut | Washer | Extrusion
  | TSlotNut | Board | DowelPin | DinRail | Connector;

export interface HardwareMatch {
  category: HardwareCategory;
  part: HardwarePart;
}

const TABLES: [HardwareCategory, readonly Part[]][] = [
  ["bearing", BEARINGS],
  ["hexNut", HEX_NUTS],
  ["squareNut", SQUARE_NUTS],
  ["washer", WASHERS],
  ["extrusion", EXTRUSIONS],
  ["tSlotNut", TSLOT_NUTS],
  ["board", BOARDS],
  ["dowelPin", DOWEL_PINS],
  ["dinRail", DIN_RAILS],
  ["connector", CONNECTORS],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Words that describe the CATEGORY rather than the part, so "608 bearing", "608" and
// "a 608zz bearing" all have to land on the same row.
const FILLER = /(bearings?|nuts?|nyloc[k]?|locknuts?|washers?|screws?|bolts?|extrusions?|profiles?|rails?|boards?|pins?|connectors?|plugs?|sockets?|headers?|metric|hex|hexagon|flat|plain|deep|groove|ball|drop|in|slot|series|size|the|a|an|for|of|mm)/g;

// The same words read the other way. Stripping the category word finds the size but
// loses the category — "washer m5" and "m5" strip to the same thing, and answering the
// first with a nut is exactly the silent wrong answer this file exists to stop. So the
// word that was stripped gets put back on the other end and tried again, which is how
// "washer m5" reaches the row whose label is "M5 washer".
const CATEGORY_WORDS = [
  "washer", "square", "tnut", "t nut", "t-nut", "drop-in", "drop in", "dropin",
  "nut", "bearing", "dowel", "rail", "header",
];

// Seal and closure suffixes. 608, 608ZZ and 608-2RS are one bearing.
const SEAL = /(2rs|2rz|2z|ddu|du|rs|zz|z)$/;

/** id/label/aka → row, built once. Later tables never clobber an earlier key. */
const INDEX: Map<string, HardwareMatch> = (() => {
  const m = new Map<string, HardwareMatch>();
  const put = (key: string, hit: HardwareMatch) => {
    const k = norm(key);
    if (k && !m.has(k)) m.set(k, hit);
  };
  for (const [category, rows] of TABLES) {
    for (const part of rows) {
      const hit: HardwareMatch = { category, part: part as HardwarePart };
      put(part.id, hit);
      put(part.label, hit);
      for (const a of part.aka ?? []) put(a, hit);
    }
  }
  return m;
})();

/** Turn what a person typed — "608 bearing", "a 608zz", "Pi 5", "M5 nyloc",
 *  "2020 v-slot" — into the row it names, or null when nothing matches.
 *
 *  Matching is tolerant of case, spaces, punctuation, bearing seal codes and the
 *  category word people habitually append, because the caller is a prompt builder
 *  feeding it free text, not a form. It is deliberately NOT fuzzy beyond that: a near
 *  miss returns null so the caller can fall back, rather than confidently handing back
 *  the dimensions of a different part. */
export function lookupHardware(query: string): HardwareMatch | null {
  if (!query) return null;
  const raw = query.toLowerCase();

  // Straight hit on the whole string, punctuation and spacing ignored.
  const whole = norm(raw);
  if (INDEX.has(whole)) return INDEX.get(whole)!;

  // Same, with the category words stripped out: "608 bearing" → "608".
  const stripped = norm(raw.replace(/\b/g, " ").replace(FILLER, " "));

  // Before trusting the bare size, pair each size-looking token with any category word
  // the query carried, so word order stops mattering: "washer m5" and "t-nut m5" reach
  // the same rows as "m5 washer" and "M5 T-nut". Category words are tried in the order
  // listed, which is why the specific ones ("square", "t-nut") sit ahead of "nut".
  const tokens = raw.split(/[^a-z0-9.]+/).filter((t) => t.length >= 2);
  for (const word of CATEGORY_WORDS) {
    if (!raw.includes(word)) continue;
    for (const tok of tokens) {
      const after = norm(tok + word);
      if (INDEX.has(after)) return INDEX.get(after)!;
      const before = norm(word + tok);
      if (INDEX.has(before)) return INDEX.get(before)!;
    }
  }
  if (stripped && INDEX.has(stripped)) return INDEX.get(stripped)!;

  // Seal codes, on both forms: "608zz" → "608".
  for (const k of [whole, stripped]) {
    const unsealed = k.replace(SEAL, "");
    if (unsealed && unsealed !== k && INDEX.has(unsealed)) return INDEX.get(unsealed)!;
  }

  // Token sweep, longest key first so "2020 v-slot" beats "2020" and "pi zero" beats
  // "pi". Keys under three characters are excluded — "m3" is a real key but a bare
  // "3" inside some other phrase is not a request for an M3 nut.
  const hay = " " + raw.replace(/[^a-z0-9]+/g, " ").trim() + " ";
  let best: HardwareMatch | null = null;
  let bestLen = 0;
  for (const [key, hit] of INDEX) {
    if (key.length < 3 || key.length <= bestLen) continue;
    const spaced = " " + key.replace(/([a-z]+)(\d)/g, "$1 $2").replace(/(\d)([a-z]+)/g, "$1 $2") + " ";
    if (hay.includes(" " + key + " ") || hay.includes(spaced)) {
      best = hit;
      bestLen = key.length;
    }
  }
  return best;
}
