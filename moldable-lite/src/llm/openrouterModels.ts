// OpenRouter exposes hundreds of models under one key, so a free-text "model id"
// box is a guessing game. This fetches OpenRouter's public catalogue once (cached
// in-memory + localStorage for a day) so the Settings picker can show real model
// names and prices. Best-effort: any failure falls back to the cache or [].

export interface ORModel {
  id: string;
  name: string;
  inPrice?: number; // USD per prompt token (OpenRouter's raw pricing.prompt)
  ctx?: number;
  reasoning?: boolean; // model can "think" (supported_parameters includes reasoning)
  tools?: boolean;
}

const LS = "moldable_openrouter_models";
const TTL = 24 * 60 * 60 * 1000; // a day
let cache: ORModel[] | null = null;
let inflight: Promise<ORModel[]> | null = null;

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Synchronous best-effort read (in-memory, then localStorage) for first paint. */
export function cachedOpenRouterModels(): ORModel[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && Array.isArray(j.m) && Date.now() - j.t < TTL) {
        cache = j.m;
        return j.m;
      }
    }
  } catch {}
  return [];
}

/** Fetch (and cache) the live catalogue. Resolves to [] if the network fails. */
export async function fetchOpenRouterModels(): Promise<ORModel[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", { signal: timeoutSignal(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: any = await res.json();
      const models: ORModel[] = (j?.data ?? [])
        .map((m: any): ORModel => {
          const sp: string[] = Array.isArray(m?.supported_parameters) ? m.supported_parameters : [];
          return {
            id: m.id,
            name: m.name ?? m.id,
            inPrice: m?.pricing?.prompt != null ? Number(m.pricing.prompt) : undefined,
            ctx: m?.context_length,
            reasoning: sp.includes("reasoning") || sp.includes("include_reasoning"),
            tools: sp.includes("tools"),
          };
        })
        .filter((m: ORModel) => !!m.id);
      models.sort((a, b) => a.name.localeCompare(b.name));
      cache = models;
      try {
        localStorage.setItem(LS, JSON.stringify({ t: Date.now(), m: models }));
      } catch {}
      return models;
    } catch {
      return cachedOpenRouterModels();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** "$0.15/M in" style label from OpenRouter's per-token prompt price. */
export function fmtORPrice(inPrice?: number): string {
  if (inPrice == null) return "";
  if (inPrice === 0) return "free";
  const perM = inPrice * 1_000_000;
  return perM < 1 ? `$${perM.toFixed(2)}/M` : `$${perM < 10 ? perM.toFixed(1) : perM.toFixed(0)}/M`;
}

/** Short display tail for a slug: drop the vendor prefix + any ":free" suffix. */
export function shortModelName(id: string): string {
  return id.replace(/^[^/]+\//, "").replace(/:free$/, "");
}

// Moldable's brain writes replicad/CAD code from a description, so the models
// that matter are the ones strong at precise code + spatial reasoning — not the
// hundreds of chat/roleplay/vision models in the catalogue. These families are
// scored highest; reasoning ("thinking") models get a bonus because tricky
// geometry, fits and threads benefit from step-by-step reasoning.
const FAMILY: { re: RegExp; score: number }[] = [
  { re: /anthropic\/claude.*(opus|sonnet)/i, score: 100 },
  { re: /openai\/(o3|o1)\b/i, score: 96 },
  { re: /openai\/gpt-5/i, score: 95 },
  { re: /google\/gemini-[\d.]+-pro/i, score: 92 },
  { re: /deepseek\/deepseek(-r1|.*reason|-v3|-chat)/i, score: 90 },
  { re: /x-ai\/grok.*(4|3|reason)/i, score: 84 },
  { re: /openai\/gpt-4\.1(?!-nano)/i, score: 84 },
  { re: /google\/gemini-[\d.]+-flash/i, score: 82 },
  { re: /qwen.*(coder|3|2\.5)/i, score: 80 },
  { re: /mistral.*(large|codestral|medium-3)/i, score: 72 },
  { re: /meta-llama\/llama-[\d.]+-(405b|70b)/i, score: 68 },
];
const EXCLUDE = /(vision-only|image|audio|tts|whisper|embed|guard|moderation|rerank|-nano|-mini-tiny|3b|1\.5b|0\.5b)/i;

/** Coarse family key so we don't recommend eight flavours of the same model —
 *  e.g. claude-sonnet-4, -4.5, -4.6, -latest all collapse to "anthropic/claude-sonnet". */
function familyKey(id: string): string {
  const vendor = id.split("/")[0];
  const base = shortModelName(id)
    .replace(/-(preview|exp|beta|latest|instruct|thinking|\d{4}-\d{2}-\d{2}|\d{6,8})$/g, "")
    .replace(/[-.]?\d+(\.\d+)*/g, "") // strip version numbers
    .replace(/-v$/, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${vendor}/${base}`;
}

/** Best models in the live catalogue for Moldable's CAD brain — diverse across
 *  vendors/families (best of each), ranked. */
export function recommendedForApp(models: ORModel[], reasoningOnly = false): ORModel[] {
  const scored = models
    .map((m) => {
      const fam = FAMILY.find((f) => f.re.test(m.id));
      if (!fam || EXCLUDE.test(m.id)) return null;
      const score = fam.score + (m.reasoning ? 8 : 0) + (m.inPrice === 0 ? 1 : 0);
      return { m, score, family: familyKey(m.id) };
    })
    .filter((x): x is { m: ORModel; score: number; family: string } => !!x)
    .filter((x) => (reasoningOnly ? x.m.reasoning : true));
  // Keep only the best (highest score, then cheapest) model per family, so one
  // vendor with many variants can't crowd out the rest.
  const best = new Map<string, { m: ORModel; score: number; family: string }>();
  for (const x of scored) {
    const cur = best.get(x.family);
    if (!cur || x.score > cur.score || (x.score === cur.score && (x.m.inPrice ?? 9) < (cur.m.inPrice ?? 9))) best.set(x.family, x);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || (a.m.inPrice ?? 9) - (b.m.inPrice ?? 9))
    .slice(0, 8)
    .map((x) => x.m);
}

/** Does this OpenRouter model id support reasoning? (from the cached catalogue) */
export function modelSupportsReasoning(id: string): boolean {
  const m = cachedOpenRouterModels().find((x) => x.id === id);
  return !!m?.reasoning;
}

// Sentinel model id meaning "let Moldable pick the OpenRouter model per request".
export const AUTO_MODEL = "auto";

// Words that signal a geometrically/relationally HARD request that benefits from a
// stronger (often reasoning) model rather than a cheap-fast one.
const HARD_RE =
  /\b(thread|gear|involute|tangent|toleranc|press.?fit|snap.?fit|helix|spline|sweep|loft|revolve|assembl|mate|constraint|symmetr|parametric|equation|angle|degree|chamfer|gusset|lattice|honeycomb|clearance|interfere|mesh with|fit together|screw|bolt|nut|hinge|bearing)\b/i;

export interface AutoPick {
  model: ORModel;
  tier: "fast" | "strong";
  reason: string;
}

/** Classify a CAD request and choose an OpenRouter model from the recommended set:
 *  a cheap-fast model for small edits, a strong (reasoning-preferred) model for fresh
 *  generations or geometrically hard asks. Returns null if the catalogue is empty. */
export function pickAutoModel(models: ORModel[], opts: { prompt: string; isEdit: boolean }): AutoPick | null {
  const recs = recommendedForApp(models);
  if (!recs.length) return null;
  const prompt = opts.prompt ?? "";
  const words = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;
  const hard = HARD_RE.test(prompt) || words > 40 || (!opts.isEdit && words > 20);
  if (!opts.isEdit || hard) {
    // Prefer a reasoning model for hard/fresh work; otherwise the top-ranked model.
    const strong = recs.find((m) => m.reasoning) ?? recs[0];
    return { model: strong, tier: "strong", reason: !opts.isEdit ? "new model" : "complex edit" };
  }
  // Simple edit → cheapest recommended model (fast + low token cost).
  const cheap = [...recs].sort((a, b) => (a.inPrice ?? 9) - (b.inPrice ?? 9))[0] ?? recs[0];
  return { model: cheap, tier: "fast", reason: "small edit" };
}
