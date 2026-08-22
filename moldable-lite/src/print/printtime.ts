// How long the print will take — honestly.
//
// The two questions before a print are "how much plastic" (filament.ts answers that)
// and "how long am I tying up the printer". The second one had no answer anywhere in
// the app, and it is the one that decides whether a part gets printed tonight or at the
// weekend.
//
// This is a HARDER estimate than grams, and it is worth saying why rather than quoting a
// confident number. Grams follow from geometry: the same part weighs the same on every
// machine. Time does not. The same file is roughly 25 minutes on a Bambu X1C and closer
// to two hours on an Ender 3 — a 4× spread that no amount of cleverness about the mesh
// can close, because it is a fact about the printer, not the part. So the machine class
// is an INPUT here, defaulted from the printer already chosen in Settings, and the answer
// is given as a range rather than a single number.
//
// The arithmetic, which is the same shape a slicer starts from:
//
//   flow      = min(max volumetric flow, extrusion width × layer height × max speed)
//               — a fast machine is limited by how quickly the hotend can melt plastic,
//               a slow one by how quickly the gantry can move. Whichever binds, binds.
//   per layer = extruded volume ÷ layers ÷ flow, plus a fixed overhead for travel,
//               the layer change and acceleration losses on short moves
//   floor     = a minimum layer time, because a small layer has to cool before the next
//               one lands. This is what makes a thin, tall part slow out of proportion to
//               its weight. It is applied to the AVERAGE layer, so it catches a part that
//               is slender all the way up and NOT a wide base under a thin spire — that
//               shape still reads faster here than it prints.
//
// Checked against a part with a published answer. A 3DBenchy is ~9.5 cm³ of extruded
// plastic and 48 mm tall; at 0.2 mm this returns roughly 22 min on the fast class (real
// X1C standard profile: ~25 min), 40 min on standard (real MK4S: 28–50 min depending on
// profile) and 1 h 35 m on slow (real Ender 3 at 50 mm/s: ~1 h 50 m). Those three numbers
// are pinned in harness/batch-fixes-e2e.mjs so a change to the arithmetic has to face them.
//
// What it leaves out, all of which ADD time: supports, brim and raft; the purge/prime
// tower on a multi-colour print (which can double a small print); the first-layer slow
// pass; and any tuning that differs from a stock profile. That is why the band is
// asymmetric — the estimate is more likely to be low than high.

export interface SpeedClass {
  id: string;
  label: string;
  /** What the hotend can melt, mm³/s. */
  maxFlow: number;
  /** What the motion system will actually run at on real perimeters, mm/s. */
  maxSpeed: number;
  /** Fraction of the theoretical rate actually achieved once acceleration, travel and
   *  short segments are accounted for. A CoreXY with input shaping keeps far more of its
   *  headline speed than a bed-slinger does. */
  efficiency: number;
  /** Seconds added per layer for the layer change, z move and travel. */
  layerOverheadS: number;
  /** Minimum seconds a layer takes, for cooling. */
  minLayerS: number;
  note: string;
}

export const SPEED_CLASSES: SpeedClass[] = [
  { id: "fast", label: "Fast (CoreXY / Klipper)", maxFlow: 14, maxSpeed: 250, efficiency: 0.72, layerOverheadS: 1.5, minLayerS: 3, note: "Bambu, Prusa CORE One, K1, SV08" },
  { id: "standard", label: "Standard", maxFlow: 8, maxSpeed: 120, efficiency: 0.75, layerOverheadS: 3, minLayerS: 5, note: "Prusa MK4, Kobra 3, Neptune 4" },
  { id: "slow", label: "Slow (older bed-slinger)", maxFlow: 5, maxSpeed: 60, efficiency: 0.44, layerOverheadS: 5, minLayerS: 8, note: "Ender 3, CR-10, stock profiles" },
];

export const DEFAULT_SPEED = "standard";

export function speedClassById(id: string): SpeedClass {
  return SPEED_CLASSES.find((c) => c.id === id) ?? SPEED_CLASSES.find((c) => c.id === DEFAULT_SPEED)!;
}

/** Guess the class from the printer already chosen in Settings, so the first estimate is
 *  about the machine in the room rather than an average of every machine ever sold. The
 *  user can still say otherwise; this only picks the starting point. */
export function speedClassForPrinter(name?: string): string {
  const n = (name ?? "").toLowerCase();
  if (!n) return DEFAULT_SPEED;
  if (/bambu|\bx1\b|\bp1[ps]?\b|\bh2[dsc]\b|\ba1\b|core one|\bk1\b|\bk2\b|sv08|centauri|snapmaker u1|\bxl\b/.test(n)) return "fast";
  if (/ender|cr-10|\bmini\+?\b|mk3|sv06|kobra 2\b|neptune 3/.test(n)) return "slow";
  return DEFAULT_SPEED;
}

export interface TimeEstimate {
  /** Best guess, minutes. */
  minutes: number;
  /** The honest band. Asymmetric: everything left out adds time. */
  lowMinutes: number;
  highMinutes: number;
  layers: number;
}

export const COMMON_LAYER_HEIGHTS = [0.12, 0.16, 0.2, 0.28];
export const DEFAULT_LAYER_MM = 0.2;

/** Minutes for one part.
 *
 *  @param extrudedMM3 the plastic that actually gets laid down — walls plus infill, which
 *         is `FilamentEstimate.cm3 × 1000`, NOT the part's solid volume.
 *  @param heightMM the part's height as it sits on the plate. */
export function estimatePrintTime(
  extrudedMM3: number,
  heightMM: number,
  cls: SpeedClass,
  layerMM: number = DEFAULT_LAYER_MM,
  nozzleMM = 0.4,
): TimeEstimate | null {
  if (!(extrudedMM3 > 0) || !(heightMM > 0) || !(layerMM > 0)) return null;
  const width = nozzleMM * 1.125;
  const flow = Math.min(cls.maxFlow, width * layerMM * cls.maxSpeed) * cls.efficiency;
  if (!(flow > 0)) return null;
  const layers = Math.max(1, Math.ceil(heightMM / layerMM));
  const perLayer = Math.max(extrudedMM3 / layers / flow + cls.layerOverheadS, cls.minLayerS);
  const minutes = (layers * perLayer) / 60;
  // The band, and where it comes from. It is deliberately lopsided, because everything
  // this model leaves out ADDS time and almost nothing removes it.
  //
  //   low  ×0.75  a well-tuned machine on a fast profile — the flow and speed figures
  //               above are stock-profile numbers, and a tuned printer beats them by
  //               roughly a quarter.
  //   high ×1.6   supports, brim or raft on a part that needs them (a third or more on
  //               an overhang-heavy print), plus the slow first layer. A purge tower on
  //               a multi-colour print can beat even this, which the tooltip says.
  //
  // Against the checks in the header the true answer landed inside this band every time,
  // and nearer the top of it than the bottom.
  return {
    minutes,
    lowMinutes: minutes * 0.75,
    highMinutes: minutes * 1.6,
    layers,
  };
}

/** "1 h 25 m", "40 m", "2 h". Rounded to five minutes above an hour — a print time
 *  quoted to the minute claims a precision this does not have. */
export function fmtDuration(mins: number): string {
  if (!(mins > 0)) return "—";
  // Round FIRST, then pick the wording. Testing `mins < 60` before rounding printed
  // "60 m" for 59.6 minutes — the rounding pushed it to the hour after the branch that
  // would have said "1 h" had already been passed over.
  const total = Math.max(5, Math.round(mins / 5) * 5);
  if (total < 60) return `${total} m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}
