import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";

// ---- Build stamp -----------------------------------------------------------
// Shown in the app's status bar so a refresh provably picked up a new deploy.
// Strictly numeric: the commit COUNT, which grows by (at least) 1 on every push
// to main. The Pages workflow checks out full history (fetch-depth: 0) so the
// count is real in CI too; if git is unavailable, fall back to a numeric
// build-minute stamp so the number still changes per build.
let buildNum = "";
try { buildNum = execSync("git rev-list --count HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* no git */ }
if (!/^\d+$/.test(buildNum)) buildNum = new Date().toISOString().slice(2, 16).replace(/\D/g, "");
const BUILD_STAMP = buildNum;

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
  // LLM providers (CORS fallback for the Precise engine)
  gemini: "https://generativelanguage.googleapis.com",
  openai: "https://api.openai.com",
  groq: "https://api.groq.com",
  openrouter: "https://openrouter.ai",
};

function relayPlugin(): Plugin {
  // Short-lived in-memory file park for "Open in slicer": the browser POSTs the
  // 3MF here, and the desktop slicer fetches it back via the returned local URL.
  const held = new Map<string, { body: Buffer; name: string }>();
  return {
    name: "moldable-relay",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || "";
        if (!raw.startsWith("/prox/")) return next();
        try {
          const url = new URL(raw, "http://localhost");

          if (url.pathname === "/prox/hold" && req.method === "POST") {
            const name = (url.searchParams.get("name") || "model.3mf").replace(/[^\w.-]+/g, "_");
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            const id = Math.random().toString(36).slice(2, 10);
            held.set(id, { body: Buffer.concat(chunks), name });
            setTimeout(() => held.delete(id), 15 * 60 * 1000).unref?.();
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ url: `/prox/hold/${id}/${encodeURIComponent(name)}` }));
            return;
          }
          const hm = url.pathname.match(/^\/prox\/hold\/([a-z0-9]+)\//);
          if (hm) {
            const h = held.get(hm[1]);
            if (!h) {
              res.statusCode = 404;
              return res.end("expired");
            }
            res.setHeader("content-type", "application/octet-stream");
            res.setHeader("content-disposition", `attachment; filename="${h.name}"`);
            res.end(h.body);
            return;
          }

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
  // GitHub Pages serves the app under /<repo>/; the deploy workflow sets BUILD_BASE.
  // Local dev / other hosts keep "/". The Tauri (macOS desktop) build serves assets
  // from a custom tauri://localhost origin, where relative "./" paths are safest.
  base: process.env.TAURI_ENV_PLATFORM ? "./" : (process.env.BUILD_BASE || "/"),
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  plugins: [
    react(),
    relayPlugin(),
    // ---- Installable app (PWA): manifest + icons + offline service worker. ----
    // "Add to Home Screen" / browser Install gives a standalone, dock-launchable
    // app. The service worker precaches the whole shell INCLUDING the ~11 MB OCCT
    // wasm, so once visited the CAD kernel works with no network at all (AI chat
    // still needs the internet, everything local — templates, direct edits,
    // hole tool, measure, export — does not). autoUpdate: each deploy's new
    // worker installs in the background and takes over on the next refresh.
    // The Tauri desktop bundle ships all assets locally, so the Workbox service
    // worker + ~13 MB precache is pointless there (and the SW can misbehave on the
    // tauri:// scheme) — drop the PWA plugin for the Tauri build only. Web is unchanged.
    ...(process.env.TAURI_ENV_PLATFORM ? [] : [VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "Moldable — AI 3D design for printing",
        short_name: "Moldable",
        description: "Design precise, printable 3D parts with chat, templates and direct editing — right in your browser.",
        theme_color: "#0e9488",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,svg,png,webp,woff2}"],
        // The on-device AI runtime (WebLLM) is a ~6 MB chunk that only loads if the
        // user picks the "On-device" brain — precaching it would push 6 MB to every
        // visitor in the background. Skip it here; the runtimeCaching rule below
        // caches it on first actual use, so offline-after-first-use still holds.
        globIgnores: ["**/webllm-*.js"],
        // The OCCT kernel wasm alone is ~11 MB — well past workbox's 2 MB default.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        // Fonts come from Google Fonts at runtime; cache them after first use so
        // the installed app keeps its typography offline.
        runtimeCaching: [
          {
            // Hashed chunks excluded from precache (the WebLLM runtime): cache on
            // first use. CacheFirst is safe — a new deploy emits a new hash/URL.
            urlPattern: /\/assets\/webllm-[^/]+\.js$/i,
            handler: "CacheFirst",
            options: { cacheName: "lazy-chunks", expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css", expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-files", expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    })]),
  ],
  worker: { format: "es" },
  // Tauri reads TAURI_ENV_* during `tauri dev/build`; expose them to import.meta.env.
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  optimizeDeps: { exclude: ["replicad", "replicad-opencascadejs"] },
  build: {
    target: "esnext",
    // Multi-page: the app is the default entry (index.html); landing.html is a
    // separate lightweight marketing entry (no app bundle). See landing.html for
    // the launch-day flip. Adding entries here never touches the app bundle.
    rollupOptions: {
      input: { main: "index.html", landing: "landing.html" },
      output: {
        // Stable vendor chunks. Deploys are frequent (every merge) and the PWA
        // re-precaches changed files each deploy — keeping the big, rarely-updated
        // libraries in their own hashed chunks means a typical deploy only re-ships
        // app code, not three.js + React again. "webllm" also gives the on-device
        // AI runtime a recognizable filename for the precache exclusion above.
        manualChunks(id: string) {
          if (id.includes("node_modules/three/")) return "three";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("node_modules/@mlc-ai/web-llm/")) return "webllm";
          if (id.includes("node_modules/@supabase/") || id.includes("node_modules/iceberg-js/")) return "supabase";
        },
      },
    },
  },
  server: { port: 5173, strictPort: true, open: true },
});
