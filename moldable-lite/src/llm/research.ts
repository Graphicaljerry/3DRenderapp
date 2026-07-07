// Product-dimension research: when a request names a real-world product
// ("a case for my iPhone 17 Pro"), look up its exact measurements on the web
// BEFORE writing CAD code, so the part is built from real numbers instead of
// the model's memory.
//
// The lookup runs through whichever configured brain can actually browse:
//   1. Google Gemini — native "grounding with Google Search" (free-tier allowance)
//   2. Anthropic Claude — server-side web_search tool (~1¢ per search); runs on
//      Haiku 4.5 so the token side stays a fraction of a cent per lookup.
// Best-effort by design: any failure returns null and the build continues
// without the research (the CAD model then estimates from memory as before).

const EXPLICIT =
  /\b(look(?:ing|ed)?\s+up|search(?:es|ing)?\s+(?:the\s+)?(?:web|online|internet)|research|find\s+(?:the\s+)?(?:exact\s+)?(?:dimensions|measurements|specs|size))\b/i;
const PRODUCTS =
  /\b(iphone|ipad|ipod|airpods?|airtag|macbook|imac|apple\s+(?:watch|pencil|tv)|magsafe|galaxy|pixel\s+\d|oneplus|xiaomi|nothing\s+phone|nintendo|switch\s*2?\b|joy-?cons?|steam\s?deck|ps[45]|playstation|xbox|dualsense|dualshock|quest\s*\d|vision\s+pro|gopro|dji|insta360|kindle|remarkable|raspberry\s?pi|arduino|esp32|dewalt|makita|milwaukee|ryobi|bosch|game\s?boy|homepod|echo\s+dot|sonos|hydro\s?flask|yeti|stanley\s+(?:cup|tumbler))\b/i;

/** True when the request likely needs real product measurements from the web. */
export function detectProductQuery(prompt: string): boolean {
  return EXPLICIT.test(prompt) || PRODUCTS.test(prompt);
}

function researchPrompt(request: string): string {
  return [
    `A user wants to 3D-print a part that must fit a real-world product. Their request:`,
    `"${request}"`,
    ``,
    `1. Identify the exact product(s) the part must fit.`,
    `2. Search the web for that product's official physical dimensions.`,
    `3. Reply as a compact spec sheet in millimetres — one fact per line, with the source site in parentheses.`,
    `   Include: overall height x width x depth/thickness, corner radius, and the size/position of anything`,
    `   the part must clear (camera bump, buttons, ports, lens, straps).`,
    ``,
    `If the request involves no specific real-world product, reply with exactly: NONE`,
    `No markdown, no preamble, under 150 words.`,
  ].join("\n");
}

function clean(text: string): string | null {
  const t = text.trim();
  if (!t || /^NONE\b/i.test(t)) return null;
  return t;
}

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function viaGemini(request: string, apiKey: string, preferred: string): Promise<string | null> {
  // Reuse the model id the compat layer already resolved against this key.
  let model = "";
  try {
    model = localStorage.getItem("moldable_gemini_model") ?? "";
  } catch {}
  model = model || preferred || "gemini-2.0-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: researchPrompt(request) }] }],
      tools: [{ google_search: {} }],
    }),
    signal: timeoutSignal(45_000),
  });
  if (!res.ok) throw new Error(`Gemini research HTTP ${res.status}`);
  const j: any = await res.json();
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((part: any) => part?.text ?? "").join("");
  return clean(text);
}

async function viaAnthropic(request: string, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5", // cheap + fast — plenty for a dimension lookup
      max_tokens: 1024,
      messages: [{ role: "user", content: researchPrompt(request) }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    }),
    signal: timeoutSignal(60_000),
  });
  if (!res.ok) throw new Error(`Claude research HTTP ${res.status}`);
  const j: any = await res.json();
  const text = (j?.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  return clean(text);
}

// OpenRouter's built-in web plugin — lets OpenRouter users (one key, many models)
// get the same grounded lookup without a separate Gemini/Anthropic key.
async function viaOpenRouter(request: string, apiKey: string, model: string): Promise<string | null> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://moldable.app",
      "X-Title": "Moldable",
    },
    body: JSON.stringify({
      model: model || "google/gemini-2.5-flash",
      messages: [{ role: "user", content: researchPrompt(request) }],
      plugins: [{ id: "web", max_results: 3 }],
      max_tokens: 1024,
    }),
    signal: timeoutSignal(60_000),
  });
  if (!res.ok) throw new Error(`OpenRouter research HTTP ${res.status}`);
  const j: any = await res.json();
  const text = j?.choices?.[0]?.message?.content;
  return clean(typeof text === "string" ? text : "");
}

export interface ResearchKeys {
  geminiKey?: string;
  geminiModel?: string;
  anthropicKey?: string;
  openrouterKey?: string;
  openrouterModel?: string;
}

/** True when at least one configured provider can actually browse the web. */
export function canResearch(keys: ResearchKeys): boolean {
  return !!(keys.geminiKey || keys.anthropicKey || keys.openrouterKey);
}

/** Look up the product's real dimensions online. Plain-text spec sheet, or null. */
export async function researchDimensions(request: string, keys: ResearchKeys): Promise<string | null> {
  if (keys.geminiKey) {
    try {
      const r = await viaGemini(request, keys.geminiKey, keys.geminiModel ?? "");
      if (r) return r;
    } catch {}
  }
  if (keys.anthropicKey) {
    try {
      const r = await viaAnthropic(request, keys.anthropicKey);
      if (r) return r;
    } catch {}
  }
  if (keys.openrouterKey) {
    try {
      return await viaOpenRouter(request, keys.openrouterKey, keys.openrouterModel ?? "");
    } catch {}
  }
  return null;
}
