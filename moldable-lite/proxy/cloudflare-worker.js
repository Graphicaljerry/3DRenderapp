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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

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
