// The verification receipt: what was measured on the file being handed over, next to
// what the user asked for. Every line is a number the app actually computed — a line
// it cannot compute is omitted, never estimated. This is the app's one differentiating
// claim ("the part actually fits") made checkable at the exact moment it matters: the
// hand-off to the slicer.

import type { PreflightOutcome } from "./preflight";
import type { CadOp } from "../engine/types";
import { requestedMm } from "../lib/dimAudit";
import { fitClearance, fitSource, type FitId } from "../lib/fit";

export interface ReceiptInput {
  fileName: string;
  pf: PreflightOutcome;
  /** Recent USER chat texts, newest first — where the requested figures live. */
  userTexts: string[];
  bed: { x: number; y: number; z: number };
  /** The ops baked into the exported solid, for the clearance line. */
  ops?: CadOp[];
  fit: FitId;
}

/** Markdown receipt. Compact by design: five-ish lines a person actually reads. */
export function buildReceipt(r: ReceiptInput): string {
  const s = r.pf.report.boundingBox.size;
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const lines: string[] = [];
  lines.push(`**Verification receipt — ${r.fileName}**`);
  lines.push(`measured ${f(s.x)} × ${f(s.y)} × ${f(s.z)} mm`);

  // Requested figures from the last few user turns. A figure that matches an overall
  // dimension is confirmed; one that doesn't is SAID to be unconfirmed — it may be a
  // wall or a hole, which this receipt cannot measure, and pretending otherwise is the
  // exact dishonesty the receipt exists to end.
  const asked = [...new Set(r.userTexts.slice(0, 5).flatMap((t) => requestedMm(t)))];
  if (asked.length) {
    const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.2, a * 0.01);
    const hit = asked.filter((v) => [s.x, s.y, s.z].some((d) => near(v, d)));
    const miss = asked.filter((v) => !hit.includes(v));
    if (hit.length) lines.push(`requested ${hit.map((v) => `${f(v)} mm ✓`).join(" · ")}`);
    if (miss.length) lines.push(`requested ${miss.map((v) => `${f(v)} mm`).join(" · ")} — not an overall dimension; check it on the model (Measure) before printing`);
  }

  const m = r.pf.report.manifold;
  lines.push(`watertight ${m.isWatertight ? "yes" : `no — ${m.boundaryEdges} open edge(s)`}`);
  const bf = r.pf.report.bedFit;
  lines.push(`bed ${r.bed.x} × ${r.bed.y} × ${r.bed.z} mm — ${bf.fitsAsIs ? "fits" : bf.fitsRotated ? "fits rotated 90°" : "does NOT fit"}`);

  // Clearance is only claimed when the exported solid actually carries cut features.
  const cut = (r.ops ?? []).filter((o) => o.type === "hole" || o.type === "screw").length;
  if (cut) lines.push(`holes ${cut} cut at +${fitClearance(r.fit)} mm per side (${fitSource()})`);

  if (r.pf.repaired) lines.push(`repaired before export — see Printability for what changed`);
  return lines.join("\n");
}
