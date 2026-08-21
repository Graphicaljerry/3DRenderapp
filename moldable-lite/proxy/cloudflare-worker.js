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

// Which SITES may use this relay from a browser. Set ALLOW_ORIGINS (comma list, e.g.
// "https://you.github.io,https://moldable.app") when you deploy — unset, the relay
// answers any origin, which is fine for a personal test and an open invitation once
// the URL is public: any website could quietly route its users' traffic through your
// worker. Origin checks stop that embedding; the per-IP caps below handle the rest
// (a curl script sends no Origin, so a header check alone is not a defence).
function allowedOrigin(request, env) {
  const conf = String(env.ALLOW_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!conf.length) return "*";
  const o = request.headers.get("origin") || "";
  return conf.includes(o) ? o : null; // null = refuse
}

function cors(origin, h = {}) {
  return {
    "access-control-allow-origin": origin ?? "null",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key,prefer",
    ...h,
  };
}

// Per-IP daily request metering, shared by the house endpoint and /prox/*. KV-backed
// when HOUSE_KV is bound; otherwise per-isolate best effort (fine for small sites).
const softCounts = new Map(); // scope:ip:day → count
async function metered(env, scope, ip, cap) {
  if (cap <= 0) return true; // 0 disables the cap for that scope
  const day = new Date().toISOString().slice(0, 10);
  const key = `${scope}:${ip}:${day}`;
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

// ---- Optional "house AI" — sponsor your visitors with YOUR key (off by default) ----
// Enable:  wrangler secret put HOUSE_KEY        (an OpenRouter key works best)
// Tune:    HOUSE_BASE   OpenAI-compatible base   (default https://openrouter.ai/api/v1)
//          HOUSE_MODELS comma allowlist, first = default (default: a cheap vision model)
//          HOUSE_DAILY  requests per visitor per day (default 40)
// Real global rate limits: bind a KV namespace as HOUSE_KV. Without KV the cap is
// enforced per worker isolate (best effort) — fine for small sites, weak against abuse.
// Disable again: wrangler secret delete HOUSE_KEY — the app hides the option.
const HOUSE_DEFAULT_MODELS = "google/gemini-2.5-flash";

async function houseFetch(request, env, url, origin) {
  const C = (h = {}) => cors(origin, h);
  if (url.pathname === "/house/health") {
    const models = String(env.HOUSE_MODELS || HOUSE_DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
    return new Response(
      JSON.stringify({ enabled: !!env.HOUSE_KEY, models, daily: Number(env.HOUSE_DAILY || 40) }),
      { headers: C({ "content-type": "application/json" }) },
    );
  }
  if (url.pathname === "/house/v1/chat/completions" && request.method === "POST") {
    if (!env.HOUSE_KEY) return new Response(JSON.stringify({ error: { message: "house AI is not enabled on this relay" } }), { status: 503, headers: C({ "content-type": "application/json" }) });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await metered(env, "house", ip, Number(env.HOUSE_DAILY || 40)))) {
      return new Response(JSON.stringify({ error: { message: "daily free limit reached for this site's built-in AI — add your own key in Settings, or come back tomorrow" } }), { status: 429, headers: C({ "content-type": "application/json" }) });
    }
    // One request must not be able to buy an arbitrary amount of the sponsor's money:
    // the body is size-capped and max_tokens is clamped, whatever the client asked for.
    if (Number(request.headers.get("content-length") || 0) > 1_000_000) {
      return new Response(JSON.stringify({ error: { message: "request too large" } }), { status: 413, headers: C({ "content-type": "application/json" }) });
    }
    const allowed = String(env.HOUSE_MODELS || HOUSE_DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
    let body;
    try { body = await request.json(); } catch { return new Response("bad json", { status: 400, headers: C() }); }
    // The relay, not the visitor, decides which models the sponsored key may run —
    // and how long an answer it may buy.
    if (!allowed.includes(body.model)) body.model = allowed[0];
    const capTok = Number(env.HOUSE_MAX_TOKENS || 4096);
    body.max_tokens = Math.min(Number(body.max_tokens) || capTok, capTok);
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
    const out = new Headers(C({ "content-type": upstream.headers.get("content-type") || "application/json" }));
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
  return new Response("not found", { status: 404, headers: C() });
}

// /prox/dl may only fetch from the hosts that actually serve generation results —
// the providers above and their delivery CDNs. Without this it was an open proxy:
// anyone could bounce arbitrary traffic off the worker ("dl?url=https://anything"),
// spending the deployer's bandwidth and putting their name on the requests.
// Extend via DL_HOSTS (comma list of host suffixes) if a provider moves its CDN.
const DL_HOST_SUFFIXES = [
  "meshy.ai", "tripo3d.ai", "tripo3d.com", "replicate.com", "replicate.delivery",
  "fal.run", "fal.media", "fal.ai", "openrouter.ai",
];
function dlAllowed(target, env) {
  let u;
  try { u = new URL(target); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const extra = String(env.DL_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...DL_HOST_SUFFIXES, ...extra].some((suf) => u.hostname === suf || u.hostname.endsWith("." + suf));
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    // A browser on a site that isn't yours gets a refusal it can read (its fetch will
    // fail CORS either way; the explicit 403 keeps the worker from doing the upstream
    // work first). Requests with no Origin (curl, native apps) pass — the per-IP caps
    // are the fence that actually holds against those.
    if (origin === null) return new Response("origin not allowed", { status: 403, headers: cors(null) });

    if (url.pathname.startsWith("/house/")) return houseFetch(request, env, url, origin);

    if (!url.pathname.startsWith("/prox/")) return new Response("not found", { status: 404, headers: cors(origin) });

    // Everything under /prox rides the CALLER's own provider key, so the cap exists to
    // stop volume abuse (the worker has a request budget and a reputation), not spend.
    // Default 500/day per IP; PROX_DAILY tunes it, 0 disables.
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await metered(env, "prox", ip, Number(env.PROX_DAILY || 500)))) {
      return new Response(JSON.stringify({ error: { message: "daily relay limit reached from this network — try again tomorrow" } }), { status: 429, headers: cors(origin, { "content-type": "application/json" }) });
    }

    // result-file download passthrough (allowlisted hosts only — see dlAllowed)
    if (url.pathname === "/prox/dl") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("missing url", { status: 400, headers: cors(origin) });
      if (!dlAllowed(target, env)) return new Response("host not allowed", { status: 403, headers: cors(origin) });
      const r = await fetch(target);
      return new Response(r.body, { status: r.status, headers: cors(origin, { "content-type": r.headers.get("content-type") || "application/octet-stream" }) });
    }

    const m = url.pathname.match(/^\/prox\/([^/]+)(\/.*)?$/);
    const base = m && UPSTREAM[m[1]];
    if (!base) return new Response("unknown provider", { status: 404, headers: cors(origin) });

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
    for (const [k, v] of Object.entries(cors(origin))) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
