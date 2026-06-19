# Naming & Brand — working notes

_Last updated: 2026-06-18_

Working log for naming the app (working title: **"3D Print AI Assistant"**). Captures the brief, the
conventions considered, every candidate we've checked and why it's in/out, and the strategic
conclusion — so we don't re-explore names that are already taken.

## Decision (2026-06-19): working name = **Moldable** (English)
Locked for design work: **Moldable** — plain English, instantly understood ("shape it, tweak it,
print it"). English was the requirement; the earlier Spanish round (Obra/Molde/Trazo/Trama) is parked,
not chosen. Reflected in the Figma file: the *Brand directions* and *Wordmark study* frames now show
Moldable across all three visual styles (Workshop · Studio · Precision), and a new **Icon System**
frame holds the 28-icon set (also in `assets/icons/`). Domain still to settle — simple single-word
`.com`s are largely taken (verified via RDAP), so `.ai`/`.app` or a coined/compound route stays open.

## What we're naming
An AI builder for 3D-printable objects: **describe it in words (or show a reference) → get a
print-ready model.** It spans a spectrum:
- **CAD-accurate / parametric** — Engine A (LLM → replicad → STL/STEP), and
- **Hobbyist / artistic** — Engine B (generative mesh), where geometric precision matters less as
  long as the result faithfully reflects the reference.

It should feel **intuitive and "as if Apple made it,"** be **3D-print-friendly**, and read as a
**product** (not host-prefixed) — it's a standalone web app first (plugins possible later, see PLAN.md §7).

## Naming brief (criteria)
- Clever but clean; simple, confident, premium ("Apple / Figma energy").
- Neutral enough to span precise **and** artistic (not "CAD-only" or "toy-only").
- Short, easy to say/spell, globally pronounceable.
- **Ownable** — the deciding constraint (see findings below).
- Domain bar: TBD — note this category does **not** require a `.com` (krea.ai, spline.design,
  lumalabs.ai, womp.com).

## Naming conventions (frameworks)
| Convention | Examples | Fit for us |
| --- | --- | --- |
| Descriptive | "3D Print AI Assistant" | Clear but generic; hard to own. |
| Suggestive (evocative real word) | Apple *Pages, Keynote, Freeform* | Strong if findable — but most are taken in-space. |
| Coined / abstract | *Figma, Spline, Krea, Luma, Womp* | **Best for ownability**; how our reference apps did it. |
| Compound / two-word | *FaceTime, AirDrop*; "Form Foundry" | Very available, brandable. |
| Real word repurposed | *Forge, Kiln, Loft* | Mostly taken in 3D/print. |

## The finding: this namespace is saturated
Across ~30+ candidates, nearly all are taken — often **in 3D/print specifically** — and the few that
are clean in-space have their `.com`/`.ai` already registered.

**Clean in-space, but no clean domain (shortlist still on the table on brand merit):**
| Name | Type | Domain status |
| --- | --- | --- |
| **Vorm** | abstract; Dutch "form" | vorm.ai + vorm.design taken |
| **Maku** | coined; "make" | maku.ai for-sale (Atom) |
| **Billet** | real; raw stock → part | billet.ai taken |
| **Moldable** | real; shapeable | moldable.ai owned by the "moldable development" creator |
| **Chamfer** | real; CAD edge op | chamfer.ai taken; spelling friction |

**Taken / collisions — do NOT revisit:**
Maket (maket.ai — AI design), Makit (SaaS + Makita), Makette (luxury bags), Makely (agency),
Maketto (restaurant), Maketa (parked), Modlr (finance), Reify (reify3d.com — 3D printing),
Kiln (kiln3d.com — AI→3D printers), Loft (CAD command + loft3di), Formetry (formetry.in — 3D décor),
Forme (architecture + apparel), Fingo (fintech + biometrics), Tactum/Tactus (Autodesk research + therapy),
Carve (VCarve CNC), Relief (reliefmaker — 3D reliefs), Strata (strata.com — 3D modeling),
Makeform (makeform.ai — AI form builder), Formwork (generic 3D-print term), Trueform (agency/fitness),
Whittle (Dassault mine-planning CAD), Hewn (wood building products), Klae (hair care),
Figmint (Target kitchen brand), Promptu (voice AI), Morfo (3D face app + engineering firm),
Voxa/Voxo (multiple), Voro (voro.ai for-sale), Vormi (parked), Orma (woodworking machinery),
Formcast (car-design podcast), Volm (packaging).

> Method: brand collisions via web search (focused on 3D/CAD/AI/print/design); domain status via
> live WHOIS lookups. Not a legal trademark clearance — confirm with a registrar + USPTO before committing.

## Conclusion & next step
A clean single dictionary word + matching domain is effectively unavailable in this category. The
reliable routes are:
1. **Coin a distinctive, invented brandable** (Figma/Krea style) and verify a domain is open
   (**domain-first**) — best path to an ownable, Apple-style name.
2. **Two-word / compound** brand (far more available).
3. Keep a loved word and use **.ai / .app / .studio / .design** or a `get-`/`try-` domain (category norm).

**Next:** finish the naming brief (interview in progress), then run a coined, **domain-first** round —
generating invented names and presenting only those that are clean in-space **and** have an open domain.

## Naming brief — confirmed (2026-06-18 interview)
- **Domain bar:** *brand-first* — pick the best name on merit, sort the domain after. A clean `.com`
  is **not** required (`.ai` / `.app` / `.studio` / compound all acceptable).
- **Style:** *best of any* — invented, real, or compound; optimize purely for the strongest name.
- **Personality:** want options across **both** "calm & Apple-minimal" *and* "bold & energetic."
- **Audience:** *equal blend* — a neutral name that fits precise CAD users and hobbyist/artistic users alike.

## Round 2 — brand-first candidates (in-space checked; domain = sort later)
**Calm / Apple-minimal**
- **Cairn** — a deliberate form built from raw pieces; calm, premium, craft. ✓ clean in 3D/AI.
- **Vorm** — abstract; means "form" (Dutch). ✓ clean in-space.
- **Maku** — "make," softened; warm, globally easy. ✓ clean in-space.
- **Etude** — "a study / small work"; artful, implies iteration. (likely clean — verify)

**Bold / energetic**
- **Utter** — you *utter* a description → it's made; punchy, clever, memorable. ✓ clean in 3D/AI.
  (Caveat: the "utter disaster/nonsense" idiom.)
- **Brik** — block / brick; solid, blocky, playful spelling. (likely clean — verify)
- **Mallet** — a shaping tool; tactile, hands-on. (likely clean — verify)

Avoid (in-space jargon / crowded): Strut (lattice "strut"), Stoke (Stoke Space + print services),
Rivet (LLM-agent builder + Rivet CAD), Ply (PLY 3D file format), Vellum (Ashlar-Vellum CAD).

## Round 3 — Spanish-origin candidates
User feedback: **Cairn rejected** (unclear meaning / origin / pronunciation). Preference: if a name
draws on another language, make it **Spanish** (phonetic → pronunciation reads clearly).

Vetted clean in 3D / CAD / AI (brand-first; domain = sort later):
- **Obra** — "a work / œuvre" (OH-brah). Calm, premium, artful — your design as a finished work. ✓ clean.
- **Molde** — "mold / cast" (MOL-deh). Maker/industrial; pour an idea into form. ✓ clean.
- **Trazo** — "a stroke / line" (TRAH-so). Design-y; from a single stroke to a form. ✓ clean.
- **Trama** — "weave / mesh / plot" (TRAH-mah). Ties to a 3D *mesh*; techy energy. ✓ clean.

Ruled out (in-space / crowded / generic descriptor):
- Brío (Brio AI fashion imagery + BRIO toys), Forja (a "Forja 3D" print creator), Cubo (WASP *CUBO*
  clay printer), Faro (FARO 3D metrology), Salto (Salto.io / SALTO AI), Seda (Seda research app),
  Rayo (Rayo Innovations + *Rayon* CAD), Joya (Joya Software House), Nodo (Nodo motion-control app),
  Chispa (dating app), Maqueta / Pieza / Boceto (generic in Spanish 3D tutorials; Boceto also used by Planner 5D).

## Brand directions explored (in Figma)
Three identity directions were mocked in the Figma file (frame "Brand directions"):
**Workshop** (Billet · dark graphite · industrial grotesk), **Studio** (Moldable · light · rounded sans),
**Precision** (Chamfer · near-black · geometric). Plus three color palettes — Graphite Pro, Paper
Light, Molten — in the moodboard's section 07.
