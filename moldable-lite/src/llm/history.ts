// "Put it back to how it was before I added the screw hole."
//
// The app has always recorded every change as a version with a human summary. What it
// could not do was hear that sentence: the request went to the CAD model, which tried
// to WRITE code for it — and the one thing it cannot write is the past. So a request
// that names a point in the history is resolved here instead, against the same numbered
// log the model is shown, and executed by the restore the History panel already uses.
//
// Two gates keep this from hijacking ordinary work, because the cost of a false
// positive is severe: someone types "make the screw hole bigger" and their model jumps
// backwards instead. The first gate is a regex — no history-ish wording, no LLM call at
// all, which also means the common case pays nothing. The second is the model itself,
// told plainly that "none" is the safe answer and to use it whenever unsure.
//
// Best-effort like the rest of llm/: any failure, timeout, or unparseable reply returns
// null and the caller builds exactly as it would have before.

import { generateLlm, type LlmSettings } from "./llm";
import { utilityBrain, withTimeout } from "./router";
import { extractJsonObject } from "./extract";

/** Cheap gate: does this sentence even mention going back? Runs before any LLM call.
 *  Deliberately about MOVEMENT THROUGH TIME, not about parts — "remove the screw hole"
 *  is an edit and must stay one; "before the screw hole" is a place in the history. */
const TIME_TRAVEL = new RegExp(
  [
    "\\brevert\\b", "\\bundo\\b", "\\broll ?back\\b", "\\bstep back\\b",
    "\\bgo back\\b", "\\btake .{0,20}back\\b", "\\bback to\\b", "\\brestore\\b",
    "\\bbefore (?:i|we|you|the|that|adding|it)\\b",
    "\\b(?:previous|earlier|older|last|original|first) (?:version|state|step|model|one)\\b",
    "\\bthe way it (?:was|used to)\\b", "\\bhow it (?:was|used to)\\b",
    "\\bback (?:to|before) (?:when|the point)\\b",
    "\\bpoint (?:before|where)\\b",
    "\\bstart over from\\b", "\\breset (?:it )?(?:to|back)\\b",
  ].join("|"),
  "i",
);

/** Worth asking the model about? Cheap, synchronous, and the reason an ordinary edit
 *  costs nothing extra. */
export function looksLikeHistoryRequest(text: string): boolean {
  return TIME_TRAVEL.test(text);
}

export interface HistoryMove {
  /** 1-based step in the log window that was shown — the caller maps it to a version. */
  step: number;
  /** One plain sentence naming what is being gone back to, for the chat receipt. */
  say: string;
}

const SYS = [
  "You read a 3D-printing app's build log and decide whether the user is asking to move the MODEL BACK (or forward) to an earlier recorded state.",
  "The log is a numbered list of every change already made, oldest first. One entry is marked ON SCREEN NOW.",
  "",
  "Answer with JSON only.",
  '- To go to a recorded state: {"action":"restore","step":N,"say":"one short sentence naming what you are going back to"}',
  '- For anything else: {"action":"none"}',
  "",
  "Rules that decide N:",
  '- "before I added X" / "before the X" means the step JUST BEFORE the one that added X — not the step that added it. If step 5 is "Added a screw hole", the answer is 4.',
  '- "undo that" / "back one step" means the step immediately before the one marked ON SCREEN NOW.',
  '- "back to when it was X" / "the version with X" means the step that produced X — that one, not the one before it.',
  "- N must be a step number that appears in the log.",
  "",
  'Answer {"action":"none"} — the safe answer — whenever:',
  "- The request is an EDIT, even if it sounds like removal: \"remove the screw hole\", \"make it thinner\", \"take the logo off\". Those change the model forwards; only go back when the user is pointing at the model's PAST.",
  "- No entry in the log matches what they named.",
  "- Two entries match equally well and you would be guessing.",
  "- You are unsure for any reason. Guessing wrong throws away the user's work; answering none costs nothing.",
].join("\n");

/** Resolve a request against the build log. Null = not a history move (or no brain,
 *  or anything went wrong) and the caller proceeds with the normal build. */
export async function resolveHistoryMove(
  request: string,
  log: string,
  steps: number,
  llm: LlmSettings,
  keys: Record<string, string>,
  proxyBase: string,
): Promise<HistoryMove | null> {
  const text = request.trim();
  if (!text || steps < 2 || !log) return null;
  if (!looksLikeHistoryRequest(text)) return null;
  const brain = utilityBrain(llm, keys);
  if (!brain) return null;
  try {
    const out = await withTimeout(
      generateLlm(
        brain,
        keys,
        SYS,
        [{ role: "user", content: `Build log:\n${log}\n\nThe user says: ${text.slice(0, 600)}` }],
        {},
        proxyBase,
      ),
      18_000,
    );
    if (!out) return null;
    const o = JSON.parse(extractJsonObject(out));
    if (!o || o.action !== "restore") return null;
    const step = Number(o.step);
    if (!Number.isInteger(step) || step < 1 || step > steps) return null;
    const say = typeof o.say === "string" && o.say.trim() ? o.say.trim().slice(0, 160) : "";
    return { step, say };
  } catch {
    return null; // unparseable or failed — build as normal
  }
}
