// The beta cost meter: what did this call cost, in tokens and dollars.
//
// THE FORMULA (all provider pricing is per million tokens):
//
//   cost USD = (input_tokens / 1_000_000) × price_in + (output_tokens / 1_000_000) × price_out
//
// Tokens come from one of two places, and the meter always says which:
//   ACTUAL   — the provider reported usage on the response (Anthropic streams usage
//              events; OpenRouter returns usage + its own computed `cost` in USD when
//              asked via `usage: {include: true}` — that cost is used verbatim).
//   ESTIMATE — no usage came back, so tokens ≈ ceil(chars / 4) (the standard rough
//              rule: one token ≈ 4 characters of English/code), plus a flat
//              ~1,600 input tokens per attached image (what a ~1megapixel photo
//              costs on Anthropic's (w×h)/750 rule; other providers are in the same
//              band). Estimates are marked with ≈ everywhere they surface.
//
// A "build" = one user request, which may spend several LLM calls: routing/clarify
// (fractions of a cent on the utility brain), optional web research, then the main
// generation and any retries. The ledger records every call; the per-message print
// shows the MAIN generation's spend, which dominates.
//
// Everything is device-local (localStorage) — a solo-beta meter, not billing.

import { cachedOpenRouterModels } from "./openrouterModels";

export interface Usage {
  inTok: number;
  outTok: number;
  usd: number | null; // null = no price known for this model
  est: boolean;       // true when tokens were estimated rather than provider-reported
}

/** USD per MILLION tokens, in/out. Re-checked against platform.claude.com/docs pricing
 *  on 17 Aug 2026. Update here when providers reprice — this table is the meter's ground
 *  truth for everything except OpenRouter, whose live catalogue carries its own prices.
 *
 *  FIRST MATCH WINS, so the narrow rows sit above the family rows.
 *
 *  The Claude rows had drifted badly: Opus read 15/75 (the Opus 4.1 price, kept by the
 *  two retired models and nothing current) and Fable 20/100, so the meter quoted 2-3×
 *  what a build actually costs. That number is not just the bill — it is the "≈N
 *  cr/build" printed beside every model in the picker, which is what a model gets
 *  chosen on. */
const PRICES: { re: RegExp; in: number; out: number }[] = [
  { re: /fable|mythos/i, in: 10, out: 50 },
  // Opus 4.1 and Opus 4 kept the old pricing when they were retired; everything from
  // Opus 4.5 up is a third of that.
  { re: /opus-?4[-.]1|opus-?4(?![-.\d])/i, in: 15, out: 75 },
  { re: /opus/i, in: 5, out: 25 },
  { re: /sonnet-?5/i, in: 2, out: 10 },
  { re: /sonnet/i, in: 3, out: 15 },
  { re: /haiku/i, in: 1, out: 5 },
  { re: /gpt-5\.?1?(?!.*mini|.*nano)/i, in: 1.25, out: 10 },
  { re: /gpt.*mini/i, in: 0.25, out: 2 },
  { re: /o[34](?:-pro)?\b/i, in: 2, out: 8 },
  { re: /gemini.*pro/i, in: 1.25, out: 10 },
  { re: /gemini.*flash/i, in: 0.1, out: 0.4 },
  { re: /deepseek/i, in: 0.3, out: 1.2 },
  { re: /llama|qwen|mistral|kimi|glm/i, in: 0.2, out: 0.6 },
];

/** $/Mtok for a model, or null when unknown. OpenRouter models prefer the live
 *  catalogue's per-token price; its completion price is commonly ~4× prompt, used as
 *  the fallback ratio when the catalogue only carries the prompt price. */
export function priceFor(provider: string, model: string): { in: number; out: number } | null {
  if (provider === "local" || provider === "ollama") return { in: 0, out: 0 };
  if (provider === "openrouter") {
    const m = cachedOpenRouterModels().find((x) => x.id === model);
    if (m?.inPrice != null) {
      const inM = m.inPrice * 1e6; // catalogue stores USD per single token
      return { in: inM, out: inM * 4 };
    }
  }
  const hit = PRICES.find((p) => p.re.test(model));
  return hit ? { in: hit.in, out: hit.out } : null;
}

export const IMAGE_TOKENS = 1600; // flat per-image input estimate (~1MP photo)

/** tokens ≈ ceil(chars/4) — the standard rough cut for English + code. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function costUSD(inTok: number, outTok: number, price: { in: number; out: number } | null): number | null {
  if (!price) return null;
  return (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
}

/* ---------- device-local ledger ---------- */

const LS = "moldable_spend";

export interface Ledger {
  usd: number;      // sum of every priced call (estimates included)
  inTok: number;
  outTok: number;
  calls: number;    // every LLM call, utility included
  builds: number;   // main generations only
  since: string;    // ISO date the meter started counting
}

export function loadLedger(): Ledger {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return JSON.parse(raw) as Ledger;
  } catch { /* corrupt/private mode */ }
  return { usd: 0, inTok: 0, outTok: 0, calls: 0, builds: 0, since: new Date().toISOString().slice(0, 10) };
}

/** Anyone who wants to hear about money leaving, the moment it leaves.
 *
 *  The balance chip is the customer: a spend should move the number on screen NOW, not
 *  whenever the provider's ledger endpoint next gets polled — the provider's own figure
 *  can lag a spend by minutes, which reads as "the counter is broken". recordSpend is
 *  already the one door every priced call walks through, so this is the one place a
 *  listener can stand and miss nothing. */
type SpendListener = (u: Usage, kind: "build" | "utility", provider: string) => void;
const spendListeners = new Set<SpendListener>();
export function onSpend(fn: SpendListener): () => void {
  spendListeners.add(fn);
  return () => spendListeners.delete(fn);
}

export function recordSpend(u: Usage, kind: "build" | "utility", provider = ""): void {
  try {
    const l = loadLedger();
    l.usd += u.usd ?? 0;
    l.inTok += u.inTok;
    l.outTok += u.outTok;
    l.calls += 1;
    if (kind === "build") l.builds += 1;
    localStorage.setItem(LS, JSON.stringify(l));
  } catch { /* private mode */ }
  for (const fn of spendListeners) {
    try { fn(u, kind, provider); } catch { /* a broken listener must not lose the ledger write */ }
  }
}

export function resetLedger(): void {
  try { localStorage.removeItem(LS); } catch { /* private mode */ }
}

export function fmtUSD(v: number | null, est: boolean): string {
  if (v == null) return "$?";
  const s = v >= 0.1 ? `$${v.toFixed(2)}` : v >= 0.001 ? `$${v.toFixed(3)}` : `$${v.toFixed(5)}`;
  return est ? `≈${s}` : s;
}

export function fmtTok(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}
