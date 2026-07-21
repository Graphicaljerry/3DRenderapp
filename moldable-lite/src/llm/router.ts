// Intent routing + mesh-prompt polish: tiny, fast LLM calls that make the two
// engines feel like one. Both run through generateLlm, so they work with ANY
// configured brain — OpenRouter, Gemini, Anthropic, Groq, Ollama, the house
// relay… — the same key the user already set up for Precise CAD now also powers
// the mesh side's smarts. Everything here is best-effort: any failure or
// timeout returns null and the caller falls back to the regex heuristics.

import { generateLlm, llmReady, type LlmSettings } from "./llm";
import { AUTO_MODEL } from "./openrouterModels";
import { localLoaded } from "./local";

/** Cap a brain call; the underlying request may still finish, we just stop waiting. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);
}

/** A settings object safe for tiny utility calls: OpenRouter "Auto" collapses to the
 *  cheap default (a 3-token classification doesn't need model routing), and the
 *  on-device brain is only used when its weights are ALREADY loaded — a routing
 *  hint must never trigger a 0.9 GB download. Null = skip the LLM, use regexes. */
function utilityBrain(s: LlmSettings, keys: Record<string, string | undefined>): LlmSettings | null {
  if (!llmReady(s, keys)) return null;
  if (s.provider === "local" && !localLoaded()) return null;
  if (s.provider === "openrouter" && s.model === AUTO_MODEL) return { ...s, model: "" }; // preset default
  return s;
}

/** Which engine fits this request? "cad" = parametric/dimensioned/functional,
 *  "mesh" = organic/sculptural/artistic. Null = couldn't tell (or no brain). */
export async function classifyIntent(
  prompt: string,
  s: LlmSettings,
  keys: Record<string, string | undefined>,
  proxyBase = "",
): Promise<"cad" | "mesh" | null> {
  const brain = utilityBrain(s, keys);
  if (!brain) return null;
  const system = [
    "You route requests in a 3D-printing app between two engines. Reply with exactly one word:",
    "CAD — functional/geometric parts: brackets, cases, mounts, adapters, gears, anything with dimensions, holes, threads, fits, or made of simple geometric forms (boxes, cylinders). CAD gives exact measurements and STEP export.",
    "MESH — organic/sculptural/artistic shapes: figurines, characters, animals, faces, statues, freeform art. An AI mesh generator sculpts these far better than CAD.",
    "When both could work, prefer CAD (it prints more reliably and stays editable). Reply CAD or MESH only.",
  ].join("\n");
  try {
    const out = await withTimeout(
      generateLlm(brain, keys, system, [{ role: "user", content: prompt.slice(0, 500) }], {}, proxyBase),
      8000,
    );
    if (!out) return null;
    const t = out.trim().toUpperCase();
    if (/^\W*CAD\b/.test(t)) return "cad";
    if (/^\W*MESH\b/.test(t)) return "mesh";
  } catch { /* best-effort */ }
  return null;
}

/** Expand a terse text→3D ask ("a dragon") into the detailed visual description
 *  mesh generators want. Only called for short prompts; null = use the original. */
export async function polishMeshPrompt(
  prompt: string,
  s: LlmSettings,
  keys: Record<string, string | undefined>,
  proxyBase = "",
): Promise<string | null> {
  const brain = utilityBrain(s, keys);
  if (!brain) return null;
  const system = [
    "You write prompts for text-to-3D mesh generators (Hunyuan3D, Rodin, Meshy, Tripo) inside a 3D-printing app.",
    "Rewrite the user's request as ONE richer visual description of a single object: overall form, pose, proportions, key surface details, style. Keep every constraint the user stated (subject, style, any sizes).",
    "3D-print friendly: one connected solid, stable to stand, no paper-thin parts or floating pieces.",
    "Reply with the description only — no preamble, no quotes, under 60 words. If the request is already detailed, reply with it unchanged.",
  ].join("\n");
  try {
    const out = await withTimeout(
      generateLlm(brain, keys, system, [{ role: "user", content: prompt.slice(0, 500) }], {}, proxyBase),
      9000,
    );
    const t = out?.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    if (t && t.length >= 12 && t.length < 700) return t;
  } catch { /* best-effort */ }
  return null;
}
