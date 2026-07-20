// On-device AI (WebLLM): a small code model that runs entirely in the browser on
// WebGPU. Opt-in — the weights (~0.9 GB) download ONCE on first use, land in the
// browser's cache storage, and from then on the brain works with no network at
// all. It doubles as an automatic fallback: when the cloud provider can't be
// reached mid-request, the app retries the same request here.
//
// Quality expectations are set honestly in the UI: a 1.5B model handles simple
// parts and edits; complex geometry is where the cloud brains earn their keep.

import type { ApiMsg, StreamHandlers } from "./anthropic";

export const LOCAL_MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
export const LOCAL_SIZE_HINT = "~0.9 GB";

type Progress = { text: string; progress: number }; // progress 0..1

let engine: any = null;
let enginePromise: Promise<any> | null = null;

/** WebGPU present? (Chrome/Edge desktop, Safari 26+/iPadOS 18+.) */
export function localSupported(): boolean {
  try {
    return localMock() || (typeof navigator !== "undefined" && !!(navigator as any).gpu);
  } catch {
    return false;
  }
}

/** Test hook: `localStorage.moldable_local_mock = "1"` swaps the real 0.9 GB engine
    for an instant fake that streams a parametric cube — same pattern as the house
    relay's `moldable_house_url` override, so e2e covers the full round trip. */
function localMock(): boolean {
  try { return localStorage.getItem("moldable_local_mock") === "1"; } catch { return false; }
}

/** The weights are already on this device (previous download finished). */
export function localDownloaded(): boolean {
  try { return localMock() || localStorage.getItem("moldable_local_ready") === "1"; } catch { return false; }
}

/** Engine loaded in THIS session — a fallback can use it without a download wait. */
export function localLoaded(): boolean {
  return !!engine;
}

const MOCK_REPLY = [
  "Built by the on-device model.",
  "",
  "```js",
  "const defaultParams = { size: 25 };",
  "function main(replicad, params) {",
  "  const p = { ...defaultParams, ...params };",
  "  return replicad.makeBaseBox(p.size, p.size, p.size);",
  "}",
  "```",
].join("\n");

async function mockEngine() {
  return {
    chat: {
      completions: {
        async *create() {
          for (let i = 0; i < MOCK_REPLY.length; i += 24) {
            yield { choices: [{ delta: { content: MOCK_REPLY.slice(i, i + 24) } }] };
          }
        },
      },
    },
    __mock: true,
  };
}

/** Load (downloading on first ever use) the on-device model. Progress is streamed
    so the chat can narrate the one-time download. Safe to call repeatedly. */
export function ensureLocal(onProgress?: (p: Progress) => void): Promise<any> {
  if (engine) return Promise.resolve(engine);
  if (!enginePromise) {
    enginePromise = (async () => {
      if (localMock()) {
        engine = await mockEngine();
        return engine;
      }
      if (!localSupported()) {
        throw new Error("This device/browser has no WebGPU, which the on-device AI needs — use a cloud brain instead (Chrome/Edge desktop, or Safari on recent iPads, support it).");
      }
      const webllm = await import("@mlc-ai/web-llm");
      engine = await webllm.CreateMLCEngine(LOCAL_MODEL, {
        initProgressCallback: (r: any) => onProgress?.({ text: String(r?.text ?? ""), progress: Number(r?.progress ?? 0) }),
      });
      try { localStorage.setItem("moldable_local_ready", "1"); } catch { /* private mode */ }
      return engine;
    })().catch((e) => {
      enginePromise = null; // a failed download may retry later
      throw e;
    });
  }
  return enginePromise;
}

/** Flatten rich messages for a text-only model (images are described, not sent). */
function flatten(messages: ApiMsg[]): { role: "user" | "assistant"; content: string }[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : "[attached image — not visible to the on-device model]")).join("\n"),
  }));
}

/** Generate with the on-device model, streaming tokens like every other provider. */
export async function generateLocal(system: string, messages: ApiMsg[], h: StreamHandlers = {}, onProgress?: (p: Progress) => void): Promise<string> {
  const eng = await ensureLocal(onProgress);
  let full = "";
  const req = {
    messages: [{ role: "system", content: system }, ...flatten(messages)],
    stream: true,
    temperature: 0.2,
    max_tokens: 3000,
  };
  const chunks = eng.__mock ? await eng.chat.completions.create() : await eng.chat.completions.create(req);
  for await (const c of chunks) {
    if (h.signal?.aborted) break;
    const t = c?.choices?.[0]?.delta?.content ?? "";
    if (t) {
      full += t;
      h.onToken?.(t, full);
    }
  }
  return full;
}
