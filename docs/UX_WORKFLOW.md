# UX Workflow & Navigation Redesign

_Written 2026-07-26. Supersedes the navigation sections of `WIREFRAMES.md`._

**Visual companion:** [`docs/wireframes/ux-v2-wireframes.html`](wireframes/ux-v2-wireframes.html) —
every screen below, drawn.

This document answers three questions: **what is hard to navigate today**, **what replaces it**,
and **what makes this app different from every other AI-3D tool**. Everything here is grounded in
the shipped code (file:line references throughout) or in cited research. Where something is a
taste call rather than a finding, it says so.

---

## 0 · The honest summary

Three things are true at once, and the plan depends on holding all three:

1. **The app is good and deep.** Two engines, printability analysis, tolerance calibration,
   multi-plate layout, paint/multi-filament, measure-from-photo, STEP export, version history.
   Very little needs to be built. Most of this work is *relocation*.
2. **It is very hard to navigate.** ~54 interactive controls are visible at once in the default
   workspace; `Workspace.tsx` alone contains 167 `<button>` elements. Reset view has five entry
   points. Plate assignment has five. Meanwhile the single highest-value feature in the product —
   the guided "fix a broken part" flow and the Fit tolerance control it unlocks — exists **only**
   in the zero-message empty state and becomes permanently unreachable after the first message.
3. **This redesign adds ~15 components and removes ~20.** The simplification is real, but it is
   entirely contingent on the removals shipping in the same release as the additions. If the
   additions land and the removals slip, the app is measurably worse than it is today. This is the
   single largest risk in the plan and it is stated here rather than buried.

---

## 1 · Reconciling the "no home page, no login" doctrine

`WIREFRAMES.md:37-40` and `PLAN.md:28-30` say:

> **Apple-simple. There is no home page and no login.** The workspace IS the front door.

That is no longer describing this product. Login shipped (Supabase: GitHub, Google, magic link,
password, persisted desktop session). And the live first surface is **not** a bare canvas — it is
`KeyCard` (`src/App.tsx:3921-4012`), a 440px card with **eight competing actions**:

> Start free · Continue with GitHub · Continue with Google · Email me a login link ·
> Create account · Sign in · Continue with my key · start from a template · view the example

Two of those — Templates and the built-in example, the two fastest paths to a model on screen —
are plain text links at the very bottom, underneath two nested `<details>` elements.

**So the comparison is not "splash screen vs. pure canvas." It is "splash screen vs. the worst
screen in the app."**

The doctrine was never really about having no home page. It was protecting four values:

| The value it protected | How the Launchpad keeps it |
| --- | --- |
| No dead-end screens | The first screen accepts a description and starts building. The KeyCard cannot make anything. |
| An account is never required | Unchanged. Sign-in is one quiet link; templates build with no key, no account, no AI call. |
| One primary action | The composer is the only filled, high-contrast element on the screen. |
| Minimal time-to-first-model | It gets **faster** — see §4. |

**Proposed rewrite for `PLAN.md`:**

> **Apple-simple. No screen exists that you cannot work from.** Whatever opens first accepts a
> description and starts making something. An account is never required to make something.

---

## 2 · Vocabulary — fix this before drawing anything

The word **"fit" currently carries seven unrelated meanings** in this product. This is the single
most damaging thing in the UI and it costs nothing to fix.

| Today | Means | Rename to |
| --- | --- | --- |
| `⤢ Fit` (view) | Frame the selection in the camera | **Frame** |
| `F` key | Same | **Frame selection** |
| "Fits P1 ✓" | Fits build **plate 1** | **Fits your bed ✓** |
| "Fit to plate" | Scale the model down to fit the bed | **Scale to fit bed** |
| "Check fit" / "Make it fit" | Boolean clearance between two parts | **Check clearance** / **Cut to fit** |
| "Fit: Snug" | FDM clearance tolerance | **Fit** — the only survivor |
| "Fit Sheet" (proposed) | Dimension table | **Dimensions** |

> ⚠️ **"Fits P1 ✓" is the most dangerous label in the app.** To this audience, P1 is the Bambu Lab
> P1S. A user reading "Fits P1 ✓" will believe the app has checked their printer. It has checked
> build plate 1.

**De-jargon the verb set once, everywhere** (and then propagate — don't leave "Fillet" in one
surface and "Round" in another):

| CAD word | Say instead |
| --- | --- |
| Fillet | **Round** |
| Chamfer | **Bevel** |
| Extrude / Offset | **Push / Pull** |
| Precise (CAD) vs Generative (AI mesh) | **Exact millimetres** vs **Organic shape** |

---

## 3 · Navigation model

### North star

> Every screen is one you can work from: the model never leaves the stage, the tools on screen are
> only the ones that apply to what's selected, and the physical truth of the part — its
> millimetres, its bed fit, its printability — lives permanently in the frame rather than down a tab.

### Principles

1. **One front door, and you can type into it.** There is exactly one "What do you want to make?"
   in the product. Today there are two, ten seconds apart — the KeyCard and the chat empty state
   (`Workspace.tsx:2523`) — and the second is destroyed by the first message.
2. **Tools follow the selection, not the tab.** Nothing appears over the canvas unless it operates
   on what is selected. (Shapr3D's adaptive UI; Hick's Law.)
3. **Two disclosure levels, never three.** Frame → one named surface → stop. NN/g: designs beyond
   two disclosure levels "typically have low usability." Today the hole driller is four levels deep.
4. **One action, one home.** Anything else that reaches it is an accelerator pointing at that home,
   never a second implementation.
5. **The 3D view never leaves.** Panels dock beside the stage; they never replace it. Today
   Printability's "Overhang heatmap" changes what is drawn in a viewport that same tab has hidden.
6. **Print reality is chrome, not a destination.** Dimensions, bed fit and supports sit above the
   model from the first preview. This is the differentiator.
7. **Visible safety is what licenses hiding.** Undo, "what changed" and History stay on screen —
   that is the precondition for aggressive progressive disclosure. (Tognazzini: users in an
   environment that feels hazardous don't make more errors, they just work far slower.)
8. **Labels carry the words.** No icon-only control outside the composer. `styles.css:1057` hides
   every rail label with the comment "titles carry the words" — on a product that targets iPad,
   where `title` tooltips do not exist.

### App map

```
Moldable
│
├── /            LAUNCHPAD ── the only front door
│   ├── Composer ....... "A wall bracket for a 32 mm pipe…"   [📎] [⏎]
│   ├── Start-from row . 4 template chips (real templates, no key, no AI call)
│   ├── Fix a broken part .. permanent CTA — no longer one-shot
│   ├── Recents ........ thumbnail cards (returning users only)
│   └── Quiet row ...... Sign in to sync · Skip
│
├── /m/:id      STUDIO ── chat-left / stage-right (shell unchanged)
│   ├── Topbar ......... ⬡ Moldable / «Project title»      New · Library · Account
│   ├── CHAT COLUMN .... messages · composer (mode · model · web · 📎 · send)
│   ├── STAGE .......... the WebGL canvas — never unmounts, never replaced
│   │   ├── PRINT BAR ....... 78 × 70 × 78 mm · Fits your bed ✓ · No supports ✓ · Fit: Snug ⌄
│   │   ├── CONTEXTUAL TOOLBAR ... appears at the selection, resolves from it
│   │   ├── VIEW CLUSTER ......... ViewCube · ⌂ Home · ⤢ Frame · View ⌄
│   │   ├── PLATES STRIP ......... All · P1 · P2 · +      [filters only]
│   │   └── STATUSBAR ............ Design ─ Check ─ Print ready · Export ⌄
│   └── INSPECTOR (right dock — exactly ONE panel open at a time)
│       └── Selection · Objects · Parameters · Printability · Source · History
│
├── /library    LIBRARY ── projects grid + Templates tab
├── SETTINGS (overlay) ── AI · 3D engine · Printer · Appearance · Account
└── EXPORT (overlay) ──── the ONLY export surface
```

### The tool disclosure ladder

Three questions, asked in order. **There is no fourth tier.**

1. *Does this tell me where I am, what I'm making, or is it needed with nothing selected?*
   → **Tier 1: always visible.**
2. *Does it operate on the current selection?* → **Tier 2: on selection.**
3. Otherwise → **Tier 3: behind one named surface.**

**Tier 1 (~22 controls, down from ~54):** topbar (home, title, New, Library, Account) · Print Bar
(dimensions, bed fit, supports, Fit ⌄) · View cluster (ViewCube, Home, Frame, View ⌄) · Statusbar
(path-to-print, Export ⌄) · chat composer · Inspector selector · Undo/Redo · Plates strip at ≥2
plates.

Critically, Tier 1 now contains two things that are **unreachable today**: the Fit clearance
control, and a permanent route to the guided flow.

**Tier 2 — the contextual toolbar**, anchored at the selection (Fitts's Law: pointer travel ≈ 0):

| Selection | Verbs |
| --- | --- |
| Nothing | Select · Move · Measure · Mark · Paint |
| Face | **Round · Bevel · Push/Pull · Hole… · Paint · Measure** |
| Edge | Round · Bevel · Measure |
| Multi-face | Push/Pull all N |
| Whole model | Move · Rotate · Scale · Separate · Drop to plate |
| Attachment | Check clearance · Cut to fit · Drop to plate · Merge · Delete |
| Mesh object | Scale · Orient · Hollow · Split · Repair · Simplify · Paint |

> **"Ask AI" is deliberately NOT in this toolbar.** Selection routes to the AI through exactly one
> mechanism: a removable scope chip in the composer — `editing: top face · 62 × 24 mm ✕`. Two
> mechanisms for one concept is the exact duplication this redesign exists to remove.

### Escape — one contract

Escape clears, in this order, and **never navigates**:

```
open menu/overlay → tool sub-mode → selection → armed tool → Showcase
```

It does **not** close the Inspector (a dock the user opened deliberately), and it is **not** bound
to "skip" on the Launchpad. One contract, no exceptions.

Today `App.tsx:3394` claims in a comment that Escape mirrors clicking empty canvas. It does not —
it cannot reach `markMode`, `showLayers` or `showHelp`, which are Workspace-local. No modal in the
app closes on Escape at all.

### Camera navigation — teach it, because nobody knows it

The single most-cited novice failure in 3D tools (Autodesk's own ViewCube study) is ending up
"looking off into space where no data existed, or inside parts of the 3D model and/or upside down."

- One hint under the first model: **"Drag to orbit · two fingers to pan · scroll to zoom · F to frame"**
- `⌂ Home` gets a permanent **visible label**, not just a glyph.
- The ViewCube is **drag-capable** (Autodesk measured dragging at roughly twice the speed of
  clicking), with invisible hit areas larger than the visible glyphs.

---

## 4 · The Launchpad (the splash screen)

**Concept: Moldable does not gain a splash screen. It loses one.** The KeyCard is already a
full-screen gate; it just can't make anything. The Launchpad replaces it with a surface whose
primary element is a composer you can type into in the first painted frame.

It is a **route** (`view === "launchpad"`), not a modal, not a timed state, not a Suspense
fallback. Browser back returns to it. It never appears in front of work in progress.

### It makes the app faster, not slower

`App.tsx:1034` reads `if (!entered || sel) return;` — so the **~11 MB OpenCascade WASM download
does not begin until the gate is dismissed.** Changing that guard to `if (sel) return;` lets the
kernel download and compile during the seconds the user spends reading the headline and typing a
sentence with three measurements in it.

**The screen that supposedly delays the user is what removes the wait.**

### Anatomy — eight elements, no more

Keep the count honest. If it exceeds eight interactive elements, cut before drawing.

| # | Element | Copy |
| --- | --- | --- |
| 1 | Reduced topbar | mark · Library (only if recents exist) · theme · Sign in / avatar |
| 2 | Printer chip | `SET YOUR PRINTER — SIZES ARE CHECKED AGAINST IT` (see warning below) |
| 3 | Headline `<h1>` | `What do you want to make?` / `…make next?` when returning |
| 4 | Subhead | `Describe a part in plain language — real millimetres, checked against your printer, exported as the files your slicer wants.` |
| 5 | **Composer** | placeholder `A wall bracket for a 32 mm pipe…` · 📎 attach · engine chip · ⏎ Build it |
| 6 | Honest caveat | `Sizes are AI-generated — check the fit before a long print.` **Directly under the composer.** |
| 7 | Start-from row | 4 template chips, or recents when they exist |
| 8 | Guided CTA | **Fix a broken part** — *Photo in → a replacement that actually fits* |

Plus a footer: privacy line · `Sign in to sync` · `Skip — open an empty workspace`.

> ⚠️ **Never render "BAMBU LAB P1S".** `DEFAULT_PRINTER` in `src/print/printability.ts:33` is
> `{bed: {x:256,y:256,z:256}, overhangThresholdDeg: 45}` — a bare bed size with **no brand and no
> model**. The app cannot know what printer you own. Until the user picks one, the chip is a
> call to action, not a readout.

> The honest caveat belongs **under the composer**, not pinned to the floor in 10.5px. You cannot
> make anti-misrepresentation your positioning and then place your one honest sentence where it
> won't be read.

### The chips must map to templates that actually exist

`src/cad/templates.ts` contains: `phone-stand`, `cable-clip`, `wall-hook`, `box-with-lid`,
`desk-hook`, `plant-pot`, `coaster`, `bag-clip`, `cable-winder`, `spacer`, `tolerance-coupon`.

There is **no bracket, enclosure, adapter or organiser template.** Chips named for those would
route every keyless first-timer straight into the provider wall — breaking the "a model on screen
is guaranteed regardless of key state" promise.

| Chip | Builds | Cost |
| --- | --- | --- |
| **Wall hook** | `wall-hook` template | free, no key, no AI call |
| **Cable clip** | `cable-clip` template | free, no key, no AI call |
| **Box with lid** | `box-with-lid` template | free, no key, no AI call |
| **Phone stand** | `phone-stand` template | free, no key, no AI call |
| **More…** | Templates modal (11 templates) | free |

Dimensioned example *sentences* (`A wall bracket for a 32 mm pipe, 4 mm wall, two M4 screw holes
40 mm apart`) still belong on the screen — as **text examples clearly marked "needs an AI key"**,
never as a hero chip.

**Chips prefill and focus. They never auto-submit** — mesh engines bill per generation, and an
accidental one-tap charge is an unrecoverable trust cost.

### Submit — the load-bearing behaviour

```ts
const text = draft.trim(); if (!text) return;
setEntered(true);              // folds in the old enterFree()
setView("workspace");          // the route change
void send(text, forceMode);    // App.tsx:2618 — UNCHANGED
```

The string goes **straight to the existing `send()`**. It is never written into the workspace
composer, never re-rendered into an input, never round-tripped. The first thing the user sees in
the workspace is their own text as a user bubble, already streaming. Nothing is re-typed.

Because `send()` is untouched, everything it already owns comes along free: auto mode-routing, the
self-healing retry loop, `ensureEngine()`.

### The provider wall is not a wall

Today: submit a CAD prompt with no key → a chat message **plus a force-opened Settings modal**
(`App.tsx:2892-2904`), on whatever pane was last used.

Instead, intercept *before* navigating. The view stays on the Launchpad, **the typed prompt stays
in the field**, and an inline card offers two live exits:

- `Add a free Google Gemini key — takes a minute` → Settings, pane explicitly `"ai"`
- `or build this as a mesh instead` → `send(text, "generative")`, works with zero key today

### Background — a build plate, in CSS

Five gradient layers on one fixed element. Zero JS, zero network bytes, zero animation, no
`backdrop-filter` (the `styles.css:344` ban stands).

1. **Isometric bed grid** — two `repeating-linear-gradient` at ±30°, 56px pitch, masked to the
   bottom of the viewport so nothing structural sits behind legible text.
2. **Teal bloom**, low and off-centre — like an LED under a gantry.
3. **Cool counter-wash** opposite it, so the field isn't a single tinted gel.
4. **Key light** (dark mode only) — dark mode has `--shadow-sm: none` and only ~4% lightness
   between `--surf` and `--bg`, so without this the screen reads flat.
5. **Layer lines** in the bottom 160px at 2.4% — the FDM signature.

> 🎨 **Taste call, not a finding.** No research says a printer-bed backdrop increases trust. It is
> defensible as design — it is on-brand, free, and avoids the generic AI-purple gradient — but it
> is a judgment, not evidence.

Not: aurora/mesh gradient (the AI tell), autoplay video (LCP killer), animated canvas (burns the
frame budget the composer needs, and the app ships a *real* 3D viewport 200ms later — a second,
fake one is a lie), or a photograph (this community has organised *against* beauty renders;
MakerWorld now requires a real printed photo on every upload).

### First-time vs returning — one layout, two slots

**No separate first-run screen exists.** Nothing to build twice or let drift.

| State | Row shows | Headline |
| --- | --- | --- |
| Cold, no projects | `<TemplateStrip>` — "one tap, no key needed" | What do you want to make? |
| Returning, ≥1 project | up to 6 recents by `updatedAt` | What do you want to make **next**? |
| Signed in | recents incl. synced | (same) |

**Recent card titles must be `prompt · version · differing dimension`** — e.g.
`Wall bracket · v6 · clearance 0.3` — *not* the raw first prompt. Six iterations of one bracket all
start from the same prompt; titling by prompt alone makes near-duplicates indistinguishable, which
is the exact problem project management is supposed to solve.

### Escape hatches

- `Skip — open an empty workspace` — a **visible link only**. Not bound to Esc (§3).
  The workspace it lands on needs a real empty state; "Describe a change" is meaningless with
  nothing on screen.
- **Straight to the last project** — the first recent card.
- **`moldable_launch`** in localStorage (`"launchpad"` | `"last"`). Surfaced as a one-time inline
  nudge **after the first successful export** (not the third project — a ten-minute user makes one
  part and never reaches three, so as originally specified they'd see the splash forever with no
  offered exit). Reversible in Settings → Appearance, always.
- ⚠️ `moldable_launch` and `moldable_lp_draft` must be added to `LOCAL_ONLY_KEYS` in
  `src/lib/backup.ts:35-50`, or `gatherSettings` sweeps every `moldable_` key and a per-device
  preference syncs across devices — the same defect that already makes `moldable_entered` behave
  oddly on a second machine.
- **Draft survival** — `sessionStorage.moldable_lp_draft`, debounced 400ms, so a trip to Settings
  never eats a prompt containing three measurements the user had to go and take.

### Transition to the workspace — 220ms, non-blocking

Both surfaces paint on `--surf`, which `index.html`'s pre-paint script already stamps on `<html>`.
So the transition is a **cross-fade over a constant background**: no flash, no colour step.

```
t=0      submit → setEntered · setView · send()   (same React commit)
0→160ms  hero: opacity 1→0, translateY 0→-10px   cubic-bezier(.23,1,.32,1)
60→260ms shell: opacity 0→1, scale .994→1        (the 60ms overlap makes it one motion)
~120ms   the user's own sentence is already a bubble in the chat
```

No FLIP morph — morphing a 720px centred composer into a 400px column composer means animating
layout properties on the exact frames the generation request starts. It would jank, on the slowest
machines first.

> 🎨 **Taste call.** The specific millisecond values are design judgment. The constraint they
> satisfy is sourced (Android caps pre-interaction delay at 166ms); the exact numbers are not.

### Performance contract

- Composer accepts keystrokes **≤100ms after first paint** (Nielsen's instantaneous limit). Never
  animated in, never `disabled`, never awaits anything — not the kernel, not `listProjects()`.
- **Zero new network requests.** Background is pure CSS. Archivo 500/600/700 is already loaded —
  **do not spec 800**, it isn't in the font link and would synthesise.
- **Zero CLS.** The recents row reserves its height with a skeleton so nothing shoves the composer
  at the moment the user is aiming at it.
- LCP element is the `<h1>`. Text, present in the first commit.
- Bundle delta ≤10 kB gz.
- **One reload eliminated:** `pullOnSignIn` currently schedules `window.location.reload()` 400ms
  after mount (`App.tsx:303-307`), so a signed-in cold open can be splash → gate → reload → splash.

### Accessibility

- The headline is the app's **first-ever `<h1>`** — the workspace has none.
- `autoFocus` gated to `matchMedia("(pointer: fine)")`. **Never autofocus on touch** — it pops the
  keyboard, collapses the viewport, and hides the chips and cards that exist to help exactly the
  user who doesn't know what to type.
- Chips are real `<button>`s; on activation they announce via a polite live region:
  `Prompt filled. Edit it, or press Enter to build.`
- `prefers-reduced-motion` must be added **by hand** to the allowlists at `styles.css:258, 326, 731`
  — the app has no global motion guard, so a new animation plays regardless.

---

## 5 · Core workflows

Ten flows. F1 and F6 — the two load-bearing ones — are drawn step by step in the wireframe sheet; the other eight are governed by the spine below plus the cross-cutting rules at the end of this section.

| # | Flow | Job story | Success metric |
| --- | --- | --- | --- |
| **F1** | First run | *When I land from a Discord link with no account and no key, I want a real dimensioned part on screen without filling in a form.* | TTFM p75 ≤15s from a chip, ≤45s typed. ≥80% of first sessions reach geometry. **0% hit a hard wall.** |
| **F2** | Returning & resume | *When I come back to a part I was iterating on, I want to be back in it in one click.* | ≤2 clicks to resume; recents correctly ordered |
| **F3** | Describe → part | *When I need a functional part, I want to describe it and refine by conversation.* | Median AI calls per exported part ≤3 |
| **F4** | Photo / sketch / SVG → model | *When I have the broken thing in my hand, I want to photograph it rather than describe it.* | % of photo starts reaching export |
| **F5** | Refine — direct + chat | *When the shape is close, I want to grab the face and drag it.* | Selection→edit without opening a menu |
| **F6** | Print readiness | *Before I commit 6 hours of filament, I want to know it will print.* | % of exports passing preflight with **zero warnings** |
| **F7** | Organic / mesh | *When I want a figurine, I want the app to switch engines and tell me what I lose.* | Engine-switch regret (measured by immediate switch-back) |
| **F8** | Projects & versions | *When I have 25 near-duplicate brackets, I want to tell them apart.* | Correct-project open rate |
| **F9** | Settings / keys | *When I need a key mid-build, I don't want to lose my place.* | Return-to-work without losing the prompt |
| **F10** | Errors & recovery | *When it fails, I want to know what to do next.* | % of failures with a taken recovery action |

### F1 — the critical path, in full

```
cold open
   │  pre-paint script stamps theme+bg (index.html:21-33) — no white flash
   ▼
LAUNCHPAD ─────────────────────────── composer focusable in frame 1
   │                                  OCCT kernel begins warming (App.tsx:1034 guard change)
   ├── tap a template chip ──► prefills + focuses ──┐   free · no key · no AI call
   ├── type a description ─────────────────────────┤
   └── attach a photo ─────────────────────────────┤
                                                   ▼
                                              press ⏎
                                                   │
                     ┌─────────────────────────────┴──────────────┐
              needs AI, no key?                              has what it needs
                     │                                            │
                     ▼                                            ▼
        INLINE card, prompt preserved                    220ms cross-fade → STUDIO
        ├─ free Gemini key (1 min)                       user's sentence already a bubble
        └─ build it as a mesh now  ──────────────────►   generation streaming
                                                              │
                                                              ▼
                                              FIRST GEOMETRY + Print Bar + one camera hint
```

**Every branch ends in geometry.** There is no dead end. That is the whole design.

### F6 — print readiness

```
model on stage
   │
   ▼
PRINT BAR (always on) ── 78 × 70 × 78 mm · Fits your bed ✓ · No supports ✓ · Fit: Snug ⌄
   │        each item clicks through to ▼
   ▼
INSPECTOR → Printability  (docked beside the live stage — the model never leaves)
   │        hover a failed check → the offending geometry highlights in the viewport
   ├── thin wall     → Fix (thicken to 2.4 mm)
   ├── overhang 62°  → Auto-orient  ·  or accept supports
   ├── too tall      → Scale to fit bed  ·  or Split into pieces
   └── all clear
        ▼
   EXPORT (one surface, opens on the readiness checklist)
   ├── ✓ watertight   ✓ fits bed   ✓ scale sane   ✓ slicer-friendly   (the four that are computed)
   ├── Files ....... 3MF (default) · STL · STEP · OBJ
   ├── Plates ...... one .3mf per plate
   ├── Pieces ...... per piece · all as .zip
   └── Open in Bambu Studio · Open in OrcaSlicer
        ▼
   "Attach a photo when it's printed"  →  proof-of-print badge on the Library card
```

### Cross-cutting rules

- **Feedback lands where the action happened.** Direct manipulation on the right no longer posts
  its explanation into the chat on the left (`App.tsx:744-760` — and it fires once *per device*, so
  the second user of a shared machine gets nothing). Canvas actions confirm inline on the canvas
  with a visible Undo.
- **One popup, always.** `MaterialMenu`, `SurfaceMenu`, `ExportMenu`, the profile menu and the
  in-chat model picker all opt out of the app's own documented solo-menu invariant
  (`Workspace.tsx:67-71`). Two of them close **only on `onMouseLeave`** — impossible to dismiss on
  touch, on a product that ships for iPad.
- **Settings save on change.** Delete "Save all"/"Cancel" (`App.tsx:4232-4245`). Today a stray
  backdrop click silently discards a freshly typed API key. **Exception:** secrets get an explicit
  Save and a dirty-close prompt.
- **Every AI result is forkable, not overwriting.** Add `Try again, differently` beside every
  result so both candidates sit in History. "Regeneration overwrites the previous result" is
  currently a real failure mode with no escape.

---

## 6 · What sets this app apart

**Positioning:**

> The only design tool where every dimension has a visible source, every clearance is calibrated to
> **your** printer, and the app proves the parts fit before anything is printed.

Not "AI that makes 3D models" — that is commoditised by Meshy and Tripo, and actively *stigmatised*
by this audience (a Feb 2026 r/3Dprinting thread against AI models hit 2.4k upvotes; MakerWorld's
Exclusive Program now excludes AI content outright). **A fit-and-tolerance instrument that happens
to use AI to draw.**

### The signature moment — the Fit Check

Twenty seconds, one shot, no cuts. Two parts: a box and its lid. Drag the lid onto the box. A bar
appears and says, in real millimetres:

> **Lid clears the box everywhere · tightest gap 0.18 mm at the front-left corner · on your printer
> that's a snug fit** — *calibrated from your printed coupon*

Tap **Loose**. Both mating faces re-cut, the number becomes 0.38 mm. Export.

**Why nothing else can do this:** Meshy will tell you the mesh is watertight. Zoo will regenerate
the whole part and overwrite the old one. Neither of them — nor Tripo, AdamCAD, or Backflip — knows
there are *two parts that must mate*, has ever computed the gap between them, or has any idea what
your specific printer does to a 0.18 mm gap. **Every reviewed tool is single-part.**

### Differentiators, ranked by (felt value ÷ effort)

| Differentiator | What exists today | Real effort |
| --- | --- | --- |
| **Nozzle as a real setting** | ❌ Nothing. `PrinterDefaults` is `{bed, overhangThresholdDeg, name}`; `thinwalls.ts` hardcodes 0.8mm | **S** — one field. Do it first; it unblocks everything else |
| **Fit control made permanent** | Segment exists but gated on `guided` | **M** — see the warning below |
| **Print-honest viewport** | Printability panel exists but *replaces* the 3D view | **M** — IA surgery |
| **Fit Check (two-part clearance)** | Boolean machinery ships (`checkFit`) | **M** |
| **Point-at-it editing** (selection scopes the prompt) | Selection state exists | **S** — routing only |
| **Measure-from-photo** | Ships and the math is correct — but returns a *string* appended to the composer (`App.tsx:3852`) | **M** — needs structured output |
| **The print receipt** (one export surface) | Four disconnected export surfaces | **S–M** |
| **Dimensions panel** with provenance | ⚠️ See below | **L, in three phases** |
| **Proof-of-print** (photo on the project card) | Nothing | **S** |

### Three corrections to the obvious plan

> ⚠️ **The Dimensions panel is L, not M — split it.** `CadParams = Record<string, number>`
> (`src/cad/params.ts`), populated by regex over `const defaultParams = {…}`. There is **no unit,
> label, min/max or origin on any parameter**; `grep -rn provenance src/` returns zero hits.
> - **Phase A (S):** render existing params + existing dims in one table. Replaces the
>   MeshStats / Selection Inspector / Set-size three-way overlap. No provenance. *Ship this.*
> - **Phase B (L):** new prompt contract emitting `{name, value, unit, role, source}` per
>   parameter, schema change, migration for stored projects.
> - **Phase C:** predicted printed size — additionally needs nozzle **and** asymmetric hole/shaft
>   compensation.

> ⚠️ **Making Fit permanent is a prompt-contract change, not a UI move.** `App.tsx:3017` reads
> `const fitLine = guided ? fitDirective(fit) : ""`. Fit is injected into **guided prompts only**.
> Making it permanent means changing what the model is told on *every* precise build, and unpicking
> `guided` from four other behaviours it gates: `REPLACEMENT_ADDENDUM` (3025), web-research
> triggering (2992-2993), `pickImage` mode-forcing (1391), and the reset at 3438. **Decide
> explicitly whether `guided` survives and what it still gates.**

> ⚠️ **Don't put unbuilt capability in the hero chrome.** Ship the Print Bar as
> `dimensions · fits your bed · needs supports · Fit ⌄`. The wall-vs-nozzle readout
> ("Walls 2.4 mm = 6× nozzle ✓") waits until nozzle is a real setting. Supports **is** backed —
> `src/print/overhang.ts` + `overhangThresholdDeg` already compute it — and for a hobbyist "will
> this need supports" outranks "are the walls 6× the nozzle" by a mile.
>
> **Print time and filament estimates are not available** and shouldn't be promised. They require
> actually slicing; `src/lib/slicer.ts` is a deep-link handoff only. That number comes from Bambu
> Studio / OrcaSlicer after the handoff — say so rather than faking it.

---

## 7 · Build order

**Ship first — these are defects today and shouldn't wait on an IA rewrite:**

| Fix | Evidence |
| --- | --- |
| `.canvas-rail` (z-index **30**, left:10/top:12) renders **over** `.pin-panel` (z-index **6**, top:12/left:12), covering the left ~49px and the heading of all four inspectors | `styles.css:1037-1047` vs `793` |
| `.plate-bar` and `.split-panel` occupy the **identical** slot (left:12/bottom:12/z-index:6) — split a model while plates exist and they stack | `styles.css:512` and `799` |
| `--shadow` is referenced 5× and **never defined** — `.inspector`, `.layers-panel`, `.help-sheet`, `.pmenu`, `.ai-preview-bar` all render shadowless in both themes | `styles.css` |
| The error boundary is hardcoded light-theme (`#15181e` on white) — a white flash in dark mode | `main.tsx:29-57` |
| `completeAuthReturn` appends a chat message, and `Messages` gates the empty state on `messages.length === 0` — so **every OAuth/magic-link user lands with no templates, no CTA, no chips** | `App.tsx:1238` |

**Then, in order:**

1. **Vocabulary pass** (§2). Free, and everything downstream depends on it.
2. **Nozzle as a real setting.** One field. Unblocks the print-readiness story.
3. **Launchpad** — delete `KeyCard`, move the kernel warm-up, de-duplicate the empty state.
4. **One dock** — five tabs → the Inspector; the stage stops unmounting.
5. **Contextual toolbar** — replaces the rail and the four colliding pin-panels.
6. **Print Bar** (v1 content only) + **one Export surface**.
7. **Fit Check** — the signature moment.
8. **Dimensions Phase A** → **Measure-from-photo structured output** → **Phase B**.

**Deferred to v2, deliberately:** the ⌘K command palette. Every research note in the corpus warns
against a palette before the IA is fixed — *a palette that is the sole route to a feature is a junk
drawer with a search box*. Ship the IA, instrument it, then use real telemetry to decide what earns
promotion. Shipping it *simultaneously* with the IA rewrite is the anti-pattern.

**Cut, not deferred:** the two-phase "Plan card" (a confirmation step between prompt and geometry).
No research backs it, it doubles AI calls against the ≤3 target, and it delays first geometry
against the TTFM target. Its actual job — catching wrong numbers cheaply — is better served by the
Dimensions panel being editable *after* the first build, with no AI call.

---

## 8 · Metrics you can actually observe

Replace unmeasurable targets with instrumentable ones:

| ❌ Don't measure | ✅ Measure |
| --- | --- |
| "≥95% of exports open in a slicer with zero errors" — the app has no visibility into the slicer | % of exports passing preflight with zero warnings; % of projects that gain a print photo |
| "undo surprise rate" | Undo followed by redo within 5s |
| "engine-switch regret <10%" | Switches followed by a switch-back within one message |

Chips fire **named** events (`lp_chip_wall_hook`, not `chip_clicked`) and are measured on **export
completion**, not clicks. A chip that gets tapped but never reaches an export is worse than no chip.

---

## 9 · Open questions for you

1. **Does `guided` survive as a flag?** (§6). This blocks the Fit work and three documents
   currently assume different answers.
2. **Mobile/tablet scope.** iPad is cited throughout as the reason for label rules and hit areas,
   but every layout here is desktop three-column. Is iPad a real target or an aspiration?
3. **`README.md` still says "Status: Planning. No code yet."** after 149 merged PRs. Worth fixing.
4. **Naming.** `NAMING.md` flags "retire Moldable before any public launch." The Launchpad is
   deliberately brand-light because of it — if the name is settled, the hero can carry more.
