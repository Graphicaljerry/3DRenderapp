// Plan mode: agree on WHAT gets built before spending anything building it.
//
// The failure this exists to stop: you type a sentence, the app spends a minute and
// (on a mesh engine) real money, and what comes back is a reasonable model of a
// different idea. Then you iterate — each round costing again — until it converges.
// Cheaper and calmer to write the spec down first, in millimetres, and let the person
// who has the actual part in their head correct it in ten seconds.
//
// A plan is deliberately NOT a conversation. It is a short spec you can read in one
// glance: what the thing is, its overall size, the features that matter, and the
// assumptions being made on your behalf — because unstated assumptions are what
// produce a confidently wrong first model.

import { generateLlm, type LlmSettings } from "./llm";
import { utilityBrain, withTimeout } from "./router";
import { extractJsonObject } from "./extract";
import type { ApiMsg } from "./anthropic";

export interface BuildPlan {
  /** A short name for the part — becomes the project name if the user keeps it. */
  title: string;
  /** One sentence describing what will be built. */
  summary: string;
  /** Overall envelope in mm, when the request implies one. */
  size?: { x: number; y: number; z: number };
  /** The features that will actually be modelled, in build order. */
  steps: string[];
  /** Decisions made WITHOUT being told — the highest-value part of the card, because
   *  this is where a wrong first model comes from. */
  assumptions: string[];
  /** Print-side notes: orientation, wall thickness, clearances. */
  printNotes?: string[];
  /** Numeric dimensions the build will expose as live sliders (defaultParams) — the
   *  plan's answer to "can I adjust that" and "add a parameter for X": visible and
   *  editable before anything is built, not just implied by the steps text. */
  parameters?: { name: string; value: number }[];
}

const SYS = [
  "You are a CAD planner for a 3D-printing app. Turn the user's request into a SHORT build plan they can check at a glance, in millimetres.",
  "Rules:",
  "- Never ask questions. State what you will assume instead — the user edits the plan directly.",
  "- Every dimension in mm. If the request implies a size, give the overall envelope; if it genuinely does not, omit size.",
  "- steps: 3-7 lines, each a concrete modelling action with its numbers (e.g. \"60 × 40 × 12 mm body, 3 mm corner radius\"). Build order.",
  "- assumptions: 2-5 lines, ONLY things the user did not say that you are deciding for them (wall thickness, tolerance, which way up it prints, a size you inferred). This is the most important field — be specific and numeric.",
  "- printNotes: 0-3 short lines on orientation, supports, wall thickness or fit clearances.",
  "- parameters: 0-8 numeric dimensions worth leaving adjustable after the build (each becomes a live slider) — main sizes, wall thickness, hole/peg sizes, counts that resize the part. Skip anything already fully captured by size. Each one a plain label a non-engineer would recognise (e.g. \"Wall thickness\", not \"wallThickness\") plus its value in mm.",
  "- Plain language. No markdown, no preamble.",
  'Reply with JSON only: {"title":"...","summary":"...","size":{"x":0,"y":0,"z":0},"steps":["..."],"assumptions":["..."],"printNotes":["..."],"parameters":[{"name":"...","value":0}]}',
].join("\n");

function coerce(o: any): BuildPlan | null {
  if (!o || typeof o !== "object") return null;
  const arr = (v: any, cap: number): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, cap) : [];
  const steps = arr(o.steps, 7);
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 60) : "";
  if (!title || !steps.length) return null;
  const n = (v: any) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null);
  const sx = n(o.size?.x), sy = n(o.size?.y), sz = n(o.size?.z);
  const parameters = Array.isArray(o.parameters)
    ? o.parameters
        .filter((x: any) => x && typeof x.name === "string" && x.name.trim() && typeof x.value === "number" && isFinite(x.value))
        .slice(0, 8)
        .map((x: any) => ({ name: x.name.trim().slice(0, 40), value: Math.round(x.value * 100) / 100 }))
    : [];
  return {
    title,
    summary: typeof o.summary === "string" ? o.summary.trim().slice(0, 240) : "",
    size: sx && sy && sz ? { x: sx, y: sy, z: sz } : undefined,
    steps,
    assumptions: arr(o.assumptions, 5),
    printNotes: arr(o.printNotes, 3),
    parameters: parameters.length ? parameters : undefined,
  };
}

/** Draft a build plan. Best-effort like the rest of llm/: null means "just build it",
    and the caller falls through to exactly the run it would have made anyway. */
export async function draftPlan(
  request: string,
  llm: LlmSettings,
  keys: Record<string, string>,
  proxyBase: string,
  opts?: { image?: { dataBase64: string; mediaType: string }; canvas?: string; engine?: "cad" | "mesh" },
): Promise<BuildPlan | null> {
  const brain = utilityBrain(llm, keys);
  if (!brain) return null;
  const text = request.trim();
  if (!text && !opts?.image) return null;
  const engineLine = opts?.engine === "mesh"
    ? "\nThis will be SCULPTED by a mesh engine, which cannot hold exact dimensions: plan the form, proportions, pose and surface detail, and give size only as an overall envelope."
    : "";
  const canvasLine = opts?.canvas ? `\nThe user is editing ${opts.canvas} — plan the CHANGE, not a new part.` : "";
  const content: ApiMsg["content"] = opts?.image
    ? [
        { type: "image", mediaType: opts.image.mediaType, dataBase64: opts.image.dataBase64 },
        { type: "text", text: text.slice(0, 900) || "The user attached this reference with no description." },
      ]
    : text.slice(0, 900);
  try {
    const out = await withTimeout(
      generateLlm(brain, keys, SYS + engineLine + canvasLine, [{ role: "user", content }], {}, proxyBase),
      opts?.image ? 30_000 : 22_000,
    );
    if (!out) return null;
    return coerce(JSON.parse(extractJsonObject(out)));
  } catch {
    return null; // unparseable or failed — the caller builds exactly as before
  }
}

/** Fold an (optionally user-edited) plan back into the prompt the engine builds from.
    The plan IS the brief at that point — the original sentence rides along as intent. */
export function planToPrompt(request: string, plan: BuildPlan): string {
  const lines = [
    request,
    "",
    "[Agreed build plan — follow it exactly; the user has reviewed these numbers]",
    `Part: ${plan.title}${plan.summary ? ` — ${plan.summary}` : ""}`,
    ...(plan.size ? [`Overall size: ${plan.size.x} × ${plan.size.y} × ${plan.size.z} mm`] : []),
    "Build:",
    ...plan.steps.map((s) => `- ${s}`),
  ];
  if (plan.assumptions.length) lines.push("Decisions to honour:", ...plan.assumptions.map((s) => `- ${s}`));
  if (plan.printNotes?.length) lines.push("Print notes:", ...plan.printNotes.map((s) => `- ${s}`));
  if (plan.parameters?.length) {
    lines.push(
      "Parameters — put these exact values in defaultParams (pick a clear camelCase key for each label, e.g. \"Wall thickness\" -> wallThickness):",
      ...plan.parameters.map((p) => `- ${p.name}: ${p.value} mm`),
    );
  }
  return lines.join("\n");
}
