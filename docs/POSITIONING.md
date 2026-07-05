# Moldable — Positioning Brief

_Last updated: 2026-07-05 · Distilled from the founder interview + the market research
([`MARKET_RESEARCH.md`](./MARKET_RESEARCH.md), [`COMPETITOR_UPDATE_2026-07.md`](./COMPETITOR_UPDATE_2026-07.md))._

---

## The one line

> **Ideate, sketch, or drop a flat SVG → an accurate mesh or CAD model, ready to print and sell.**

Shorter, for a hero: **"You bring the idea and the dimensions. Moldable does the CAD."**

---

## Target persona — "can design, can't CAD"

Not "people who can't design." The bullseye is **people who can design or imagine, but can't (or won't) do parametric CAD.**

- Designers and artists (Adobe / Figma / Procreate / Nomad natives) who think in shapes and sketches, not feature trees.
- Experienced makers who print constantly but bounce off Fusion 360 / FreeCAD every time they need a real part.
- Maker-sellers who want to turn an idea into a printable, sellable product fast — without a CAD detour.

This is the founder's own profile (5 yrs printing, up to a Bambu H2C; professional designer; dabbles in CAD but isn't a CAD pro). **Building for himself = building for this segment.** That is the strategic advantage — no guessing, and authentic community standing instead of manufactured credibility.

---

## Why this wins (the moat)

The AI models are commodities; the **workflow + focus + free** is the moat. Nobody serves the bridge:

- **Mesh tools (Meshy, Tripo, Rodin):** fast, creative — but ignore exact dimensions and can't be edited after generation. Not for parts that must fit.
- **CAD-AI tools (Zoo, AdamCAD):** exact geometry — but engineer-facing, no printer awareness, and both are moving upmarket (AdamCAD is now an enterprise copilot). No STEP export from AdamCAD; neither knows what a printer is.
- **Moldable — the bridge:** describe / sketch / SVG → **either engine** (exact CAD *or* organic mesh) → printer-aware, print-ready output (STL · 3MF · editable STEP), with a fit/tolerance control and measure-from-photo for real dimensions.

Aimed at one person — the designer who can't CAD — the *focused workflow* is the defensible thing. Any single feature can be copied; the fit for this persona can't be, easily.

---

## Input modes (the "how you start")

| Mode | Status | Notes |
|---|---|---|
| **Describe it** (text) | ✅ shipped | Precise CAD or generative mesh. |
| **Photo / sketch photo** (vision) | ✅ shipped | A snapshot of a hand sketch already works; measure-from-photo gives real mm. |
| **Flat SVG / vector** | 🎯 **flagship next build** | A designer's native output. 2D vector profile → extrude / revolve / emboss → printable solid. This is the feature that makes the one-line true end to end. |

---

## Product pillars

1. **Accurate by default.** Real millimetres (measure-from-photo, web dimension lookup, the fit slider), print-ready export (manifold check + auto-repair, 3MF with units). The accuracy promise *is* the brand — protect it; one part that doesn't fit collapses the positioning.
2. **Two engines, picked for the job.** Exact parametric CAD for functional parts; generative mesh for organic/creative. The user shouldn't have to know which — the workflow routes it.
3. **Ready to sell, not just print.** Clean, editable output (STEP), print-on-a-real-printer output (3MF), and — later — a path to publish/sell (MakerWorld, a gallery).

---

## Go-to-market — tuned for "minimal time, exploring"

Skip the 90-day community grind and the Product Hunt / HN launch for now. Only high-leverage, low-effort moves:

1. **Dogfood → every real part is a demo.** Use it on your own product ideas; a "sketch/photo → measured → printed → it fits" clip beats any feature list, and it can be shot beautifully.
2. **MakerWorld presence (Bambu-native).** Publish a few genuinely useful models made with Moldable, linking back. Passive, home-ecosystem, huge built-in reach — best ROI per hour.
3. **Design-led brand.** The landing page and brand can be genuinely gorgeous — rare in dev tools, and a trust signal. Use the `brandkit` + `design-taste-frontend` + `imagegen-frontend-web` skills.
4. **Be yourself where you already are** (Bambu community, r/3Dprinting) — no campaign, just helping in context.

**Do NOT yet:** build the paid tier, chase YouTubers, or run a formal launch. Those are "if you commercialize" moves.

---

## Naming / brand to-do

`moldable.ai` is taken. Run a name + domain pass before any brand spend or a public landing. The `brandkit` skill (its "Dark Developer/Builder" mode matches the aesthetic) is built for this once a name is chosen.

---

## Immediate next steps

1. **Build SVG-input** (the flagship feature above) — makes the one-line literally true and is the sharpest hook for the designer persona.
2. **Refresh the landing hero** to this positioning (done as a placeholder; redesign for real when the name is settled).
3. (Optional, when time allows) Seed 3–5 MakerWorld models made with Moldable.
