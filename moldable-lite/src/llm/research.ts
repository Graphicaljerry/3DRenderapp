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
    `You are a dimensioning researcher for a 3D-printing CAD app. A user wants a part that must physically fit or mate with a real-world product. Request:`,
    `"${request}"`,
    ``,
    `Goal: gather EVERY real measurement the CAD model needs to build this exact part accurately — not just the overall size.`,
    ``,
    `Steps:`,
    `1. Identify the exact product(s) and model/variant (generation, size, region) the part interfaces with.`,
    `2. Reason about what THIS part is (case, cradle, stand, bracket, mount, adapter, insert, replacement, grip…) and therefore which surfaces and features it must match, clear, grip, or attach to.`,
    `3. Search the web — prefer the manufacturer's official spec/support page, then reputable teardowns (e.g. iFixit) or datasheets; avoid guessing. Cross-check when sources disagree.`,
    `4. Collect the dimensions that part needs, e.g. as relevant:`,
    `   • Overall envelope: height × width × depth/thickness (mm) and corner/edge radii.`,
    `   • Every feature the part must clear or align to: cameras/lens bump (size, offset, protrusion), buttons, switches, ports/connectors (type + position), speaker/mic grilles, screen bezel, lanyard/strap points.`,
    `   • Mounting/attachment: hole pattern & spacing, screw/thread size (e.g. M3, 1/4"-20), boss/rail/clip dimensions, connector footprints.`,
    `   • Mating tolerances: note typical FDM clearance (~0.2–0.4 mm) for any snug/press fit surface.`,
    ``,
    `Output: a compact spec sheet in MILLIMETRES, one fact per line as "label: value (source)". Group under the product name. State the product variant you assumed. Flag any figure you're unsure of with "≈". Convert all units to mm.`,
    `If the request involves no specific real-world product, reply with exactly: NONE`,
    `No markdown headers, no preamble, keep it under 220 words.`,
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

export interface ResearchResult { text: string; sources: { url: string; title?: string }[] }

function dedupeSources(list: { url: string; title?: string }[]): { url: string; title?: string }[] {
  const seen = new Set<string>();
  return list.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 6);
}

async function viaGemini(request: string, apiKey: string, preferred: string): Promise<ResearchResult | null> {
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
  const t = clean(text);
  if (!t) return null;
  // Gemini grounding metadata carries the pages the answer actually used.
  const chunks: any[] = j?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = dedupeSources(chunks.map((c) => ({ url: c?.web?.uri ?? "", title: c?.web?.title })));
  return { text: t, sources };
}

async function viaAnthropic(request: string, apiKey: string): Promise<ResearchResult | null> {
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
  const blocks: any[] = j?.content ?? [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  const t = clean(text);
  if (!t) return null;
  // web_search tool results ride along in the content blocks — collect their pages.
  const sources = dedupeSources(
    blocks
      .filter((b) => b.type === "web_search_tool_result")
      .flatMap((b) => (Array.isArray(b.content) ? b.content : []))
      .map((r: any) => ({ url: r?.url ?? "", title: r?.title })),
  );
  return { text: t, sources };
}

// OpenRouter's built-in web plugin — lets OpenRouter users (one key, many models)
// get the same grounded lookup without a separate Gemini/Anthropic key.
async function viaOpenRouter(request: string, apiKey: string, model: string): Promise<ResearchResult | null> {
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
  const msg = j?.choices?.[0]?.message;
  const t = clean(typeof msg?.content === "string" ? msg.content : "");
  if (!t) return null;
  // The web plugin annotates citations OpenAI-style.
  const anns: any[] = Array.isArray(msg?.annotations) ? msg.annotations : [];
  const sources = dedupeSources(anns.map((a) => ({ url: a?.url_citation?.url ?? "", title: a?.url_citation?.title })));
  return { text: t, sources };
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

/** Look up the product's real dimensions online. Spec sheet + the pages used, or null. */
export async function researchDimensions(request: string, keys: ResearchKeys): Promise<ResearchResult | null> {
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
