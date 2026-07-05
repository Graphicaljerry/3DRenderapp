// Print-ready-by-default: every export passes through this gate. Mesh models
// (generative / primitive / imported meshes) that aren't watertight are
// auto-repaired first; every model gets a bed-fit + scale sanity check.
// Replicad results are B-rep-exact — analysed but never mutated (their
// exports re-run the code in the kernel, not this display mesh).

import type { EngineResult } from "../engine/types";
import { analyzePrintability, type PrintabilityReport, type PrinterDefaults } from "./printability";
import { repairGeometry, type RepairOutcome } from "./repair";

export interface PreflightOutcome {
  /** The result to export — geometry swapped for the repaired one when repair ran. */
  result: EngineResult;
  report: PrintabilityReport;
  repaired: RepairOutcome | null;
  /** Human-readable problems that survived the gate; empty ⇔ ready. */
  issues: string[];
  ready: boolean;
}

/** Mesh generators' classic failure: a model authored in metres reads as a
 *  few-mm speck once treated as mm. Anything under this is almost certainly
 *  a scale mistake, not a real design. */
const TINY_MM = 3;

export function preflightExport(result: EngineResult, printer: PrinterDefaults): PreflightOutcome {
  const opts = { bed: printer.bed, overhangThresholdDeg: printer.overhangThresholdDeg };
  let out = result;
  let repaired: RepairOutcome | null = null;
  let report = analyzePrintability(result.geometry, opts);

  if (result.kind !== "replicad" && !report.manifold.isWatertight) {
    try {
      repaired = repairGeometry(result.geometry);
      out = { ...result, geometry: repaired.geometry, dims: repaired.dims };
      report = analyzePrintability(repaired.geometry, opts);
    } catch {
      repaired = null; // export the original; the issues below still tell the truth
    }
  }

  const issues: string[] = [];
  if (!report.manifold.isWatertight) {
    issues.push(
      `still not watertight (${report.manifold.boundaryEdges} open edge(s)) — most slicers patch small gaps, but inspect the sliced preview`,
    );
  }
  if (!report.bedFit.fitsRotated) {
    issues.push(
      `exceeds the ${printer.bed.x} × ${printer.bed.y} × ${printer.bed.z} mm bed in every orientation — scale it down or split it`,
    );
  }
  const s = report.boundingBox.size;
  const maxDim = Math.max(s.x, s.y, s.z);
  if (maxDim > 0 && maxDim < TINY_MM) {
    issues.push(`only ${maxDim} mm at its largest — that usually means a wrong-scale import; check the units`);
  }

  return { result: out, report, repaired, issues, ready: issues.length === 0 };
}

/** One-line summary for chat after an export or slicer hand-off. */
export function preflightSummary(pf: PreflightOutcome): string {
  const s = pf.report.boundingBox.size;
  const dims = `${s.x} × ${s.y} × ${s.z} mm`;
  const bed = pf.report.bedFit.fitsAsIs ? "fits the bed" : "fits the bed rotated 90°";
  const fixes = pf.repaired
    ? ` Auto-repaired first: ${pf.repaired.holesFilled} hole(s) filled, ${pf.repaired.degenerateRemoved} bad triangle(s) removed${pf.repaired.flippedWinding ? ", surface flipped right-side-out" : ""}.`
    : "";
  if (pf.ready) return `Print-ready: watertight, ${dims}, ${bed}.${fixes}`;
  return `Heads-up: ${pf.issues.join("; ")}.${fixes} Details in the Printability tab.`;
}
