// Direct browser call to the Anthropic Messages API using the user's own key.
// Streaming (SSE) with an automatic non-streaming fallback. No sampling params
// (temperature/top_p) — they 400 on the latest models.

export const ANTHROPIC_VERSION = "2023-06-01";
export const API_URL = "https://api.anthropic.com/v1/messages";

// "per part" ≈ one CAD generation (roughly 5k tokens in / 1.5k out at list prices).
// Cost hints live in the PICKER, not here: brainGroups computes "≈N cr per build" from
// the price table so every row speaks the same unit as the balance chip. Hand-written
// cents in these labels drifted from the table and gave the picker two currencies.
export const MODELS = [
  { id: "claude-fable-5", label: "Claude Fable 5 (most capable)", recommended: true },
  { id: "claude-opus-5", label: "Claude Opus 5 (newest Opus)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (previous Opus)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
];

export type MsgPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; dataBase64: string }
  /** A web image by URL — the PROVIDER fetches it, which is the only route a browser
   *  app has to third-party images (CORS forbids reading the bytes client-side). Only
   *  attach these for providers whose APIs accept URL images. */
  | { type: "image_url"; url: string };

export interface ApiMsg {
  role: "user" | "assistant";
  content: string | MsgPart[];
}

function toAnthropicContent(c: string | MsgPart[]): unknown {
  if (typeof c === "string") return c;
  return c.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : p.type === "image_url"
        ? { type: "image", source: { type: "url", url: p.url } }
        : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.dataBase64 } },
  );
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
  /** Reasoning/"thinking" stream, when the model emits one (shown live in the chat). */
  onThinking?: (chunk: string, full: string) => void;
  /** Cost-meter stream. Transports emit PARTIAL records as the API reports them
   *  (token counts; OpenRouter also its computed USD cost). generateLlm emits one
   *  reconciled record with `final: true` after the call completes — estimate-filled,
   *  priced, and already written to the ledger. Callers wanting per-message spend
   *  should read only the final one. */
  onUsage?: (u: { inTok?: number; outTok?: number; usd?: number | null; est?: boolean; final?: boolean }) => void;
  /** Why the model stopped: "end_turn" / "stop" when it finished, "max_tokens" / "length"
   *  when it ran out of room mid-sentence. A truncated reply is not an error at the HTTP
   *  level and reads like a complete one, so without this a half-written program went
   *  straight to the CAD kernel and failed there as if the model had written it wrong. */
  onStop?: (reason: string) => void;
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

/** A replicad program for a real part — parametric, several features, printed notes — runs
 *  to a few thousand tokens, and 8192 cut long ones off mid-function. It is a ceiling, not
 *  a reservation: headroom nobody uses costs nothing. */
const MAX_OUT = 32000;
/** Anthropic refuses a large max_tokens on a NON-streaming request. That path here is only
 *  the rescue after a stream failure, where a cut-off answer beats a hard error. */
const MAX_OUT_NOSTREAM = 8192;

function body(r: LlmRequest, stream: boolean, maxTokens?: number) {
  return JSON.stringify({
    model: r.model,
    max_tokens: maxTokens ?? r.maxTokens ?? (stream ? MAX_OUT : MAX_OUT_NOSTREAM),
    // The system prompt (replicad API guide + rules + examples) is large and identical
    // across a session's edits, so cache it: follow-up edits within the TTL read it at
    // ~0.1x input price instead of re-billing the whole guide every time. Below the
    // provider's min cache size Anthropic simply skips caching — no error, no downside.
    system: [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }],
    messages: r.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
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
  let res = await fetch(API_URL, { method: "POST", headers: headers(r.apiKey), body: body(r, true), signal: h.signal });
  // A model whose own output ceiling is lower than what we asked for rejects the request
  // outright. Retry at the value every Claude model has always accepted rather than
  // parsing a number out of the message — a table of per-model ceilings would rot, and
  // this can only ever land where the old code already was.
  if (res.status === 400) {
    const why = await errorDetail(res);
    if (/max_tokens/i.test(why)) {
      res = await fetch(API_URL, { method: "POST", headers: headers(r.apiKey), body: body(r, true, MAX_OUT_NOSTREAM), signal: h.signal });
    } else {
      throw new Error(`Anthropic API 400: ${why}`);
    }
  }
  if (!res.ok || !res.body) throw new Error(`Anthropic API ${res.status}: ${await errorDetail(res)}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  let think = "";

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
    } else if (evt.type === "content_block_delta" && evt.delta?.type === "thinking_delta") {
      const t = evt.delta.thinking || "";
      think += t;
      h.onThinking?.(t, think);
    } else if (evt.type === "message_start" && evt.message?.usage?.input_tokens != null) {
      h.onUsage?.({ inTok: evt.message.usage.input_tokens });
    } else if (evt.type === "message_delta") {
      // Cumulative on every delta — the last one seen is the total.
      if (evt.usage?.output_tokens != null) h.onUsage?.({ outTok: evt.usage.output_tokens });
      if (evt.delta?.stop_reason) h.onStop?.(String(evt.delta.stop_reason));
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
export async function createMessage(r: LlmRequest, opts: { signal?: AbortSignal; maxRetries?: number; onStop?: (reason: string) => void } = {}): Promise<string> {
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
    if (data.stop_reason) opts.onStop?.(String(data.stop_reason));
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
    return createMessage(r, { signal: h.signal, onStop: h.onStop });
  }
}
