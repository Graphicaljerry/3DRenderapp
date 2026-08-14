// What's left in the tank, and the one place the app's own unit is defined.
//
// TWO SEPARATE THINGS, deliberately kept apart:
//
//   1. BALANCE — real money, read live from OpenRouter. Nothing here invents it; it is
//      whatever the provider says, and when the provider can't be reached the app says
//      so rather than showing a stale number as if it were current.
//
//   2. CREDITS — the app's own unit, a pure display skin over USD. One conversion, in
//      one place (`PRICING` below), so what a user is charged can stop tracking what a
//      call costs without touching a single call site. Today it is at cost: no markup,
//      no rounding games, and the tooltip everywhere says the real dollar figure, so
//      "credits" is a friendlier scale rather than a way to obscure the price.
//
// Why a unit at all: sub-cent dollars read terribly. "$0.00421" is noise; "4 credits"
// is a quantity you can hold in your head and compare against a balance.
//
// WHEN THIS COMMERCIALISES: change `PRICING`, not the call sites. A markup, a per-build
// floor, a subscription grant — all of them are arithmetic on the way in and out of
// these three functions. The ledger keeps recording true USD underneath either way,
// which is what makes the two numbers reconcilable later.

export const PRICING = {
  /** Credits per US dollar. 1 credit = $0.001, so a typical CAD build lands in the
   *  low single digits and $10 of balance reads as 10,000 — numbers with a useful
   *  amount of resolution that still fit in a chip. */
  creditsPerUsd: 1000,
  /** What the user is charged per dollar of real cost. 1 = at cost, which is where a
   *  bring-your-own-key beta belongs: the key is theirs and the bill is already theirs.
   *  Raise this (and only this) to price above cost. */
  markup: 1,
  /** Shown beside the number. Kept here so renaming the unit is one line, not a sweep
   *  through the UI. */
  unit: "credits",
  unitShort: "cr",
};

/** Real dollars → the app's unit. The only place the two are related. */
export function usdToCredits(usd: number): number {
  return usd * PRICING.creditsPerUsd * PRICING.markup;
}

/** The app's unit → real dollars. Inverse of the above; used to state the true cost. */
export function creditsToUsd(credits: number): number {
  return credits / (PRICING.creditsPerUsd * PRICING.markup);
}

/** Credits for display. Whole numbers once there are enough of them to matter, one
 *  decimal below that — a single build should never round away to "0". Grouped at
 *  every scale: 1750 and 20,500 sitting in the same UI is just sloppy. */
export function fmtCredits(credits: number, est = false): string {
  const v = Math.abs(credits);
  const s = v >= 10 ? Math.round(credits).toLocaleString()
    : v >= 0.1 ? credits.toFixed(1)
    : credits.toFixed(2);
  return est ? `≈${s}` : s;
}

/* ---------- what things cost, before you spend ----------
   The Gamma/Chatbase pattern: every place a model can be picked or a balance is
   shown also says what an action will roughly cost — in the same unit as the
   balance, so "can I afford this" is subtraction, not research. */

/** Token shape of a typical CAD build: the system prompt + code context dominate the
 *  input; the program dominates the output. Used ONLY when the device's own ledger
 *  has no history yet — real averages take over as soon as they exist. */
export const EST_BUILD_TOKENS = { in: 12_000, out: 1_500 };

/** ≈ credits for one build on a given $/Mtok price, from real ledger averages when
 *  there are enough builds to trust, else from EST_BUILD_TOKENS. Null = price unknown. */
export function estBuildCredits(
  price: { in: number; out: number } | null,
  ledger?: { usd: number; inTok: number; outTok: number; builds: number },
): number | null {
  if (ledger && ledger.builds >= 3 && ledger.usd > 0) {
    // The device's own history — the most honest estimate available, and it already
    // includes routing/clarify overhead a per-model figure can't know about.
    return usdToCredits(ledger.usd / ledger.builds);
  }
  if (!price) return null;
  const usd = (EST_BUILD_TOKENS.in / 1e6) * price.in + (EST_BUILD_TOKENS.out / 1e6) * price.out;
  return usdToCredits(usd);
}

/* ---------- the live balance ---------- */

export interface Balance {
  /** Credits left in real USD. Null = no spending cap on this key, so there is no
   *  "left" to report — not zero, and the UI must not draw it as empty. */
  remainingUsd: number | null;
  /** Spent so far, real USD, across every app using this key. */
  usedUsd: number | null;
  /** The cap the remaining figure is measured against, when there is one. */
  limitUsd: number | null;
  freeTier: boolean;
  /** When this was read, ms. The UI ages it rather than implying it is live. */
  at: number;
}

/** Pull a number out of whichever spelling the payload happens to use. OpenRouter has
 *  shipped more than one shape for this and a balance readout is not worth breaking
 *  over a renamed field — anything unparseable is simply absent. */
function num(o: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
  }
  return null;
}

async function getJson(url: string, key: string, signal: AbortSignal): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null; // offline, CORS, a key without introspection rights
  }
}

/** Read the OpenRouter balance for a key. Null = could not be read; the caller shows
 *  "couldn't reach OpenRouter", never a zero. Tries the account-wide credits endpoint
 *  first (the number on the dashboard), then falls back to the per-key one, which is
 *  all a key with a spend limit can see. */
export async function fetchBalance(key: string, timeoutMs = 12_000): Promise<Balance | null> {
  if (!key) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const credits = await getJson("https://openrouter.ai/api/v1/credits", key, ac.signal);
    const cd = credits?.data ?? credits;
    const granted = num(cd, "total_credits", "totalCredits", "credits", "limit");
    const used = num(cd, "total_usage", "totalUsage", "usage");
    if (granted != null && used != null) {
      return { remainingUsd: granted - used, usedUsd: used, limitUsd: granted, freeTier: false, at: Date.now() };
    }

    const keyInfo = await getJson("https://openrouter.ai/api/v1/key", key, ac.signal);
    const kd = keyInfo?.data ?? keyInfo;
    if (!kd) return null;
    const kUsed = num(kd, "usage", "total_usage");
    const kLimit = num(kd, "limit", "credit_limit");
    const kLeft = num(kd, "limit_remaining", "limitRemaining");
    if (kUsed == null && kLimit == null && kLeft == null) return null;
    return {
      remainingUsd: kLeft != null ? kLeft : kLimit != null && kUsed != null ? kLimit - kUsed : null,
      usedUsd: kUsed,
      limitUsd: kLimit,
      freeTier: kd.is_free_tier === true,
      at: Date.now(),
    };
  } finally {
    clearTimeout(t);
  }
}

/* ---------- cache ----------
   The balance survives a reload so the chip has something to draw immediately, and is
   re-read on mount and after every build. It is stamped, never presented as live: an
   hour-old figure says so. */

const LS = "moldable_balance";

export function loadBalance(): Balance | null {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    const b = JSON.parse(raw) as Balance;
    return typeof b?.at === "number" ? b : null;
  } catch {
    return null;
  }
}

export function saveBalance(b: Balance | null): void {
  try {
    if (b) localStorage.setItem(LS, JSON.stringify(b));
    else localStorage.removeItem(LS);
  } catch { /* private mode */ }
}

/** "just now" / "12 min ago" / "3 h ago" — how much to trust the number. */
export function ageLabel(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
