// Local spend ledger — a per-device running estimate of what paid mesh runs
// cost, so "how much have I spent?" has an answer inside the app. Amounts are
// the providers' LIST prices at generation time (the provider's own dashboard
// is the invoice of record). Stored under a LOCAL_ONLY key: estimates differ
// per device and syncing an append-on-use key would churn cloud pulls.
const LS = "moldable_spend_v1";
const MAX_ENTRIES = 500;

export interface SpendEntry {
  t: number; // epoch ms of the successful generation
  provider: string;
  model: string;
  usd: number;
}

function readAll(): SpendEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? "[]");
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.usd === "number") : [];
  } catch {
    return [];
  }
}

/** Log one successful PAID generation (free runs are skipped — nothing to add up). */
export function recordSpend(provider: string, model: string, usd: number): void {
  if (!(usd > 0)) return;
  try {
    const all = readAll();
    all.push({ t: Date.now(), provider, model, usd });
    localStorage.setItem(LS, JSON.stringify(all.slice(-MAX_ENTRIES)));
  } catch { /* the ledger is a convenience — never block a delivered model */ }
}

export interface SpendSummary {
  monthUsd: number; // estimated $ this calendar month, this device
  monthCount: number; // paid runs this calendar month
  totalUsd: number; // all recorded history on this device
  byProvider: Record<string, { usd: number; count: number }>; // this month, per engine
}

export function spendSummary(now = new Date()): SpendSummary {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const out: SpendSummary = { monthUsd: 0, monthCount: 0, totalUsd: 0, byProvider: {} };
  for (const e of readAll()) {
    out.totalUsd += e.usd;
    if (e.t < monthStart) continue;
    out.monthUsd += e.usd;
    out.monthCount += 1;
    const b = (out.byProvider[e.provider] ??= { usd: 0, count: 0 });
    b.usd += e.usd;
    b.count += 1;
  }
  return out;
}
