// One place that owns "how big does this hole have to be on THIS printer".
//
// Two different numbers get confused constantly, so they are separated here:
//
//  • fit clearance  — the gap you WANT between two mating parts. Loose/snug/press is
//    a design decision the user makes, and it only applies where something inserts
//    into something else (a socket over a pin, a pocket over a magnet).
//  • bore allowance — how far this printer's holes come out from what was drawn.
//    Every FDM machine shrinks holes a little (extrusion overlap on the inside of a
//    curve); how much is a property of the machine, not of the design. It applies to
//    EVERY hole, including ones whose diameter came from a spec table.
//
// The Tolerance test coupon measures the first and reveals the second: the user prints
// holes cut at a known gap and reports the tightest one a nominal peg still fits. That
// answer already folds in their printer's deviation, so the difference between it and
// the population-average snug figure IS the allowance.

export type FitId = "loose" | "snug" | "press";

/** Population-average per-side gaps for FDM, before any calibration. */
export const FIT_CLEARANCE: Record<FitId, number> = { loose: 0.4, snug: 0.2, press: 0.1 };

const FIT_CAL_LS = "moldable_fit_cal";
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The user's measured snug clearance (from printing the Tolerance test coupon
 *  template), or null when uncalibrated. Every printer/filament squishes
 *  differently — one printed measurement beats any table. */
export function fitCalibration(): number | null {
  try {
    const v = parseFloat(localStorage.getItem(FIT_CAL_LS) ?? "");
    if (isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {}
  return null;
}

/** Returns whether the value actually stuck.
 *
 *  This is the one swallowed write in the app where the discarded input cost the user a
 *  PRINT: they run the tolerance coupon, measure it with calipers, and type the number
 *  in. A bare `catch {}` here — private mode, a full quota — dropped it and left every
 *  later fitClearance() quietly using the default, with the UI still showing the value
 *  as accepted. Reading it back is what makes the answer honest: a setItem that throws
 *  is not the only way to lose it. */
export function saveFitCalibration(v: number | null): boolean {
  try {
    if (v == null || !isFinite(v)) {
      localStorage.removeItem(FIT_CAL_LS);
      return localStorage.getItem(FIT_CAL_LS) == null;
    }
    localStorage.setItem(FIT_CAL_LS, String(r2(v)));
    return localStorage.getItem(FIT_CAL_LS) === String(r2(v));
  } catch {
    return false;
  }
}

/** Effective clearance for a fit, honouring the printed calibration: the measured
 *  value IS "snug"; loose/press shift with it by the same margins as the defaults. */
export function fitClearance(fit: FitId): number {
  return r2(Math.max(0.05, FIT_CLEARANCE[fit] + boreAllowance()));
}

/** Per-side correction this printer needs on any drilled diameter. Zero until the
 *  coupon is measured — an uncalibrated guess is worse than the spec table. Clamped
 *  because a wild entry (a mistyped 0.9) would blow every screw hole open. */
export function boreAllowance(): number {
  const cal = fitCalibration();
  if (cal == null) return 0;
  return r2(Math.min(0.4, Math.max(-0.15, cal - FIT_CLEARANCE.snug)));
}

/** Correct a spec'd bore diameter for this printer. Spec tables (ISO clearance holes,
 *  heat-set insert bores, magnet pockets) are written for an average machine, so this
 *  is the difference between "the chart says 3.4" and "3.4 works on your printer". */
export function bore(nominalDiameter: number): number {
  return Math.max(0.4, r2(nominalDiameter + 2 * boreAllowance()));
}

export const isCalibrated = () => fitCalibration() != null;

/** Where the number came from, for receipts. Users deserve to know whether a hole
 *  size is their measurement or a book figure. */
export function fitSource(): string {
  return isCalibrated() ? "measured on your printer" : "typical FDM";
}

/** Short receipt tail disclosing the correction, or "" when there is nothing to say. */
export function boreNote(): string {
  const a = boreAllowance();
  if (!a) return "";
  return ` · ${a > 0 ? "+" : "−"}${Math.abs(r2(a * 2))} mm from your printer calibration`;
}
