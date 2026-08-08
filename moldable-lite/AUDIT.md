# Audit: moldable-lite

Mode: report + one safe fix applied · 2026-08-08 · build 376 baseline

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

- **`replicad-threejs-helper` removed from dependencies.** Build 368 replaced its
  `syncFaces` with the zero-copy transfer path in `src/engine/mesh.ts`; since then the
  package was installed but never imported (verified: no import anywhere, only a
  historical comment). Type-check and production build green after removal.
  Note: `depcheck` also flagged `wawoff2` — false positive; its emscripten binding is
  loaded by URL in `src/text/fonts.ts`, exactly the dynamic pattern the tool can't see.

## Found, not touched

- **The 14.4 MB background precache.** Deliberate (offline PWA + instant CAD warm),
  and the config comments say so. But it bills ~14 MB of data to every first-time
  visitor, on phones too. The webllm chunk already has the alternative pattern in this
  same config: exclude from precache, `CacheFirst` on first real use. Applying that to
  the OCCT wasm would cut first-visit background data to ~4 MB at the cost of a slower
  *first* generate when offline-install matters less. Product call, not a bug.
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

1. **(afternoon)** Decide the precache question above; if changed, verify offline
   behavior with a probe before shipping.
2. **(project)** Persist text/logo attachments and fold them into undo, mirroring the
   build-375 surfFx-in-versions design.
3. **(quick)** Add the missing why-comments to the empty catches touched in future
   diffs (no dedicated pass — do it opportunistically).
4. **(quick)** A `npm test`-style alias that runs the probe suite against the stub
   server, so "are the probes green" is one command instead of tribal knowledge.

## Sources

None needed — all findings measured locally.
