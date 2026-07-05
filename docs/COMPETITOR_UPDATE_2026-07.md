# Competitor Update & Gap Re-Ranking — July 2026

_Last updated: 2026-07-05 · Live-verification pass on the three competitors that matter most,
run as a follow-up to [`MARKET_RESEARCH.md`](./MARKET_RESEARCH.md) (whose adversarial
verification was cut short). Every claim below was freshly sourced this week; URLs inline._

---

## TL;DR — what changed since MARKET_RESEARCH.md

1. **Zoo shipped the two features we planned to beat them to.** Image-to-CAD (March 2026) and
   STEP/STL → editable-KCL reconstruction (claimed via the Zookeeper agent, Feb 2026) are no
   longer roadmap items. **De-prioritize "reverse-engineer STEP" as a race; the durable
   differentiators are now printer-awareness, the replacement-part flow, and free/BYOK.**
2. **AdamCAD is pivoting upmarket and vacating our persona.** adamcad.com now redirects to
   **adam.new**, an enterprise "AI CAD copilot for hardware teams" ($40–$1,000/mo, Onshape/PLM
   integrations). The consumer app persists but is clearly no longer the focus. Still **no STEP
   export** (roadmap only) and **zero printing features**. The hobbyist maker they courted is
   going unclaimed.
3. **Tripo is now a giant attacking printing from the mesh side.** ~$200M raised mid-2026
   (plus a reported $150M+ A3 in July; totals may overlap), direct-to-Bambu-Studio export,
   a $10 human "Pro Refinement" service, and printer-maker partnerships (Bambu, Anycubic,
   Creality, Elegoo, Stratasys). **But still no exact dimensions, no parametric editing** —
   All3DP's verdict stands: "not your tool" for dimensionally accurate objects.

---

## Competitor snapshots (verified 2026-07-05)

### Zoo / KittyCAD — the frontrunner
- Text-to-CAD now lives inside **Zoo Design Studio** (desktop, proprietary kernel + KCL code)
  with the **Zookeeper** agent (launched ~Feb 2026). https://zoo.dev/research/zookeeper
- **Shipped 2026:** image/PDF/DXF/STEP uploads to Zookeeper (Mar 2026,
  https://zoo.dev/blog/whats-new-mar-2026); Zookeeper claims STEP/STL → "clean, editable KCL"
  reconstruction (quality unverified); new sketch mode + constraint solver (May 2026).
- **Pricing:** Free = 20 min/mo agent time **and Zoo trains on your data with no opt-out**;
  Plus $20/mo (400 min); Pro $99/mo unlimited; PAYG $0.0083/sec. https://zoo.dev/pricing
- **Exports:** STEP, STL, glTF, OBJ, PLY on all tiers.
- **Weaknesses:** independent tests say quality degrades fast beyond single-body parts
  (https://xometry.pro/en/articles/text-to-cad-tools-test/); buggy onboarding reported;
  engineer-focused; **no printability/bed/slicer concept anywhere in docs or marketing**.

### AdamCAD → "Adam" — pivoting away from hobbyists
- **adamcad.com redirects to adam.new** — enterprise copilot (Onshape, Fusion, SolidWorks,
  Arena PLM, Slack): Free 300 daily credits, Starter $40/mo, Pro $200/mo, Max $1,000/mo.
- Legacy consumer app remains (app.adamcad.com): free 5 creative gens; Standard $9.99/mo;
  Pro $29.99/mo. 1M+ models generated; $4.1M seed (Oct 2025, TQ Ventures).
- **Still no STEP export** as of a July 4, 2026-updated review ("announced on the roadmap") —
  STL/OBJ/SCAD only; Onshape plugin partially bypasses it.
  https://pasqualepillitteri.it/en/news/3372/adamcad-text-to-cad-ai-review-2026
- **No printability, bed/printer, tolerance, or slicer features found.** Quality degrades past
  ~8–10 constrained parts; "design intent" opacity criticized.

### Tripo (VAST) — the funded mesh giant moving into print
- Models: Tripo 3.1 (image→3D), H3.1 (high-detail), P1.0 (fast production meshes, Mar 2026).
  Best accuracy of the mesh tools per All3DP May 2026 (beat Meshy & Hitem3D).
  https://all3dp.com/4/from-image-to-print-ready-3mf-we-found-tripo-beats-meshy-hitem3d-for-accuracy/
- **Print push (shipped):** direct-to-Bambu-Studio button (STL-only; wrong-scale bug), 3MF with
  sensible sizing, in-app segmentation, **$10 human "Pro Refinement"** (<24 h), partnerships +
  own print farms. https://www.voxelmatters.com/tripo-ais-fast-track-to-an-ai-native-3d-future/
- **Funding/scale:** ~$200M announced Jun 2026; $150M+ A3 Jul 3, 2026 (Geely Capital et al. —
  overlap unclear); founder-claimed ~4M users, ~$12M run-rate, profitable (Sept 2025).
- **Pricing:** free 300 credits; Pro ~$12–14/mo for 3,000 credits (≈$0.10–0.12/model);
  generation ≈60 credits, segment edit 40 — nearly every action burns credits.
- **Ceiling intact:** no exact-dimension input, no parametric/CAD editing; Tripo tells press
  accuracy "is a goal." Unusable for functional/engineering parts per All3DP.

---

## The three gaps, re-verified

1. **Photo-of-broken-part → dimension-accurate replacement, end-to-end. Still nobody.**
   Zoo's image input is engineer-tool input with no real-world dimension grounding and no
   print pipeline; AdamCAD's image input is a creative Pro feature; Tripo can't do dimensions.
   The flow must be *guided* (photo → find/confirm real dims → fit → print), not a prompt box.
2. **Printer-aware parametric CAD — "it prints, guaranteed."** Re-confirmed: neither Zoo nor
   Adam has any concept of a printer. Tripo's print pipeline is mesh-only and imprecise. The
   intersection — exact geometry *plus* print-readiness by default — remains empty, and
   Moldable already owns most of the parts (printability.ts, repair.ts, printers.ts, 3MF).
3. **Fit & iteration without pain.** The documented reality is 5–10 test prints to fit;
   every rival charges per attempt (credits / agent-seconds). No tool offers an explicit
   clearance control (loose / snug / press-fit). Moldable's no-AI-call param sliders are 80%
   of this; fit semantics are the missing 20%.

**Pricing wedge unchanged and stronger:** Zoo's free tier trains on user data with no opt-out;
Tripo/Meshy remain credit-metered. "Free, local, your keys, no training on your designs" now
has extra teeth.

---

## Revised near-term feature priorities (the "Replacement-Part MVP")

| # | Feature | Status in app | Effort center |
|---|---|---|---|
| 1 | **Guided replacement-part flow** — photo → auto dimension research (`research.ts`) → user confirms dims → parametric part → fit check | ingredients shipped, flow missing | UX wiring |
| 2 | **Print-ready-by-default export** — manifold check + auto-repair + scale sanity on *every* export; 3MF default; "print-ready ✓" badge | checks exist, not wired into export | export path |
| 3 | **Fit/tolerance slider** — loose/snug/press-fit (±0.1–0.4 mm) as a first-class param; instant no-AI regeneration | param system shipped | prompts + small UI |
| 4 | **Stage-0 validation** — anonymous usage ping, % reaching export, "Notify me about Pro" | not started | small |

**Deferred:** STEP→parametric reverse-engineering (Zoo shipped their version; revisit later),
competing on mesh quality (rent engines), marketplace, paid-tier build-out (needs Stage-0 data).
