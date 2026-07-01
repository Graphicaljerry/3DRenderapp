import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// ---- Local relay ("backend") ----------------------------------------------
// Generative-3D providers refuse direct browser calls (CORS) and use secret keys.
// While you run `npm run dev`, this plugin forwards /prox/<provider>/... to the
// real API (attaching the Authorization header your browser set) and streams the
// response back same-origin — no CORS, and your key only travels from your
// browser to your own local dev server. /prox/dl?url= fetches result files that
// also lack CORS. Mirror of proxy/cloudflare-worker.js for when you host it.
const UPSTREAM: Record<string, string> = {
  meshy: "https://api.meshy.ai",
  tripo: "https://api.tripo3d.ai",
  replicate: "https://api.replicate.com",
  fal: "https://fal.run",
  falqueue: "https://queue.fal.run",
};

function relayPlugin(): Plugin {
  return {
    name: "moldable-relay",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || "";
        if (!raw.startsWith("/prox/")) return next();
        try {
          const url = new URL(raw, "http://localhost");

          if (url.pathname === "/prox/dl") {
            const target = url.searchParams.get("url");
            if (!target) {
              res.statusCode = 400;
              return res.end("missing url");
            }
            const r = await fetch(target);
            res.statusCode = r.status;
            const ct = r.headers.get("content-type");
            if (ct) res.setHeader("content-type", ct);
            res.end(Buffer.from(await r.arrayBuffer()));
            return;
          }

          const m = url.pathname.match(/^\/prox\/([^/]+)(\/.*)?$/);
          const base = m && UPSTREAM[m[1]];
          if (!base) return next();
          const target = base + (m![2] || "") + url.search;

          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;

          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (["host", "connection", "content-length", "origin", "referer"].includes(k)) continue;
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(",");
          }

          const r = await fetch(target, {
            method: req.method,
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          res.statusCode = r.status;
          const ct = r.headers.get("content-type");
          if (ct) res.setHeader("content-type", ct);
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end("relay error: " + String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), relayPlugin()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad", "replicad-opencascadejs"] },
  build: { target: "esnext" },
  server: { port: 5173, open: true },
});
