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
  extraBody?: Record<string, unknown>; // provider-specific extras (e.g. OpenRouter `reasoning`)
  cacheSystem?: boolean; // mark the system prompt as a cache breakpoint (OpenRouter)
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
  // OpenRouter honours an Anthropic-style cache_control breakpoint on the system
  // message (read ~0.1x for cache-supporting models; ignored by providers that cache
  // implicitly), so a session's edits don't re-bill the whole static system prompt.
  const systemMsg = r.cacheSystem
    ? { role: "system", content: [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }] }
    : { role: "system", content: r.system };
  return JSON.stringify({
    model: r.model,
    stream,
    messages: [
      systemMsg,
      ...r.messages.map((m) => ({ role: m.role, content: toCompatContent(m.content) })),
    ],
    ...(r.extraBody ?? {}),
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
    const e0 = Array.isArray(j) ? j[0] : j; // Google's compat layer array-wraps errors
    return e0?.error?.message ?? e0?.message ?? JSON.stringify(j).slice(0, 300);
  } catch {
    return (await res.text().catch(() => "")).slice(0, 300) || res.statusText;
  }
}

async function parseSSE(res: Response, h: StreamHandlers): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  let think = "";
  const frame = (f: string) => {
    for (const line of f.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const j: any = JSON.parse(data);
        const d = j.choices?.[0]?.delta;
        const t = d?.content ?? "";
        if (t) {
          full += t;
          h.onToken?.(t, full);
        }
        // Reasoning models stream their thinking separately (OpenRouter: `reasoning`;
        // some compat providers: `reasoning_content`) — surface it live.
        const rt = d?.reasoning ?? d?.reasoning_content ?? "";
        if (typeof rt === "string" && rt) {
          think += rt;
          h.onThinking?.(rt, think);
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

// ---- Gemini model resolution -------------------------------------------------
// Google's model ids churn and the OpenAI-compat layer has NO /models route
// (verified: it 404s). So BEFORE the first Gemini call we ask the NATIVE
// ListModels endpoint (/v1beta/models — verified live) which ids this key can
// use with generateContent, prefer the configured id when valid, otherwise the
// best Flash model — and cache the result.

interface GModel {
  name: string;
  methods: string[];
}

export function pickGeminiModel(models: GModel[], preferred: string): string | undefined {
  const usable = models
    .filter((m) => m.methods.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  if (preferred && usable.includes(preferred)) return preferred;
  const score = (s: string) => parseFloat(s.match(/gemini-([\d.]+)/)?.[1] ?? "0");
  const best = (list: string[]) => [...list].sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
  const flash = usable.filter((id) => /^gemini-[\d.]+-flash/.test(id) && !/(lite|image|audio|tts|live|embed|thinking|exp)/i.test(id));
  if (flash.length) return best(flash);
  const anyFlash = usable.filter((id) => /flash/i.test(id) && !/(image|audio|tts|live|embed)/i.test(id));
  if (anyFlash.length) return best(anyFlash);
  const anyGemini = usable.filter((id) => /^gemini-/.test(id));
  return anyGemini.length ? best(anyGemini) : undefined;
}

const GEMINI_CACHE = "moldable_gemini_model";
const geminiMemo = new Map<string, Promise<string>>();

async function resolveGeminiModel(r: CompatRequest): Promise<string> {
  const origin = new URL(r.baseUrl).origin;
  const headers: Record<string, string> = r.apiKey ? { "x-goog-api-key": r.apiKey } : {};
  const path = "/v1beta/models?pageSize=1000";
  let res: Response | null = null;
  try {
    res = await fetch(`${origin}${path}`, { headers });
  } catch {
    /* network / CORS — try the relay below */
  }
  // If the direct call is blocked (CORS) or fails, retry the model list through
  // the relay just like generation does — otherwise a CORS block silently pins
  // us to a stale cached model that may have been retired.
  if ((!res || !res.ok) && r.relayPrefix && relayAvailable(r.proxyBase || "")) {
    try {
      res = await fetch(`${r.proxyBase || ""}/prox/${r.relayPrefix}${path}`, { headers });
    } catch { /* fall through to cache */ }
  }
  if (!res || !res.ok) {
    try {
      const cached = localStorage.getItem(GEMINI_CACHE);
      if (cached) return cached;
    } catch {}
    throw new Error(
      `Couldn't fetch your Gemini model list (${res ? `HTTP ${res.status}` : "network error"}) — double-check the Gemini API key in Settings (aistudio.google.com/apikey).`,
    );
  }
  const data: any = await res.json();
  const models: GModel[] = (data.models ?? []).map((m: any) => ({
    name: String(m.name ?? ""),
    methods: (m.supportedGenerationMethods ?? []) as string[],
  }));
  const pick = pickGeminiModel(models, r.model);
  if (!pick) throw new Error("Your Gemini key lists no models that support text generation — check the key/project at aistudio.google.com.");
  try {
    localStorage.setItem(GEMINI_CACHE, pick);
  } catch {}
  return pick;
}

/** Stream a completion; Gemini ids are resolved against the live model list first. */
export async function generateCompat(r: CompatRequest, h: StreamHandlers = {}): Promise<string> {
  if (!/generativelanguage/.test(r.baseUrl)) return attempt(r, h);

  const key = `${r.apiKey ?? ""}|${r.model}`;
  const resolve = () => {
    if (!geminiMemo.has(key)) {
      const p = resolveGeminiModel(r);
      p.catch(() => geminiMemo.delete(key)); // don't cache failures
      geminiMemo.set(key, p);
    }
    return geminiMemo.get(key)!;
  };
  try {
    return await attempt({ ...r, model: await resolve() }, h);
  } catch (e: any) {
    // A resolved id can still be retired between the list fetch and the call.
    // Drop the poisoned memo + cache, re-pick the best live model, and retry once.
    if (/no longer available|not found|is not supported|404/i.test(String(e?.message ?? e))) {
      geminiMemo.delete(key);
      try { localStorage.removeItem(GEMINI_CACHE); } catch {}
      const fresh = await resolveGeminiModel({ ...r, model: "" }); // "" → ignore preferred, take best live
      return await attempt({ ...r, model: fresh }, h);
    }
    throw e;
  }
}
