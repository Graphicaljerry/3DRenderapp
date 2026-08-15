# Building Moldable — the key points

*The "if I ever lose my AI assistant / this laptop" survival sheet. Deliberately
concise: enough to rebuild, run, and deploy the app, and to know where every key
comes from. Details live in the code and in `moldable-lite/README.md`.
**Keep this updated whenever a feature changes the stack, the keys, or the setup.***

## What the app is made of

| Layer | Technology |
| --- | --- |
| UI | React 18 + TypeScript, built with **Vite** (PWA plugin). One big `src/App.tsx`, styles in `src/styles.css`. |
| 3D viewer | **three.js** (`src/components/Viewer.tsx`) — render-on-demand, not a game loop. |
| CAD engine | **replicad** (JavaScript CAD API) running on the **OpenCascade (OCCT) B-rep kernel compiled to WebAssembly**, inside a Web Worker (`src/worker/`). This is what turns AI-written code into real solids and STL/3MF/STEP/OBJ exports. |
| Live-drag previews | **Manifold** (WASM mesh booleans) for extrude drags; OCCT for fillets. OCCT is always the source of truth. |
| Model import | `STEP/STP` → editable CAD solid. `STL`/`3MF` → the same, via OCCT's mesh solidifier (so a MakerWorld download is AI-editable); anything it can't solidify falls back to the mesh pipeline. `GLB/GLTF` → mesh. Reader: `src/gen/load3mf.ts`, `src/gen/loadMesh.ts`. |
| Fallback engine | A primitive+CSG engine (three-bvh-csg) boots silently if OCCT WASM fails — everything works except STEP export. |
| Mesh engines | Text/photo → mesh via provider APIs (see keys below); cleaned with meshoptimizer. |
| Storage | Browser-local: IndexedDB (`idb`) for projects, localStorage for settings. No server required to run. **Signing out erases this device's projects** (after uploading them) — see `runSignOut`/`wipeDevice` in `src/lib/cloud.ts`. |
| Fonts | **Self-hosted, bundled** — `src/assets/fonts/*.woff2` (95 KB) with the `@font-face` block at the top of `src/styles.css`. Do NOT put a `fonts.googleapis.com` `<link>` back in `index.html`: a stylesheet link blocks first paint, so on a network that filters Google (most corporate ones do) the app sat on a blank page for a measured 12.7 s. Schibsted Grotesk is variable — one file per subset, weight range declared. |
| Cloud sync (optional) | **Supabase** project `prtpakaxzdmrehpndimy` — auth (GitHub/Google/magic link/password), one `sync_blobs` table (settings + projects + deletion tombstones, AES-GCM encrypted in the browser before upload), a private `mesh-sync` storage bucket, and the `relay` edge function that fronts paid mesh engines for the hosted site. Client config in `src/lib/cloud.ts` (the publishable key there is safe by design). Manage it at supabase.com; social-login setup steps: `docs/SOCIAL_LOGIN.md`. |
| Desktop app | Tauri 2 wrapper in `moldable-lite/src-tauri/` (`npm run tauri dev`); release builds via `.github/workflows/build-desktop.yml`. The only Rust logic is `stage_for_slicer` in `src-tauri/src/lib.rs` — it writes the export to `<app data>/handoff/<name>.3mf` and the frontend asks the OS to open it. Rust tests: `cd src-tauri && cargo test`. |
| Export | One writer, `write3MF()` in `src/print/exportClient.ts` — every 3MF the app produces (model, plates, pieces, slicer hand-off) goes through it, carrying object names, part colours and per-face paint in both the core-3MF and Bambu/Orca dialects. |
| Printer fit | One source of truth, `src/lib/fit.ts` — the Tolerance test coupon measurement sets both the loose/snug/press gap and the bore allowance applied to every hole the app drills. |

## Build, run, deploy

```bash
cd moldable-lite
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build → dist/
```

- **Deploy = push to `main`.** `.github/workflows/deploy-pages.yml` publishes
  `moldable-lite/` to GitHub Pages (https://graphicaljerry.github.io/3DRenderapp/)
  on any push to main that touches it.
- **The in-app version number** (v320, v321…) is just the commit count:
  `git rev-list --count HEAD`. It's baked in at build time — needs a full clone,
  not a shallow one.
- Node 20+ is fine. No env vars, no secrets in the repo — the app is
  bring-your-own-key by design.

## API keys — where they come from, where they go

All keys are pasted **in the app**: Settings → **AI brain** (the chat/CAD model)
and Settings → **3D engine** (mesh generation). They live in your browser
(and sync encrypted to your account when signed in) — never in the repo.

**AI brain (writes the CAD code / runs the chat):**

| Provider | Get a key at | Notes |
| --- | --- | --- |
| Anthropic Claude | console.anthropic.com | best CAD quality (`sk-ant-…`) |
| Google Gemini | aistudio.google.com/apikey | **free** tier ~1,500 req/day |
| OpenAI | platform.openai.com/api-keys | |
| Groq | console.groq.com/keys | **free**, fast open models |
| **OpenRouter** | **openrouter.ai/keys** | `sk-or-…`; one key → hundreds of models. In Settings pick provider "OpenRouter", paste the key, and the model box becomes a type-to-search picker with live prices — models tagged `:free` cost nothing. With this key set, the app also reads your live balance and shows it on the Model row (see Credits below). |
| Ollama | ollama.com (install, `ollama pull …`) | local & private; set `OLLAMA_ORIGINS=*` if the hosted site can't see it |
| On-device / Built-in | — | no key: WebLLM in-browser model, or the site's sponsored relay |

**3D engine (sculpted meshes — these bill per generation):**

| Provider | Get a key at | Rough cost |
| --- | --- | --- |
| Hugging Face | huggingface.co/settings/tokens | free (Stable Fast 3D, Hunyuan3D-2, TRELLIS) |
| fal | fal.ai/dashboard/keys | ~$0.38–0.40/run, best accuracy |
| Tripo | platform.tripo3d.ai | ~$0.15–0.25/run |
| Meshy | meshy.ai (API settings) | ~$0.50/run |
| Replicate | replicate.com/account/api-tokens | ~$0.04–0.15/run |

The paid mesh engines browsers can't call directly go through the Supabase
`relay` edge function on the hosted site; a self-hostable Cloudflare Worker
alternative lives in `moldable-lite/proxy/` (see its `DEPLOY.md`).

## Credits — the app's spend unit

`src/llm/credits.ts` holds two separate things. **Balance** is real money read live
from OpenRouter (`/api/v1/credits`, falling back to `/api/v1/key`), cached, stamped
with its age, and re-read after every build. **Credits** are a display skin over USD:
`1 credit = $0.001`, at cost.

**One place to change when this commercialises: the `PRICING` object.**

```ts
export const PRICING = { creditsPerUsd: 1000, markup: 1, unit: "credits", unitShort: "cr" };
```

Markup, per-build floors and subscription grants are all arithmetic inside
`usdToCredits` / `creditsToUsd` — no call site knows the formula. The ledger keeps
recording true USD underneath regardless, so app credits and provider dollars stay
reconcilable. `PRICING.unit` renames the unit everywhere (it is "credits" rather than
"tokens" because chat bubbles already print raw LLM `tok` counts).

## How changes get verified

Every feature is checked end-to-end with **Playwright** against a local stub LLM
server before it ships (no real API spend). Reusable harness bits are in
`harness/`; the convention is: probe → production build → commit → push branch →
fast-forward `main`.

## More depth

- `moldable-lite/README.md` — full architecture & feature notes
- `docs/HANDOFF.md` — session-to-session state and roadmap
- `docs/PLAN.md`, `docs/COMMERCIALIZATION.md` — product direction
