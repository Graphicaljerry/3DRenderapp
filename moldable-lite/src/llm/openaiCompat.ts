// OpenAI-compatible /chat/completions client (streaming SSE + non-streaming
// fallback). One code path serves OpenAI, Google Gemini (its OpenAI-compat
// endpoint), Groq, OpenRouter, local Ollama, and any custom endpoint.
// If a direct browser call fails on network/CORS, we retry through the relay
// (dev server or the deployed Worker) when one is available.

import type { ApiMsg, StreamHandlers } from "./anthropic";
import { relayAvailable } from "../gen/util";

export interface CompatRequest {
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey?: string;
  model: string;
  system: string;
  messages: ApiMsg[];
  relayPrefix?: string; // e.g. "groq" -> /prox/groq/<path> when direct fails
  proxyBase?: string;
}

function toCompatContent(c: import("./anthropic").ApiMsg["content"]): unknown {
  if (typeof c === "string") return c;
  return c.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } },
  );
}

function body(r: CompatRequest, stream: boolean): string {
  // No token/temperature caps: parameter names differ across providers and the
  // replicad programs are small; provider defaults are fine.
  return JSON.stringify({
    model: r.model,
    stream,
    messages: [
      { role: "system", content: r.system },
      ...r.messages.map((m) => ({ role: m.role, content: toCompatContent(m.content) })),
    ],
  });
}

function endpoint(r: CompatRequest, viaRelay: boolean): string {
  const base = r.baseUrl.replace(/\/$/, "");
  if (!viaRelay) return `${base}/chat/completions`;
  const u = new URL(base);
  return `${r.proxyBase || ""}/prox/${r.relayPrefix}${u.pathname.replace(/\/$/, "")}/chat/completions`;
}

async function post(r: CompatRequest, stream: boolean, viaRelay: boolean): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (r.apiKey) headers.authorization = `Bearer ${r.apiKey}`;
  return fetch(endpoint(r, viaRelay), { method: "POST", headers, body: body(r, stream), signal: undefined });
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j: any = await res.json();
    return j?.error?.message ?? j?.message ?? JSON.stringify(j).slice(0, 300);
  } catch {
    return (await res.text().catch(() => "")).slice(0, 300) || res.statusText;
  }
}

async function parseSSE(res: Response, h: StreamHandlers): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  const frame = (f: string) => {
    for (const line of f.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const j: any = JSON.parse(data);
        const t = j.choices?.[0]?.delta?.content ?? "";
        if (t) {
          full += t;
          h.onToken?.(t, full);
        }
      } catch {
        /* ignore keep-alives */
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const f = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (f.trim()) frame(f);
      }
    }
    if (buf.trim()) frame(buf);
  } finally {
    reader.releaseLock();
  }
  return full;
}

async function attempt(r: CompatRequest, h: StreamHandlers): Promise<string> {
  const canRelay = !!r.relayPrefix && relayAvailable(r.proxyBase || "");
  let res: Response | null = null;
  let viaRelay = false;

  try {
    res = await post(r, true, false);
  } catch {
    if (!canRelay) {
      throw new Error(
        `Couldn't reach ${new URL(r.baseUrl).host} from the browser (network or CORS). ` +
          `Run locally with npm run dev (built-in relay), or deploy the proxy/ Worker and set its URL in Settings.`,
      );
    }
    viaRelay = true;
    res = await post(r, true, true);
  }

  if (!res.ok) throw new Error(`${new URL(r.baseUrl).host} ${res.status}: ${await errorDetail(res)}`);
  if (res.body) {
    const text = await parseSSE(res, h);
    if (text) return text;
  }
  // Some gateways ignore stream:true — retry non-streaming on the same route.
  const res2 = await post(r, false, viaRelay);
  if (!res2.ok) throw new Error(`${new URL(r.baseUrl).host} ${res2.status}: ${await errorDetail(res2)}`);
  const data: any = await res2.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("The model returned an empty reply.");
  return text;
}

// ---- self-healing model ids ------------------------------------------------
// Provider model names churn (e.g. Google renaming Flash ids). When a model id
// 404s, ask the provider's /models list and auto-pick the best match, then
// remember it for the session.
const resolvedModels = new Map<string, string>();

export function pickGeminiModel(ids: string[]): string | undefined {
  const clean = ids.map((id) => id.replace(/^models\//, ""));
  const score = (s: string) => parseFloat(s.match(/gemini-([\d.]+)/)?.[1] ?? "0");
  const best = (list: string[]) => list.sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
  const flash = clean.filter((id) => /^gemini-[\d.]+-flash/.test(id) && !/(lite|image|audio|tts|live|embed|thinking|exp)/i.test(id));
  if (flash.length) return best(flash);
  const anyFlash = clean.filter((id) => /gemini.*flash/i.test(id) && !/(image|audio|tts|live|embed)/i.test(id));
  if (anyFlash.length) return best(anyFlash);
  const anyGemini = clean.filter((id) => /^gemini-/.test(id));
  return anyGemini.length ? best(anyGemini) : undefined;
}

async function listModels(r: CompatRequest): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (r.apiKey) headers.authorization = `Bearer ${r.apiKey}`;
  const url = (viaRelay: boolean) =>
    viaRelay
      ? `${r.proxyBase || ""}/prox/${r.relayPrefix}${new URL(r.baseUrl).pathname.replace(/\/$/, "")}/models`
      : `${r.baseUrl.replace(/\/$/, "")}/models`;
  let res: Response;
  try {
    res = await fetch(url(false), { headers });
  } catch {
    if (!r.relayPrefix || !relayAvailable(r.proxyBase || "")) throw new Error("models list unreachable");
    res = await fetch(url(true), { headers });
  }
  if (!res.ok) throw new Error(`models list HTTP ${res.status}`);
  const data: any = await res.json();
  const arr = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
  return arr.map((m: any) => String(m.id ?? m.name ?? "")).filter(Boolean);
}

/** Stream a completion with model-id self-healing + direct→relay fallback. */
export async function generateCompat(r: CompatRequest, h: StreamHandlers = {}): Promise<string> {
  const cacheKey = `${r.baseUrl}|${r.model}`;
  const cached = resolvedModels.get(cacheKey);
  if (cached) r = { ...r, model: cached };

  try {
    return await attempt(r, h);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const isGemini = /generativelanguage/.test(r.baseUrl);
    const modelMissing = /404|not[_\s]?found/i.test(msg) && /model/i.test(msg);
    if (isGemini && modelMissing) {
      try {
        const good = pickGeminiModel(await listModels(r));
        if (good && good !== r.model) {
          resolvedModels.set(cacheKey, good);
          return await attempt({ ...r, model: good }, h);
        }
      } catch {
        /* fall through to the original error */
      }
    }
    throw e;
  }
}
