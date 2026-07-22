// Live credit balances. Of the five engines, only Meshy and Tripo expose a
// balance endpoint (fal/Replicate show credit on their dashboards only; the
// free HF tier has no queryable quota). Both go through the same /prox relay
// the generators use, so they work on the hosted site out of the box.
export const BALANCE_CAPABLE = new Set(["meshy", "tripo"]);

/** Where to look when the API can't tell us (or for engines with no endpoint). */
export const BALANCE_DASHBOARDS: Record<string, string> = {
  hf: "huggingface.co — free daily GPU minutes (no queryable number)",
  fal: "fal.ai/dashboard — credit shown on the billing page",
  tripo: "platform.tripo3d.ai — API wallet credits",
  meshy: "meshy.ai settings — credit balance",
  replicate: "replicate.com/account/billing — prepaid credit",
};

/** Best-effort: "1,240 credits" for Meshy/Tripo, null when unreachable/unsupported. */
export async function providerBalance(provider: string, apiKey: string, proxyBase: string): Promise<string | null> {
  if (!apiKey || !BALANCE_CAPABLE.has(provider)) return null;
  const h = { authorization: `Bearer ${apiKey}` };
  try {
    if (provider === "meshy") {
      const r = await fetch(`${proxyBase || ""}/prox/meshy/openapi/v1/balance`, { headers: h });
      if (!r.ok) return null;
      const j = await r.json();
      const bal = typeof j?.balance === "number" ? j.balance : j?.result?.balance ?? j?.data?.balance;
      return typeof bal === "number" ? `${bal.toLocaleString()} credits` : null;
    }
    if (provider === "tripo") {
      const r = await fetch(`${proxyBase || ""}/prox/tripo/v2/openapi/user/balance`, { headers: h });
      if (!r.ok) return null;
      const j = await r.json();
      const d = j?.data ?? j;
      if (typeof d?.balance !== "number") return null;
      const frozen = typeof d.frozen === "number" && d.frozen > 0 ? ` (${d.frozen.toLocaleString()} reserved for running jobs)` : "";
      return `${d.balance.toLocaleString()} credits${frozen}`;
    }
  } catch { /* offline / relay hiccup — the dashboards above always work */ }
  return null;
}
