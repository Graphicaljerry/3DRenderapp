// Direct browser call to the Anthropic Messages API using the user's own key.
// Streaming (SSE) with an automatic non-streaming fallback. No sampling params
// (temperature/top_p) — they 400 on the latest models.

export const ANTHROPIC_VERSION = "2023-06-01";
export const API_URL = "https://api.anthropic.com/v1/messages";

export const MODELS = [
  { id: "claude-fable-5", label: "Claude Fable 5 (newest, most capable — default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
];

export interface ApiMsg {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  apiKey: string;
  model: string;
  system: string;
  messages: ApiMsg[];
  maxTokens?: number;
}

export interface StreamHandlers {
  onToken?: (chunk: string, full: string) => void;
  signal?: AbortSignal;
}

function headers(apiKey: string) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function body(r: LlmRequest, stream: boolean) {
  return JSON.stringify({
    model: r.model,
    max_tokens: r.maxTokens ?? 8192,
    system: r.system,
    messages: r.messages,
    stream,
  });
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return (j as { error?: { message?: string } })?.error?.message ?? JSON.stringify(j);
  } catch {
    return (await res.text().catch(() => "")) || res.statusText;
  }
}

// ---------- streaming (SSE) ----------
export async function streamMessage(r: LlmRequest, h: StreamHandlers = {}): Promise<string> {
  const res = await fetch(API_URL, { method: "POST", headers: headers(r.apiKey), body: body(r, true), signal: h.signal });
  if (!res.ok || !res.body) throw new Error(`Anthropic API ${res.status}: ${await errorDetail(res)}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";

  const handleFrame = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      const t = evt.delta.text || "";
      full += t;
      h.onToken?.(t, full);
    } else if (evt.type === "error") {
      throw new Error(`stream error: ${evt.error?.type} — ${evt.error?.message}`);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (frame.trim()) handleFrame(frame);
      }
    }
    if (buf.trim()) handleFrame(buf);
  } finally {
    reader.releaseLock();
  }
  return full;
}

// ---------- non-streaming fallback ----------
export async function createMessage(r: LlmRequest, opts: { signal?: AbortSignal; maxRetries?: number } = {}): Promise<string> {
  const b = body(r, false);
  const maxRetries = opts.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(API_URL, { method: "POST", headers: headers(r.apiKey), body: b, signal: opts.signal });
    } catch (e) {
      if (attempt < maxRetries) {
        await backoff(attempt);
        continue;
      }
      throw e;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await backoff(attempt, Number(res.headers.get("retry-after")) || 0);
      continue;
    }
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await errorDetail(res)}`);
    const data = await res.json();
    return ((data.content || []) as { type: string; text?: string }[])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("");
  }
}

function backoff(attempt: number, retryAfterSec = 0) {
  const ms = retryAfterSec ? retryAfterSec * 1000 : Math.min(1000 * 2 ** attempt, 15000);
  return new Promise((r) => setTimeout(r, ms + Math.random() * 300));
}

/** Stream; automatically fall back to non-streaming on stream failure. */
export async function generate(r: LlmRequest, h: StreamHandlers = {}): Promise<string> {
  try {
    return await streamMessage(r, h);
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return createMessage(r, { signal: h.signal });
  }
}
