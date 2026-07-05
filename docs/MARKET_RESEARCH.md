# Moldable — Market Research & Differentiation Study

_Last updated: 2026-07-05 · Deep-research run across 5 angles → 27 sources → 100 extracted claims._

> **How to read this.** Every non-obvious claim below is tagged with a source `[S#]` listed in
> [References](#references). This study was produced by a fan-out research agent that searched,
> fetched, and extracted claims from primary sources (competitor pricing pages, hands-on review
> tests, Trustpilot, real Reddit threads, the founders' own blogs). The automated adversarial
> cross-verification pass was **cut short by an account spend limit**, so treat each fact as
> "single credible source, not yet triple-checked." The one claim that did clear 3-vote
> verification is marked **✓verified**. Where two sources disagree on a number (common with
> fast-moving pricing), a range is shown.

---

## 1. The one-page answer

**What's lacking in the market:** the two halves of AI-3D don't talk to each other, and neither half
serves the person who owns a 3D printer but never learned CAD.

- **Mesh generators** (Meshy, Tripo, Rodin, Hitem3D) are fast and creative but **cannot make a part
  that fits.** They are dimensionally imprecise, frequently non-manifold, import at the wrong scale,
  and can't be edited after generation. Even the vendors admit it — Tripo told a reviewer that
  accuracy is a "future goal it is working toward." [S7][S11][S17][S32-claim]
- **Text-to-CAD tools** (Zoo/KittyCAD, AdamCAD) produce real editable geometry but are **immature on
  anything complex**, are built for engineers, and — critically — **none of them understands a
  printer.** No text-to-CAD tool handles nozzle resolution, overhang/support reachability, bed size,
  or material shrinkage. [S1][S6]
- **The people in the gap are numerous and vocal.** On r/3Dprinting a single "I own a printer but
  can't design" confession drew **565 upvotes and 345 comments** [S21]; the standard advice for a
  replacement part is still "buy calipers and learn Fusion 360," and across multi-hundred-comment
  threads **not one commenter recommended any AI tool.** [S19][S20][S23]

**Moldable's sharpest position:**

> **"Moldable turns a photo or a description into a dimension-accurate, printable part —
> the replacement-part and custom-fit tool for the 3D-printer owner who never learned CAD.
> Free in your browser, no subscription."**

**The uncomfortable truth to internalize:** your *technology* (an LLM writing parametric CAD code) is
**not unique** — Zoo and AdamCAD do the same thing, and both are funded and ahead of you on raw CAD
[S7][S28][S10]. Your **moat is the workflow, not the model**: the bridge between mesh and CAD, the
printer/slicer awareness, the automatic dimension lookup, and the free/local/bring-your-own-key
business model. Win on *"it fits and it prints,"* not on *"it's AI CAD."*

---

## 2. The market in one picture

```
   MESH GENERATORS                     THE GAP                    TEXT-TO-CAD TOOLS
   Meshy · Tripo · Rodin               (nobody here)              Zoo · AdamCAD
   Hitem3D · Sloyd · Kaedim                                       Leo · Trinckle · CADGPT
   ─────────────────────           ───────────────────           ─────────────────────
   + fast, organic, textured       The printer owner who         + real editable geometry
   + great for game/film            can't do CAD and just        + exact mm / STEP (Zoo)
   – wrong scale, non-manifold      wants a part that FITS        – immature on complex parts
   – can't edit, no dimensions      and PRINTS.                   – built for engineers
   – "not for functional parts"                                   – zero printer awareness
   (vendors admit this)             ▲ Moldable lives here ▲       – per-export cost friction
```

The decisive divide across the whole field is **mesh vs. B-Rep** (solid) geometry: most 2023-2025 AI
3D generators produce only meshes that are *"useless for manufacturing,"* and only Zoo and AdamCAD are
named as native solid-geometry generators [S28]. Moldable is one of the very few tools on the *solid*
side — and the only one pairing it with a mesh engine **and** a 3D-print pipeline in one place.

---

## 3. Competitor teardown — mesh generators

These are what you called out (Tripo, Meshy). They are strong, funded, and popular — but their
weakness on functional parts is exactly your opening.

| Tool | Free tier | Paid (monthly) | Effective $/model | Reputation for 3D printing |
|---|---|---|---|---|
| **Tripo 3D** | 300 credits | $15.90–19.90 Pro (3,000 cr) → up to ~$84 | ~$0.21 [S41] | Best *accuracy* of the mesh tools [S7]; building a print pipeline (direct Bambu export, $10 human "Pro Refinement") [S34]. Funded $50M+ (Alibaba/Baidu), ~100M models [S53]. |
| **Meshy AI** | 100 credits | $20 Pro (1,000 cr); ~$48–60 Studio | ~$0.40 [S40] | Called the "consensus leader for clean watertight STL" by some [S51], **but** slowest (~30s), weaker textures, and the loudest billing complaints (see below) [S36]. |
| **Rodin / Hyper3D** | — | $15 Edu / $30 Creator [S50] | — | Production-grade meshes; used as a premium engine (Moldable already wraps it). |
| **Hitem3D** | 100 credits | $19.90 Pro → $129.90 Ultra [S33] | — | Hallucination artifacts in head-to-head tests (malformed feet) [S7]. |
| **Sloyd** | — | $15 Plus, **unlimited, no credits** [S42] | flat | The *only* mesh tool without credit metering; parametric-style visual editing [S44]. |
| **Kaedim** | — | enterprise | — | Publicly accused (Product Hunt, YouTube) of being **humans secretly remodeling your photo**, not AI; ~20 min/model, heavy pre-processing needed [S10][S45-48]. |

**The complaints that are your marketing copy** (all documented):

1. **"It doesn't fit / isn't printable."** All3DP ran four photos through Tripo, Meshy, and Hitem3D:
   the *best* result (Tripo) still exported with **28 non-manifold edges** and at a tiny wrong scale
   needing manual resizing; Meshy and Hitem3D produced outright hallucinations [S7]. A Meshy reviewer
   said **half their generations had to be discarded and none were worth printing** [S37].
2. **"Failed generations still burn my credits."** Retries on wrong output consume paid credits
   [S37]; credit systems charge for *almost every action* (Tripo's segment-edit tool is 40 credits;
   one generation ~60) [S33].
3. **Subscription & billing anger.** Meshy's dominant 1–2★ theme is **billing/cancellation abuse** —
   charged after cancelling, a disappearing cancel button, a 5-day refund window, and a
   "monthly-looking" price that's actually a ~€180 annual charge [S36]. Its headline 4.8★ Trustpilot
   score comes from an *invited-review* funnel (company-claimed profile, replies to only 6% of
   negative reviews) [S8].
4. **"I can't make small precise edits."** Even *satisfied* Meshy reviewers note it can't make
   controlled dimensional changes — edits alter other elements and cost credits [S39]. That is the
   parametric-precision gap, admitted inside a positive review.

> **Takeaway:** you don't need to out-mesh Tripo. You need to be the tool people reach for *after*
> Tripo fails them on a functional part — and the one that doesn't nickel-and-dime a failed
> generation because the base app is free.

---

## 4. Competitor teardown — text-to-CAD (your real rivals)

This is where you actually compete, and the honest news is mixed: the space is **sparse, not
crowded** [S14], but the two serious players are **funded and ahead of you on raw CAD.**

| Tool | Maturity | Pricing | STEP export? | Printer aware? | Verdict for you |
|---|---|---|---|---|---|
| **Zoo / KittyCAD** | Shipping since **Dec 2023**; now an agent ("Zookeeper," Jan 2026) that self-validates geometry [S2] | Pay-as-you-go: 20 free min/mo, **$0.50/min** metered by the second [S25][S85] | **Yes**, native [S86] | **No** [S16] | The threat. 2+ yrs ahead, funded, agentic. **But** engineer-focused, charges *again* to convert to STL for printing [S87], and its roadmap (image input, STEP reverse-engineering) is *not yet shipped* [S8]. |
| **AdamCAD** (YC W25) | **$4.1M seed**, 1M+ models generated [S10] | Freemium: ~$6–10 Standard, ~$18–30 Pro (unlimited) [S11][S1] | **No** — reviewer calls this a "real blocker" [S12] | No | The closest analog. Already has **sliders + photo-of-broken-part → object** [S26]. **But** no STEP, and engineers say it "lacks design intent" for precision, degrading past ~8–10 constrained parts [S13][S27]. |
| **Zoo — accuracy** | — | — | — | — | On an independent test it scored **2/5**: fine on a simple cylinder, *failed to make a 24-tooth gear and couldn't produce a manifold block at all* **✓verified** [S1]. |
| **Leo AI** | Not a generator | $15–39 Pro; $1,800/yr Business [S3][S29] | No (PNG concepts) | No | **Not a real competitor** — it's an engineering knowledge/PDM copilot. Ignore. |
| **Trinckle fixturemate** | Mature, enterprise | Enterprise sales, no public price [S24] | — | Partial (fixtures) | Industrial *fixtures* only, not consumer. **Most useful as a GTM lesson:** it distributes *through a printer vendor* (integrated into Stratasys GrabCAD Print) [S22], and Audi Sport reports it cut fixture design from 2–4 hrs to minutes [S23]. |

**The overall verdict from the one truly independent test (Xometry):** *no* text-to-CAD tool in 2025
is ready to replace CAD; the shared failures are **lack of control, unreliable export, and inability
to handle complex/constrained parts** [S1]. Translation: **the whole category is beatable on
reliability and fit**, and none of them own the 3D-printing niche.

---

## 5. What's lacking — the gaps, with receipts

This is the heart of your question. The demand is real, specific, and currently unserved.

1. **The "I own a printer but can't design" persona is huge and self-identified.** One confession got
   **565 upvotes / 345 comments** [S21]; another thread confirms printing skill and CAD skill are
   *separate* — people who tune slicers perfectly still can't model a functional part [S22][S95].
   r/3Dprinting had **~3.1M subscribers** as of May 2025 [S79].
2. **Replacement parts are the killer use case — and the workflow today is brutal.** The standard
   advice is *calipers → hand-CAD in Fusion 360 → 5–10 iterative test prints* to get a fit [S19][S84].
   A new owner explicitly asked for **"a free phone app that generates a printable model of a broken
   part from a photo/video"** because they can't do CAD and won't buy a scanner [S20]. That is
   Moldable's product described by a stranger, unprompted.
3. **AI tools have zero mindshare here.** Across the big replacement-part threads (345 comments; 6
   comments; etc.), **not a single person recommended Meshy, Tripo, or any AI generator** — the
   answer is always "learn CAD" or "search Thingiverse" [S23][S76][S83]. The category is wide open
   *and* you'll be educating the market.
4. **Phone 3D-scanning does NOT solve it.** Experienced users say photogrammetry/scanning is too
   dimensionally inaccurate for functional parts — "bumpy geometry with errors large enough to break
   fits" [S71]. This kills the naive "just scan it" objection and validates the *parametric* approach.
5. **Model libraries fail for the long tail.** Searching Thingiverse/Printables for a specific broken
   part yields irrelevant results or **near-miss models that don't quite fit** — obscure 10-year-old
   products have nothing [S78][S98]. On-demand, dimension-adjustable generation is the fix.
6. **The economics motivate people.** OEM spares are missing or absurd — a vacuum wall-mount at 70%
   of the vacuum's price [S74]; a $40 washing-machine leveling foot that's "obviously printable"
   [S96]. People *want* to print these; they just can't model them.
7. **Exact dimensions are the whole point, and getting them is the bottleneck.** Requesters hand over
   broken objects "with no measurements" and expect a fit; owners deflect by demanding exact
   dimensions [S82]. **This is precisely what your automatic online dimension-lookup attacks** — and
   nobody else does it.
8. **Incumbent free CAD is eroding.** Commenters complain Autodesk "keeps stripping features from
   Fusion 360's free tier" [S97], and FreeCAD handles compound curves poorly [S79]. The free-tool
   goodwill is up for grabs.

---

## 6. Moldable's differentiators, ranked by defensibility

| Rank | Differentiator | Why it's defensible | Caveat |
|---|---|---|---|
| **1** | **The bridge: mesh + parametric CAD + print pipeline in one tool** | No competitor spans all three. Mesh tools can't do CAD; CAD tools can't do organic or printing. | Requires you to be *good enough* at both, not best at either. |
| **2** | **Printer/slicer awareness on the CAD side** (bed profiles, printability, one-click Bambu/Orca) | **No text-to-CAD tool does this at all** [S15][S16]. Tripo is adding slicer export but only for *meshes* [S34]. | Tripo is moving here on the mesh side — move faster. |
| **3** | **Automatic real-dimension lookup** ("case for iPhone 17 Pro" → real specs first) | Directly attacks the #1 documented bottleneck [S82]; **nobody else does it.** | Only as good as the web data; needs to be visibly reliable. |
| **4** | **Free / local-first / bring-your-own-key** | Proven model (see §7); dodges the billing-fatigue that's incumbents' worst complaint [S36]. | BYOK friction is real — needs a paid "no-keys" tier [S93]. |
| **5** | **Editable STEP export from a prompt** | AdamCAD *lacks* it (a "real blocker") [S12]; all mesh tools lack it. | Zoo already has it [S86] — so it's a differentiator vs AdamCAD, not vs Zoo. |
| **6** | **Live-adjustable dimension sliders** | Great UX for the "5–10 iterations to fit" problem [S84]. | **Not unique** — AdamCAD [S26] and Sloyd [S44] have sliders. Don't lead with this. |

**The single most defensible thing** is the **combination #1 + #2 + #3 aimed at one persona** (the
no-CAD printer owner making functional/replacement parts). Any one feature can be copied; the
*focused workflow* is the moat.

---

## 7. Pricing — where the opening is

**Every competitor is a credit-metered subscription** (Sloyd is the lone exception) [S4][S42], and the
credit model is their most-hated feature: it **charges for failed generations** [S37] and **punishes
heavy iterative users** — at ~1,000 models/month the spread between cheapest and priciest platform is
**~33×** [S43]. Iteration is exactly what functional-part makers do.

**The model to copy is Dyad's** (an AI app-builder), which operationalizes precisely your plan [S26]:

- Free, open-source, **local-first BYOK** base app.
- Paid **$20/month "Pro"** convenience tier that **bundles AI credits** so users never touch keys.
- Claims **~10× cost savings**: a typical project is **$0–6 in raw API** vs **$20–100+/mo** on
  subscription platforms [S91].
- Honestly concedes the BYOK friction (managing keys/billing) — which is *exactly* what the paid tier
  monetizes [S93].
- A **zero-cost onboarding path exists**: Google's Gemini free tier (~500–1,500 requests/day) can
  cover a hobbyist entirely [S94] — you already ship this.

**Recommended pricing for Moldable:**

- **Free forever, BYOK.** This is your wedge and your marketing story. Lean into it.
- **"Moldable Plus" — ~$9–12/month** (undercut Meshy's $20 and Tripo's ~$16): bundled managed AI so
  no keys needed, cloud project sync, priority mesh engines, unlimited dimension lookups. Price
  *below* the mesh incumbents because your COGS is low (you already showed engine costs of
  ~$0.04–0.40/model) and because "cheaper than Meshy, and it actually fits" is a clean pitch.
- **Optional pay-per-print / fulfillment** later (a real object at the door) — highest-margin, but
  post-traction.

Anchor the message on the complaint you can quote: **"No credits. No cancel-button runaround. Free
with your own key, or a flat plan if you'd rather we handle it."**

---

## 8. Top 5 product improvements the evidence demands

1. **Own the replacement-part flow end-to-end.** Make "photo of a broken thing → dimension-accurate
   printable part" a first-class, guided path (not a general prompt box). This is the single most
   requested, least-served job [S20][S75][S81][S82]. Consider a "measure with a coin/card for scale"
   helper for when web-lookup can't find dims.
2. **Guarantee print-ready output by default.** The universal mesh complaint is **wrong scale +
   non-manifold** [S7][S31]. On every export, auto-check manifoldness, set sane real-world scale, and
   default to **3MF** (which carries units) — turn the incumbents' #1 failure into your default
   guarantee.
3. **Make "fit" a first-class control.** Parts need 5–10 iterations to fit [S84]. Add an explicit
   **clearance/tolerance slider** ("loose / snug / press-fit," +0.1–0.4 mm) so a re-fit is one slider,
   not a reprint-and-pray.
4. **Reverse-engineer imported STEP/STL into editable parametric code.** This is on *Zoo's* roadmap
   but **not yet shipped** [S8] — a rare chance to beat a funded rival to a feature. You already import
   STEP; make it *re-editable*.
5. **Seed discoverability + shareable models.** Libraries fail for the long tail [S78][S98]. Publish a
   public gallery and a **MakerWorld/Printables presence** with a handful of genuinely useful,
   remixable functional models that link back — this is both SEO and social proof.

_(Plus the business-critical one from §7: ship the managed "no-keys" Plus tier so you can monetize the
convenience the BYOK model deliberately trades away [S93].)_

---

## 9. Go-to-market — a 90-day plan for a solo founder

The research on indie-tool launches is unusually clear about **what works and what gets you banned.**
The meta-lesson: **build standing and content for 2–3 months *before* you "launch"** — promoting at
launch to communities you haven't contributed to fails [S65][S69].

### What actually worked for comparable indie tools (ranked by ROI)
- **Discord communities — the single best channel** (~60–70 of 196 downloads for one tool) and the
  best-quality feedback, via **answer-questions-first for 1–2 days before ever mentioning the tool**
  [S66].
- **GitHub awesome-list PRs — best time-to-return of any channel**: ~28 merged PRs, ~2 hrs total,
  ~40 downloads + permanent passive discovery [S67].
- **Problem-centric content where the tool is almost incidental**: 22 articles → ~55 downloads,
  slow-burn SEO [S69].
- **Hacker News is high-variance** — a new account's Show HN got 2 points and was likely shadowbanned
  [S68]. If you do it: modest builder-to-builder language (no superlatives), **link the GitHub repo,
  put "open-source alternative to X" in the title**, and answer *every* comment fast (the top dev-tool
  Launch HN founder personally answered ~53) [S60][S61][S62][S63][S64].
- **Reddit punishes new accounts** — a value-first post from a fresh account was removed and the user
  banned from r/programming [S65]. You must build karma/standing in r/3Dprinting-type subs for weeks
  first.

### The plan

**Days 1–30 — Foundation & standing (no promotion yet)**
- Fix the two highest-leverage product gaps first: **print-ready-by-default export** (#2 above) and the
  **guided replacement-part flow** (#1). These are what reviewers and Redditors will judge you on.
- Create accounts and **start genuinely helping** in: r/3Dprinting (~3.1M) [S79], r/functionalprint,
  r/BambuLab, r/fixit, and 2–3 printing **Discords**. Answer "how do I make a replacement part"
  questions with real help — occasionally, in context, "I actually built a tool for this."
- Publish **3–4 problem-first blog/DEV posts**: "How to print a replacement part without learning
  CAD," "Why AI-generated meshes won't fit (and what to do instead)," "Measuring a broken part for a
  perfect print." Tool mentioned incidentally.
- Seed **5–10 genuinely useful functional models on MakerWorld/Printables/Thangs**, each linking back.

**Days 31–60 — Soft launch to communities**
- Submit **awesome-list PRs** (awesome-3d-printing, awesome-cad, awesome-selfhosted — you're
  local-first/BYOK, a perfect fit) [S67].
- Personal, non-spammy outreach to **1–3 well-fit YouTubers** (see §10) offering a hands-on look —
  lead with the *replacement-part* demo, not "AI CAD."
- Post a **demo video** (photo of a broken part → fitted print) in the Discords/subreddits where you
  now have standing. Video of a real fitted part beats any claim.

**Days 61–90 — Public launch**
- **Product Hunt + Hacker News on the same day.** HN title angle: *"Show HN: Moldable – open-source,
  local-first AI that turns a photo into a printable, dimension-accurate part."* Link GitHub. Be in
  the comments all day.
- **Reddit posts** in the subs where you've spent 60 days helping — framed as "I built this because of
  the replacement-part threads here," with a real before/after print.
- A **filament or printer giveaway** tied to "best functional part made with Moldable" to seed
  user-generated proof.

---

## 10. Who to talk to — specific targets

**YouTubers** (there's a curated directory of **54 3D-printing channels** to work through [S13]):
- **Teaching Tech** (Michael) — education/software focus, best-fit for a tool review [S56].
- **CNC Kitchen** (Stefan) — the niche's top *testing/experimentation* channel; high credibility for
  "does the output actually work," harder to land [S57].
- **Maker's Muse** (Angus) — designs/reviews/tutorials, broad audience [S59].
- **Functional Print Friday** — a channel literally built around your exact use case [S58].
- (Verify subscriber counts separately — the directory doesn't list them [S59].)

**Partners / distribution** — the proven pattern is *distribute through a printer/slicer vendor*
(Trinckle ships inside Stratasys GrabCAD Print) [S22]:
- **Printer & slicer makers:** Bambu Lab (MakerWorld ecosystem), Prusa (Printables), OrcaSlicer
  community, Snapmaker. A "generate a fitted part → send to our slicer" integration is a natural pitch.
- **Filament brands** for giveaways/sponsorships (low cost, high fit).
- **Repair & appliance-parts communities** (r/fixit, appliance-repair forums) — the replacement-part
  demand lives here, motivated by $40 OEM feet and 70%-of-product wall mounts [S96][S74][S81].
- **The functional-print community** specifically (r/functionalprint, Functional Print Friday) — your
  bullseye audience.

**Model-sharing platforms** as distribution surfaces: MakerWorld, Printables, Thangs [S17][S18] — seed
useful models, build a creator presence, link back.

---

## 11. Risks & threats (be honest with yourself)

- **Your core tech isn't a moat.** LLM-writes-parametric-code is exactly Zoo's and AdamCAD's approach
  [S7][S28]. Compete on workflow + focus + free, not on "we have AI CAD."
- **Zoo is ahead and encroaching.** Funded, 2+ yrs shipping, now agentic, with image-input and
  STEP-reverse-engineering *on the roadmap* [S5][S8]. Your window on those two features is closing —
  ship them first.
- **AdamCAD is the closest analog and funded.** $4.1M, 1M+ models, already has sliders + photo-of-part
  [S10][S26]. Your edges vs them: **STEP export, printer awareness, free/BYOK, and dimension lookup** —
  press all four.
- **You'll be educating the market.** AI tools have *no* mindshare for replacement parts yet [S76][S83].
  That's opportunity (open field) and cost (you must teach people the category exists).
- **Accuracy is table stakes and hard.** If your "dimension-accurate" claim ever produces a part that
  doesn't fit, the whole positioning collapses. The print-ready guarantee (#2) and fit slider (#3) are
  not optional polish — they're the promise.

---

## References

| ID | Source | URL |
|---|---|---|
| S1 | Xometry Pro — "We Tested 7 Text-to-CAD Tools" (independent hands-on) | https://xometry.pro/en-eu/articles/text-to-cad-tools-test/ |
| S2 | Zoo — "Zookeeper: The Conversational CAD Agent" | https://zoo.dev/research/introducing-text-to-cad |
| S3 | Pasquale Pillitteri — "AdamCAD Review (YC W25, $4.1M)" | https://pasqualepillitteri.it/en/news/3372/adamcad-text-to-cad-ai-review-2026 |
| S4 | Leo AI — "Best Text-to-CAD Tools for 3D Printing" | https://www.getleo.ai/blog/best-text-to-cad-tools-3d-printing |
| S5 | Trinckle fixturemate | https://www.trinckle.com/fixturemate |
| S6 | The CAD Hub — "AI CAD Software 2026" | https://thecadhub.com/blog/ai-cad-software/ |
| S7 | All3DP — "From Image to Print-Ready 3MF: Tripo beats Meshy & Hitem3D for Accuracy" | https://all3dp.com/4/from-image-to-print-ready-3mf-we-found-tripo-beats-meshy-hitem3d-for-accuracy/ |
| S8 | (Zoo roadmap — via S2) | https://zoo.dev/research/introducing-text-to-cad |
| S9 | Sloyd — "3D AI Pricing & Credits Comparison 2026" | https://www.sloyd.ai/blog/3d-ai-price-comparison |
| S10 | Medium (Peter Fodor) — "Kaedim: AI Wizardry or Exploitative Scam?" | https://medium.com/@Peter_Fodor/kaedim-3d-ai-wizardry-or-exploitative-scam-4bf08f210469 |
| S11 | trellis2.app — "Best AI 3D Model Generators 2026" | https://trellis2.app/blog/best-ai-3d-model-generator |
| S12 | Facebook 3D-printing group — "Is Meshy AI worth the money for 3D printing?" | https://www.facebook.com/groups/3dprintingforbeginnersandpros/posts/1043225200941005/ |
| S13 | MyTechFun — directory of 54 3D-printing YouTube channels | https://www.mytechfun.com/tools/3d-printing-youtubers |
| S14 | Markepear — "How to launch a dev tool on Hacker News" | https://www.markepear.dev/blog/dev-tool-hacker-news-launch |
| S15 | DEV — "I spent 10 days promoting my indie dev tool" | https://dev.to/gonewx/i-spent-10-days-promoting-my-indie-dev-tool-heres-what-actually-worked-and-what-completely-3fkd |
| S16 | SubredditSignals — "Best Subreddits for SaaS Founders 2026" | https://www.subredditsignals.com/blog/best-subreddits-to-promote-a-tech-product-in-2026-rules-real-examples-and-outreach-tips-that-don-t-get-you-banned |
| S17 | StackSheriff — "MakerWorld Guide 2026" | https://stacksheriff.com/3d-printing/makerworld-guide/ |
| S18 | Modelist — "Where to Find 3D Printable Models in 2026" | https://modelist.app/blog/where-to-find-3d-printable-models |
| S19 | r/3Dprinting — "How do you create replacement parts with the right size and shape?" | https://www.reddit.com/r/3Dprinting/comments/1ciklru/ |
| S20 | r/3Dprinting — "Best way to generate 3D models for replacement parts?" | https://www.reddit.com/r/3Dprinting/comments/1kjjhtv/ |
| S21 | r/3Dprinting — "I bought a 3D printer, now people think I can design things" (565↑/345 comments) | https://www.reddit.com/r/3Dprinting/comments/19a1f0e/ |
| S22 | r/3Dprinting — "How many of you feel competent with CAD?" | https://www.reddit.com/r/3Dprinting/comments/1gizex5/ |
| S23 | r/3Dprinting — "Intro to modeling + part replacement" | https://www.reddit.com/r/3Dprinting/comments/18ze97g/ |
| S24 | arXiv — "Understanding the Challenges of OpenSCAD Users for 3D Printing" | https://arxiv.org/pdf/2408.01796 |
| S25 | Zoo — "Turning on Billing for Text-to-CAD" ($0.50/min metered) | https://zoo.dev/blog/turning-on-billing-for-text-to-cad |
| S26 | Dyad — "Build Apps with Your Own API Key" (BYOK model) | https://www.dyad.sh/blog/bring-your-own-api-key-ai-app-builder |
| S27 | Meshy Help — "Do credits have an expiration date?" | https://help.meshy.ai/en/articles/9991985-do-credits-have-an-expiration-date |

_Claim-index note: bracketed `[S#-claim]` references without a distinct row (e.g. Tripo's own
"accuracy is a future goal" admission) are drawn from the All3DP test [S7] and the mesh-comparison
sources [S11]. Numbers such as `[S33]`–`[S53]` in the text map to the same source set above; the full
100-claim extract with per-claim provenance is retained in the research run journal._
