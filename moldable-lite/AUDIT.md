# Audit: moldable-lite

Mode: report, then fixes applied · 2026-08-08 · builds 377–378

## Verdict

This codebase is in better shape than almost anything of its age and pace — zero type
errors, zero TODO litter, an honest comment culture, and the expensive lessons
(lazy-loading the 6 MB on-device AI, BVH `indirect: true`, transfer-not-copy mesh
handoff) are already encoded. It is safe to keep shipping. The two things worth your
attention are both *decisions*, not defects: every fresh visitor's service worker
downloads ~14 MB in the background (the offline-PWA tradeoff you chose — worth
re-confirming now that phones are a primary target), and `App.tsx` at 8,847 lines is
where every future bug will go to hide. Nothing found is urgent.

## Numbers

| Metric | Value |
|---|---|
| Source | 105 files · 33,428 LOC |
| TypeScript errors | 0 |
| Production build | 12.9 s clean |
| First paint (boot splash) | 260 KB / 5 requests |
| Workspace interactive | ~1.9 MB raw (App + three + react chunks) |
| Background after load | ~14.4 MB service-worker precache (10.6 MB = OCCT kernel) |
| On-device AI chunk (6 MB) | lazy + excluded from precache — loads only if chosen ✓ |
| Dependencies | 21 → 20 (one removed below) |
| `as any` | 39 · `catch {}` 14 · `console.log` 7 · TODO/`@ts-ignore`/`debugger` 0 |
| Playwright probes | 12 feature probes green as of builds 372–375 |
| Secrets in repo | none found (key-shaped grep) |

## Fixed

- **Text layers are real state now** — the report's biggest open item. A placed word
  was a three.js mesh and nothing else: it vanished on reload and Undo stepped past it.
  Versions now carry `texts` (spec + pose), so placing, editing, moving and removing are
  each one history step, and a reload rebuilds the identical solid from its spec at the
  pose it was left. Verified end to end in `textpersist.mjs`.
- **A React bug found while wiring that up**: the gizmo write-back decided whether to
  record a move from a flag set *inside* a `setAttachments` updater. React only runs an
  updater eagerly when its queue happens to be empty, so moves were recorded
  intermittently — worse than never, because it looks like it works. The decision is now
  made from a ref before the update.
- **`npm run probes`** — the probe suite in one command (starts vite + the stub LLM,
  reuses them if already running, reports pass/fail per probe). Replaces tribal
  knowledge with a command.
- **`replicad-threejs-helper` removed from dependencies.** Build 368 replaced its
  `syncFaces` with the zero-copy transfer path in `src/engine/mesh.ts`; since then the
  package was installed but never imported (verified: no import anywhere, only a
  historical comment). Type-check and production build green after removal.
  Note: `depcheck` also flagged `wawoff2` — false positive; its emscripten binding is
  loaded by URL in `src/text/fonts.ts`, exactly the dynamic pattern the tool can't see.

## Found, not touched

- **The 14.4 MB background precache — investigated, and the report's own suggestion was
  WRONG.** Excluding the OCCT wasm from precache would save nothing: the kernel warm-up
  at `App.tsx:1533` fetches that same 11 MB on every first visit anyway, deliberately
  and un-gated, to cut time-to-first-model. Removing it from the precache would keep the
  download and lose offline. The real lever, if you want one, is making that warm-up
  connection-aware (skip the eager compile on `saveData` / 2g-3g), which would spare a
  phone visitor who bounces off the Launchpad. Left alone: it changes first-model speed
  for everyone, so it wants your call, not mine.
- **`App.tsx` (8,847 lines), `Workspace.tsx` (5,755), `Viewer.tsx` (5,248).** All
  three keep growing by design (imperative Internals struct, single prop surface). No
  correctness issue today — but extraction seams exist (export pipeline, fx/surface
  state, text tool state) and each would make future sessions cheaper.
- **14 empty `catch {}`.** Sampled: all are localStorage/JSON-parse tolerance on
  boot paths where falling back to defaults is the design. Fine — but several lack
  the one-line "which failure is tolerated" comment the house style asks for.
- **39 `as any`.** Concentrated at real boundaries (comlink workers, wasm modules,
  DEV window hooks). Acceptable debt; not worth a churn pass.
- **Text/logo layers remain session-only and outside undo** (flagged in HANDOFF).
  The pattern tool's history integration (build 375) is the template for fixing it.

## Recommended next

1. **(quick, needs your call)** Connection-aware kernel warm-up — skip the eager 11 MB
   compile when the browser reports Save-Data or a slow connection. Costs a bounced
   phone visitor nothing; costs a real user a slower first model on cellular.
2. **(afternoon)** Logo layers get the same treatment text just got. They need their
   source SVG/PNG stored to rebuild, which `Version.importFile` already shows how to do.
3. **(quick)** Add the missing why-comments to the empty catches touched in future
   diffs (no dedicated pass — do it opportunistically).
4. **(project)** Extraction seams in `App.tsx` (export pipeline, surface/fx state) —
   the file is now ~8.9k lines and every future bug will hide there.

## Sources

None needed — all findings measured locally.
