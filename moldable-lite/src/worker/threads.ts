// A built-in, pre-verified thread builder, injected into the `replicad` namespace the
// generated code receives.
//
// Why the app owns this instead of the AI: a thread was the one shape every model kept
// getting wrong. The worst was `.extrude(len, { twistAngle: 4525 })` — twelve and a half
// turns lofted as ONE ruled surface, self-intersecting into the stacked-lamellae screw of
// the original report. A helper makes the thread deterministic: the AI supplies
// dimensions, the app supplies geometry, and every thread in every project is the same
// proven construction.
//
// THIS IS NOT A TRUE SINGLE-LEAD HELICAL THREAD. It is a revolved zigzag: one closed 2D
// profile (root radius / ramp / crest flat / ramp / root radius, repeated once per pitch,
// bounded by the axis) revolved 360 degrees. That produces a stack of concentric annular
// ribs, not a continuous spiral — you cannot "unscrew" it in one motion the way a real
// machine thread works. Two measured reasons that trade-off is the right one here:
//
//   1. A REAL helix was tried first, and the sweep is not the problem — it is fast. What
//      fails is the BOOLEAN that joins the swept ridge to the shaft. Measured in this
//      WASM build (M6x1x12 unless noted), both directions of it:
//
//        sketchHelix                    9-13 ms
//        sweepSketch (frenet)          60-164 ms
//        FUSE ridge onto a core        hangs past 5 min (watchdog is 25 s)
//        CUT groove from a blank       M3x0.5x3  (6 turns)  ... 8.2 s
//                                      M8x1.25x10 (8 turns) ... FAILS at 7.4 s
//                                      M6x1x12   (12 turns) ... FAILS at 12.1 s
//                                      30x3x60   (20 turns) ... 85.7 s
//
//      So the cut is not a rescue: it fails outright at the two most common screw sizes
//      and takes 3.4x the watchdog at the size where it does finish. This is not a tuning
//      problem to solve with different overlap/bite numbers; it is this kernel, in this
//      WASM build, on this construction. A model that never finishes building is strictly
//      worse than one with straight-ish grooves instead of a spiral one.
//
//      A true helix IS reachable through Manifold, whose mesh booleans do the same union
//      in 361 ms (dia 8, 4 turns) to 516 ms (dia 12.8, 10 turns), genus 0 both — but it
//      degrades past ~20 turns (dia 20, 20 turns: 13.4 s, genus -6, i.e. broken) and its
//      output is a MESH: no STEP export, and no further CAD ops on the result. That is a
//      product decision, not a code one, so it is not taken here.
//   2. At the sizes this app prints (M3-M6, FDM, 0.4mm nozzle), a true printed helical
//      thread rarely functions as a precision fastener anyway — layer stepping already
//      destroys the lead angle. The concentric-rib construction gives the same practical
//      result (grip, a visual "this is threaded" cue, something a nut can bite into) with
//      geometry that is provably watertight (one simple profile, no boolean, revolved
//      around an axis it never crosses) and provably fast (revolve is O(1) in turn count).
//
// For an actual precision metric thread, tell the user to use a heat-set insert into a
// plain hole (the Fasteners tool already sizes those) — that is the real answer serious
// FDM printing gives to "I need this to thread like a real screw."

export interface ThreadOpts {
  /** Outer (major) diameter of the thread, mm — the number a caliper reads. */
  diameter: number;
  /** Axial distance per rib, mm. Adjusted slightly so a whole number of ribs fits the
   *  length exactly (no half-height rib stub at the top). */
  pitch?: number;
  /** Threaded length along +Z, mm. */
  length?: number;
  /** How many times the thread wraps the shaft. Any TWO of pitch/length/turns fix the
   *  third (turns = length / pitch), so a caller can ask for "8 turns over 10 mm" without
   *  doing the arithmetic. Given explicitly, it is honoured exactly — the rib count is
   *  this number, and the pitch is whatever makes it fit. */
  turns?: number;
  /** Radial rib depth, mm. Default: ISO-like 0.6134 x pitch, capped at diameter/5. */
  depth?: number;
}

/** Resolve pitch/length/turns from whichever two the caller gave. */
function resolveThread(o: ThreadOpts): { pitch: number; len: number; turns: number } {
  const has = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
  const pitch = Number(o.pitch), len = Number(o.length), turns = Number(o.turns);
  if (has(o.pitch) && has(o.length)) return { pitch, len, turns: len / pitch };
  if (has(o.turns) && has(o.length)) return { pitch: len / turns, len, turns };
  if (has(o.turns) && has(o.pitch)) return { pitch, len: turns * pitch, turns };
  throw new Error("makeThread needs two of pitch, length and turns (plus diameter) — e.g. { diameter: 6, pitch: 1, length: 12 } or { diameter: 6, turns: 12, length: 12 }.");
}

/** Build a threaded-look rod (core + concentric ribs) as one clean solid: axis +Z, base
 *  at z = 0, centred on the origin. Callers translate it into place and fuse. See the
 *  file header for why this is ribs, not a true helix. */
export function makeThread(r: any, o: ThreadOpts): any {
  const dMajor = Number(o.diameter);
  if (!(dMajor > 0)) throw new Error("makeThread needs a positive diameter (mm).");
  const { pitch, len, turns } = resolveThread(o);
  if (!(pitch > 0) || !(len > 0)) {
    throw new Error("makeThread needs positive diameter, pitch and length (mm).");
  }
  const rMajor = dMajor / 2;
  const depth = Math.min(o.depth ?? 0.6134 * pitch, dMajor / 5);
  const rMinor = rMajor - depth;
  if (rMinor < 0.4) {
    throw new Error("makeThread: the core would be under 0.8 mm across — raise the diameter or lower the pitch/depth.");
  }

  // Whole ribs across the length, pitch nudged so they fit exactly (no orphan stub rib).
  // A turn count the caller asked for out loud is the count they get.
  const n = Math.max(1, Math.round(turns));
  const p = len / n;
  const crestFlat = 0.25 * p; // printable flat tip — never a knife edge
  const ramp = 0.25 * p;      // radial rise/fall either side of the crest
  // 0.25 + 0.25 + 0.25 = 0.75 p per rib, leaving 0.25 p of root flat as the gap.

  const d = r.draw([0, 0]).lineTo([rMinor, 0]);
  for (let i = 0; i < n; i++) {
    const c = (i + 0.5) * p; // this rib's centre
    d.lineTo([rMinor, c - crestFlat / 2 - ramp])
      .lineTo([rMajor, c - crestFlat / 2])
      .lineTo([rMajor, c + crestFlat / 2])
      .lineTo([rMinor, c + crestFlat / 2 + ramp]);
  }
  const profile = d.lineTo([rMinor, len]).lineTo([0, len]).close();
  return profile.sketchOnPlane("XZ", [0, 0, 0]).revolve([0, 0, 1], { origin: [0, 0, 0] });
}
