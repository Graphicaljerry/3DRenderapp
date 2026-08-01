// Turning a vague ask into a buildable one.
//
// Two surfaces share one brain call. The composer's Improve button rewrites what you
// typed into something specific; sending a request the app can't build confidently
// raises a short question card in the chat instead of guessing silently. Both need the
// same judgement — what is missing, and what would a sensible answer be — so they ask
// once and use different halves of the reply.
//
// The rule that shapes the whole thing: a question is never a blocker. Every question
// comes back with one option already recommended, so the card opens with a complete set
// of answers and Build it is always one tap away. The app asks in order to SHOW you what
// it is about to assume — not to make you fill in a form before it will work.
//
// Best-effort like the rest of llm/: any failure, timeout, or unparseable reply returns
// null and the caller builds exactly as it would have before.

import { generateLlm, type LlmSettings } from "./llm";
import { utilityBrain, withTimeout } from "./router";
import { extractJsonObject } from "./extract";
import type { ApiMsg } from "./anthropic";

export type ClarifyOption = {
  label: string;   // what the chip says — short, human, with units
  value: string;   // the phrase appended to the prompt when chosen
  recommended?: boolean;
};

export type ClarifyQuestion = {
  id: string;
  ask: string;              // the question itself
  why?: string;             // one clause on what it changes about the part
  options: ClarifyOption[];
  allowText?: boolean;      // offer a free-text answer too (usually a measurement)
};

export type Refinement = {
  /** The request rewritten as something specific enough to build. Never auto-applied on
   *  send — only the Improve button uses it, because silently rewriting what someone
   *  typed is exactly the kind of invisible inference this app should not do. */
  improved: string;
  /** Empty when the request is already buildable. At most three, geometry-only. */
  questions: ClarifyQuestion[];
};

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;

function rules(engine: "cad" | "mesh"): string {
  return engine === "mesh"
    ? [
        "The mesh engine sculpts organic shapes: figurines, characters, animals, ornaments. It cannot hold exact dimensions.",
        "Ask only about things that change what gets sculpted: subject and pose, style, proportions, how much surface detail, whether it stands on its own.",
        "Never ask for tolerances, hole sizes or thread specs — this engine cannot honour them.",
      ].join(" ")
    : [
        "The CAD engine builds exact, dimensioned, printable solids from parametric code.",
        "Ask only about things that change the geometry: the size of the thing it has to fit or mount to, key outside dimensions, hole diameter and spacing, wall thickness, which way up it prints, whether a mating part needs clearance.",
        "Prefer asking for the measurement of the OBJECT it interacts with (\"how wide is the shelf?\") over asking the user to design the part (\"how thick should the bracket be?\") — the app can derive the second from the first.",
      ].join(" ");
}

function system(engine: "cad" | "mesh", canvas?: string, convo?: string): string {
  return [
    "You prepare requests for a 3D-printing app that turns plain-language descriptions into printable models.",
    canvas ? `The user already has a model on the canvas: ${canvas}. Requests are usually edits to THIS part.` : "",
    convo ? `Recent conversation (the request may refer back to it — never ask about something already answered here):\n${convo}` : "",
    rules(engine),
    "",
    "Reply with JSON only, no prose and no code fence:",
    '{"improved":"<the request rewritten so it can be built>","questions":[{"id":"<short_slug>","ask":"<question>","why":"<what it changes, one clause>","options":[{"label":"<short, with units>","value":"<phrase appended to the request>","recommended":true}],"allowText":true}]}',
    "",
    "improved: keep every constraint the user stated, verbatim where they gave a number. Fill the rest with sensible, printable defaults stated as explicit millimetres. One paragraph, under 80 words, written as an instruction to the app. If the request is already specific, return it essentially unchanged.",
    "",
    `questions: ONLY what you genuinely cannot assume well. Return [] when the request is already buildable — that is the common case and the right answer. Never more than ${MAX_QUESTIONS}. Never ask something the user already answered in their request. Never ask about infill, layer height, material, filament, printer model, supports or print time — the app owns all of those. Never ask "what do you want to make?" — if the subject itself is missing, ask what it has to fit or attach to.`,
    "",
    `Each question: 2 to ${MAX_OPTIONS} options, concrete values with units rather than vague sizes ("60 mm apart" not "medium spacing"). EXACTLY ONE option carries "recommended": true — the answer you would have silently assumed. Set "allowText": true when the honest answer is a measurement the user should type.`,
  ].filter(Boolean).join("\n");
}

function str(v: unknown, cap: number): string {
  return typeof v === "string" ? v.trim().slice(0, cap) : "";
}

/** Trust nothing the model returned: shapes, counts, and the exactly-one-recommended
 *  invariant the card's "answers are pre-filled" promise depends on. */
function sanitize(raw: unknown, fallback: string): Refinement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const improved = str(o.improved, 900) || fallback;

  const out: ClarifyQuestion[] = [];
  const seen = new Set<string>();
  for (const q of Array.isArray(o.questions) ? o.questions : []) {
    if (out.length >= MAX_QUESTIONS) break;
    if (!q || typeof q !== "object") continue;
    const qo = q as Record<string, unknown>;
    const ask = str(qo.ask, 200);
    if (!ask) continue;

    const options: ClarifyOption[] = [];
    for (const opt of Array.isArray(qo.options) ? qo.options : []) {
      if (options.length >= MAX_OPTIONS) continue;
      if (!opt || typeof opt !== "object") continue;
      const oo = opt as Record<string, unknown>;
      const label = str(oo.label, 60);
      if (!label) continue;
      options.push({ label, value: str(oo.value, 200) || label, recommended: oo.recommended === true });
    }
    // A single option is not a question, it is an assumption — drop it and let the
    // improved prompt carry it instead.
    if (options.length < 2) continue;
    // The card pre-fills from `recommended`; if the model gave none or several, the
    // pre-fill would be empty or ambiguous. Force exactly one, first-listed wins.
    const firstRec = options.findIndex((x) => x.recommended);
    options.forEach((x, i) => { x.recommended = i === (firstRec < 0 ? 0 : firstRec); });

    let id = str(qo.id, 40).replace(/[^a-z0-9_-]/gi, "") || `q${out.length + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);

    out.push({ id, ask, why: str(qo.why, 160) || undefined, options, allowText: qo.allowText === true });
  }
  return { improved, questions: out };
}

/**
 * One brain call behind both the Improve button and the vague-request card.
 *
 * `image` is the reference the user attached — a photo or a sketch. Passing it matters:
 * "make this but wider" is unanswerable as text and obvious with the picture, and it
 * lets the improved prompt describe what is actually in frame.
 */
export async function refineRequest(
  prompt: string,
  s: LlmSettings,
  keys: Record<string, string | undefined>,
  proxyBase = "",
  opts: {
    image?: { dataBase64: string; mediaType: string };
    canvas?: string;
    /** Recent chat turns, plain text — so "like I said before" refers to something. */
    convo?: string;
    engine?: "cad" | "mesh";
  } = {},
): Promise<Refinement | null> {
  const brain = utilityBrain(s, keys);
  if (!brain) return null;
  const text = prompt.trim();
  if (!text && !opts.image) return null;

  const content: ApiMsg["content"] = opts.image
    ? [
        { type: "image", mediaType: opts.image.mediaType, dataBase64: opts.image.dataBase64 },
        { type: "text", text: text.slice(0, 900) || "The user attached this reference with no description." },
      ]
    : text.slice(0, 900);

  try {
    const out = await withTimeout(
      generateLlm(brain, keys, system(opts.engine ?? "cad", opts.canvas, opts.convo), [{ role: "user", content }], {}, proxyBase),
      opts.image ? 15_000 : 10_000,
    );
    if (!out) return null;
    return sanitize(JSON.parse(extractJsonObject(out)), text);
  } catch {
    return null; // unparseable or failed — the caller builds exactly as before
  }
}

/** Fold the card's answers back into the request the user actually sent, as plain lines
 *  they can read in their own chat history. Deliberately appended to the ORIGINAL text
 *  rather than to `improved`: the built prompt should be the user's words plus what they
 *  chose, never a paraphrase they never saw. */
export function applyAnswers(prompt: string, questions: ClarifyQuestion[], answers: Record<string, string>): string {
  const lines: string[] = [];
  for (const q of questions) {
    const v = answers[q.id]?.trim();
    if (!v) continue;
    // Option values are authored as complete phrases and stand on their own ("Mount with
    // two M4 screws 60 mm apart"). A typed answer is bare — "28.5 mm" alone in the prompt
    // is a loose number with nothing to attach it to — so it carries its question along.
    lines.push(q.options.some((o) => o.value === v) ? v : `${q.ask} ${v}`);
  }
  return lines.length ? `${prompt}\n\n${lines.map((l) => `- ${l}`).join("\n")}` : prompt;
}

/** The pre-filled answer set a card opens with — every question already carrying its
 *  recommended option, so Build it works before the user touches anything. */
export function defaultAnswers(questions: ClarifyQuestion[]): Record<string, string> {
  const a: Record<string, string> = {};
  for (const q of questions) {
    const rec = q.options.find((o) => o.recommended) ?? q.options[0];
    if (rec) a[q.id] = rec.value;
  }
  return a;
}
