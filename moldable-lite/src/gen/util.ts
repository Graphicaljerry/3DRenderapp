import type { GenProgress } from "./types";

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** Fetch a result file as a Blob; if the provider CDN blocks CORS, retry via the /prox/dl relay. */
export async function fetchAsBlob(url: string, proxyBase = ""): Promise<Blob> {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.blob();
  } catch {
    /* fall through to relay */
  }
  const r2 = await fetch(`${proxyBase}/prox/dl?url=${encodeURIComponent(url)}`);
  if (!r2.ok) throw new Error(`Couldn't download the generated model (${r2.status}).`);
  return await r2.blob();
}

export interface PollOpts {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onTick?: (p: GenProgress) => void;
}

/** Poll `fn` until it returns a non-null value; `fn` may report progress via its return of undefined. */
export async function poll<T>(
  fn: () => Promise<T | undefined | null>,
  opts: PollOpts = {},
): Promise<T> {
  const { intervalMs = 2500, timeoutMs = 240_000, signal } = opts;
  const start = Date.now();
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const out = await fn();
    if (out != null) return out;
    if (Date.now() - start > timeoutMs) throw new Error("Generation timed out.");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function authHeaders(scheme: "Bearer" | "Key" | "x-api-key", key: string): Record<string, string> {
  if (scheme === "x-api-key") return { "x-api-key": key, "content-type": "application/json" };
  return { authorization: `${scheme} ${key}`, "content-type": "application/json" };
}

export async function jsonOrThrow(r: Response, name: string): Promise<any> {
  if (!r.ok) throw new Error(`${name} ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  return r.json();
}

/** Deep-scan a JSON value for the first string/`.url`/`.path` containing `needle`. */
export function findUrlDeep(data: any, needle = ".glb"): string | undefined {
  const hits: string[] = [];
  const walk = (v: any) => {
    if (!v) return;
    if (typeof v === "string") {
      if (v.includes(needle)) hits.push(v);
      return;
    }
    if (typeof v === "object") {
      if (typeof v.url === "string" && v.url.includes(needle)) hits.push(v.url);
      if (typeof v.path === "string" && v.path.includes(needle)) hits.push(v.path);
      for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(data);
  return hits[0];
}
