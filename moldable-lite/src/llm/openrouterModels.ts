// OpenRouter exposes hundreds of models under one key, so a free-text "model id"
// box is a guessing game. This fetches OpenRouter's public catalogue once (cached
// in-memory + localStorage for a day) so the Settings picker can show real model
// names and prices. Best-effort: any failure falls back to the cache or [].

export interface ORModel {
  id: string;
  name: string;
  inPrice?: number; // USD per prompt token (OpenRouter's raw pricing.prompt)
  ctx?: number;
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
        .map((m: any): ORModel => ({
          id: m.id,
          name: m.name ?? m.id,
          inPrice: m?.pricing?.prompt != null ? Number(m.pricing.prompt) : undefined,
          ctx: m?.context_length,
        }))
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
