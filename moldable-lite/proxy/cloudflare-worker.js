// Moldable relay — Cloudflare Worker version of the local Vite dev proxy.
// Deploy this ONLY when you host the app publicly (locally, `npm run dev`'s built-in
// relay already does this). It forwards /prox/<provider>/... to the real API and
// /prox/dl?url=... for result files. The user's key rides in the Authorization
// header from the browser and is forwarded as-is — it is NOT stored here.
//
// Deploy:
//   npm i -g wrangler
//   wrangler deploy proxy/cloudflare-worker.js --name moldable-relay
// Then in the app's Settings set "Proxy base URL" to the Worker URL
// (e.g. https://moldable-relay.<you>.workers.dev).

const UPSTREAM = {
  meshy: "https://api.meshy.ai",
  tripo: "https://api.tripo3d.ai",
  replicate: "https://api.replicate.com",
  fal: "https://fal.run",
  falqueue: "https://queue.fal.run",
  // LLM providers (CORS fallback for the Precise engine)
  gemini: "https://generativelanguage.googleapis.com",
  openai: "https://api.openai.com",
  groq: "https://api.groq.com",
  openrouter: "https://openrouter.ai",
};

// Lock this down to your app's origin(s) in production.
const ALLOW_ORIGIN = "*";

function cors(h = {}) {
  return {
    "access-control-allow-origin": ALLOW_ORIGIN,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key,prefer",
    ...h,
  };
}

// ---- Optional "house AI" — sponsor your visitors with YOUR key (off by default) ----
// Enable:  wrangler secret put HOUSE_KEY        (an OpenRouter key works best)
// Tune:    HOUSE_BASE   OpenAI-compatible base   (default https://openrouter.ai/api/v1)
//          HOUSE_MODELS comma allowlist, first = default (default: a cheap vision model)
//          HOUSE_DAILY  requests per visitor per day (default 40)
// Real global rate limits: bind a KV namespace as HOUSE_KV. Without KV the cap is
// enforced per worker isolate (best effort) — fine for small sites, weak against abuse.
// Disable again: wrangler secret delete HOUSE_KEY — the app hides the option.
const HOUSE_DEFAULT_MODELS = "google/gemini-2.5-flash";
const softCounts = new Map(); // ip|day → count (per-isolate fallback)

async function houseSpend(env, ip) {
  const day = new Date().toISOString().slice(0, 10);
  const cap = Number(env.HOUSE_DAILY || 40);
  const key = `house:${ip}:${day}`;
  if (env.HOUSE_KV) {
    const n = Number((await env.HOUSE_KV.get(key)) || 0) + 1;
    if (n > cap) return false;
    await env.HOUSE_KV.put(key, String(n), { expirationTtl: 172800 });
    return true;
  }
  const n = (softCounts.get(key) || 0) + 1;
  if (n > cap) return false;
  softCounts.set(key, n);
  if (softCounts.size > 5000) softCounts.clear(); // bound the fallback map
  return true;
}

async function houseFetch(request, env, url) {
  if (url.pathname === "/house/health") {
    const models = String(env.HOUSE_MODELS || HOUSE_DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
    return new Response(
      JSON.stringify({ enabled: !!env.HOUSE_KEY, models, daily: Number(env.HOUSE_DAILY || 40) }),
      { headers: cors({ "content-type": "application/json" }) },
    );
  }
  if (url.pathname === "/house/v1/chat/completions" && request.method === "POST") {
    if (!env.HOUSE_KEY) return new Response(JSON.stringify({ error: { message: "house AI is not enabled on this relay" } }), { status: 503, headers: cors({ "content-type": "application/json" }) });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await houseSpend(env, ip))) {
      return new Response(JSON.stringify({ error: { message: "daily free limit reached for this site's built-in AI — add your own key in Settings, or come back tomorrow" } }), { status: 429, headers: cors({ "content-type": "application/json" }) });
    }
    const allowed = String(env.HOUSE_MODELS || HOUSE_DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
    let body;
    try { body = await request.json(); } catch { return new Response("bad json", { status: 400, headers: cors() }); }
    // The relay, not the visitor, decides which models the sponsored key may run.
    if (!allowed.includes(body.model)) body.model = allowed[0];
    const base = String(env.HOUSE_BASE || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.HOUSE_KEY}`,
        "x-title": "Moldable (house)",
      },
      body: JSON.stringify(body),
    });
    const out = new Headers(cors({ "content-type": upstream.headers.get("content-type") || "application/json" }));
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
  return new Response("not found", { status: 404, headers: cors() });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (url.pathname.startsWith("/house/")) return houseFetch(request, env, url);

    if (!url.pathname.startsWith("/prox/")) return new Response("not found", { status: 404, headers: cors() });

    // result-file download passthrough
    if (url.pathname === "/prox/dl") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("missing url", { status: 400, headers: cors() });
      const r = await fetch(target);
      return new Response(r.body, { status: r.status, headers: cors({ "content-type": r.headers.get("content-type") || "application/octet-stream" }) });
    }

    const m = url.pathname.match(/^\/prox\/([^/]+)(\/.*)?$/);
    const base = m && UPSTREAM[m[1]];
    if (!base) return new Response("unknown provider", { status: 404, headers: cors() });

    const target = base + (m[2] || "") + url.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("origin");
    headers.delete("referer");

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });
    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors())) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
