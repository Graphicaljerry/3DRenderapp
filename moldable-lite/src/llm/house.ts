// Optional "house AI": the site owner sponsors visitors with a server-side key, so
// people can use Precise mode with NO key and NO setup. OFF by default — the app only
// offers it after a live health check against the owner's relay says it's enabled.
//
// To enable (see proxy/DEPLOY.md → "Sponsor your visitors"):
//   1. Deploy proxy/cloudflare-worker.js (you may already have, for the 3D engines).
//   2. `wrangler secret put HOUSE_KEY` with your OpenRouter (or compatible) API key.
//   3. Put the worker URL in HOUSE_RELAY_URL below, commit, redeploy the site.
// To disable again: delete the secret (health reports disabled; the app hides it).

export const HOUSE_RELAY_URL = "";

/** The active relay URL — the committed constant, or a local override for testing
 *  (`localStorage.moldable_house_url`). Empty string = feature off. */
export function houseUrl(): string {
  try {
    return (localStorage.getItem("moldable_house_url") || HOUSE_RELAY_URL).replace(/\/+$/, "");
  } catch {
    return HOUSE_RELAY_URL.replace(/\/+$/, "");
  }
}

export interface HouseStatus {
  url: string;
  models: string[]; // allowlist, first entry = default
  daily?: number; // per-visitor daily request cap, for honest UI copy
}

let cached: HouseStatus | null = null;
/** Last successful health result — lets the LLM dispatch pick the default model
 *  without threading state through every call site. */
export function houseStatus(): HouseStatus | null {
  return cached;
}

/** Probe the relay once at boot. Fast-fails quietly: no relay, no feature. */
export async function fetchHouseStatus(): Promise<HouseStatus | null> {
  const u = houseUrl();
  if (!u) return (cached = null);
  try {
    const r = await fetch(`${u}/house/health`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return (cached = null);
    const j = (await r.json()) as { enabled?: boolean; models?: string[]; daily?: number };
    cached = j?.enabled ? { url: u, models: j.models ?? [], daily: j.daily } : null;
    return cached;
  } catch {
    return (cached = null);
  }
}
