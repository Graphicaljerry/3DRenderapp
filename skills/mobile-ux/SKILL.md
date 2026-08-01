---
name: mobile-ux
description: Phone-first UX doctrine for Moldable — Apple's mobile design methods plus researched patterns from shipping iOS creative/AI apps. Use whenever designing, reviewing, or implementing ANY phone or small-viewport interface in this repo — mobile layouts, touch interactions, bottom sheets, thumb-zone placement, or when the user says an interface feels overwhelming or impractical on mobile.
version: 1.0.0
user-invocable: true
argument-hint: "[surface to design or fix, e.g. 'phone inspector', 'mobile composer']"
---

# Mobile UX — how Moldable should behave on a phone

Researched August 2026: Apple HIG + WWDC 2025/2026 material (Liquid Glass era), plus
shipping iOS patterns pulled from Mobbin for the three app families Moldable straddles —
3D viewers, AI generators, and canvas editors. The point of this skill: **the phone is
not a narrow desktop.** Do not adapt the desktop shell down; compose the phone from
phone parts.

## The one-sentence brief

Full-screen model, one floating prompt bar at the bottom, everything else a sheet —
because on a phone the thumb lives at the bottom and the subject deserves the screen.

## Apple's doctrine (the rules we obey)

1. **Bottom = actions, top = exits.** Tab bars and toolbars live at the bottom because
   that is where the thumb is; Apple formalized bottom placement for one-handed reach.
   Tab bars navigate, toolbars act — never mix the two jobs in one bar. Top corners get
   only close/back (top-left) and commit/share (top-right).
2. **The thumb map.** One-handed grips dominate phone use. Easy: bottom half, center.
   Hard: top edge. Hardest: top-left corner (right-handed majority). Anything used
   repeatedly during a session must sit in the easy zone; anything rare may sit high.
3. **Hit targets.** 44×44 pt default, 28×28 pt absolute floor (Apple's published table).
   Coarse pointers NEVER get smaller targets than desktop — if anything, larger. Spacing
   between targets matters as much as size.
4. **Sheets, not pages.** Since iOS 16, the resizable sheet with detents is Apple's
   container for secondary content over a primary canvas (Maps, Find My, Photos edit).
   A sheet keeps the subject visible behind it and dismisses by swipe. Prefer a sheet
   with detents over navigating away from the canvas.
5. **Liquid Glass era (iOS 26+):** chrome floats above content as capsules; the tab bar
   can minimize on scroll to yield to content; an accessory view (Music's mini player)
   may dock above the bottom bar; radii are **concentric** — a nested element's corner
   radius = parent radius − padding, and capsules use half their height. Controls yield
   to content, never the reverse.
6. **One primary action per moment.** Progressive disclosure is the default posture:
   "include just what's necessary… let the others fall away." Defaults are decisions —
   ask nothing a good default can answer (Part fit, engine, model all have defaults).
7. **Minimize chrome during interaction.** While the user manipulates the subject
   (orbiting the model), floating chrome should fade or minimize — the video-player
   contract: tap to reveal, idle to hide.

## What shipping apps actually do (Mobbin, iOS)

**3D object viewers — the closest thing to our stage:**
- Apple Store's product 3D view: full-bleed object, × top-left, AR|Object segment
  top-center, share top-right, ONE floating info pill bottom-center. Nothing else.
  https://mobbin.com/screens/0596c813-7740-4d9c-8260-4ac8cbd9413b
- Crate & Barrel does the identical layout for furniture; IKEA's room viewer adds a
  single bottom toolbar. The genre rule: **the object owns the screen; controls are
  two corners and one bottom element.**
  https://mobbin.com/screens/cd1be507-04a8-45da-8834-86f1a1f20a71

**AI generation — the prompt-first flow:**
- ChatGPT: chat IS the app; the composer capsule floats at the bottom; a generated
  image lands inline with one small "Edit" chip on the artifact.
  https://mobbin.com/flows/36f82997-f4d6-4971-951f-9df99b87aa23
- ElevenLabs: results above, composer pinned at the bottom with option CHIPS inside the
  bar (model, ratio) — advanced choices ride on the bar, not above it.
  https://mobbin.com/flows/0da3c00f-4284-4f7f-9be2-8715b551fc77
- Canva Dream Lab: the empty state is one question ("What image would you like to
  create today?"), one field, one Create button, two option chips. Everything else
  scrolls away below the fold.
  https://mobbin.com/flows/d5c84bb6-274e-4003-ab15-bd078079f2c9
- CapCut text-to-image: prompt in a full-screen dark sheet over the keyboard; results
  as a 2×2 grid with Modify/Regenerate chips; then a labeled BOTTOM action bar
  (Retouch · Upscale · Save · Refine). Verdict actions at the bottom edge.
  https://mobbin.com/flows/c2763a63-bc97-4fe8-a255-076c3a909c88

**Canvas editors — where tools go on a phone:**
- eBay, X, Pinterest, KakaoTalk photo editors are unanimous: full-bleed canvas,
  Cancel/title/Done at top, ONE icon row at the very bottom. Pinterest shows the
  two-tier form: a contextual chip row above a labeled action row.
  https://mobbin.com/screens/e0a593e7-f1ac-4750-aa7b-66cde5001d46
- Nobody ships a left tool rail on a phone. The left rail is a desktop/tablet idea;
  on a phone it collides with the thumb's arc and the content both.

## The Moldable phone shell (apply, in this order)

1. **Stage full-bleed.** No page-grey margins, no card frame on the phone — the canvas
   runs edge to edge behind safe areas (the floating-card shell is desktop grammar).
2. **Bottom composer capsule = home base.** "What would you like to build?" floats at
   the bottom, always reachable, ChatGPT-style. Option chips (engine, model, fit) live
   ON the bar as one settings chip opening a sheet — not as rows stacked above it.
3. **Chat is a sheet, not a region.** Collapsed = composer only. Mid-detent = composer
   plus the latest exchange. Full = transcript. The model never loses the screen to an
   empty transcript — the fixed 42vh chat region is desktop-stacking, not phone design.
4. **Tools move to a bottom icon row** (Select · Transform · Measure · Mark · …) that
   appears above the composer when a model exists, CapCut-style; the left rail does not
   render on phones. Contextual actions (picked face → Round/Bevel/Push-Pull) surface as
   a chip row directly above the tool row, Pinterest-style.
5. **Inspector stays a bottom sheet** with the section chip row (already shipped), and
   gains detents: half (kv rows visible) and tall (params/source). Swipe down closes.
6. **Top corners only:** wordmark/back top-left, Export top-right (the one commit).
   Everything else that used to live in the topbar goes to sheets or dies on phone.
7. **Fade chrome while orbiting.** Pointer-down on the canvas fades floating pills to
   ~0 over 150 ms; release restores. The model is the app while a finger is on it.
8. **Numbers:** 44 pt targets on coarse pointers (28 pt floor for dense clusters);
   concentric radii (child = parent − padding; capsules = height/2); safe-area insets
   on every bottom-anchored element; `prefers-reduced-motion` honored on sheet travel.

## Anti-patterns (things this repo has shipped and must not re-ship)

- Stats card / diagnostic chrome colliding with the gizmo on a short canvas — verdicts
  belong in the Printability sheet, not floating over a phone stage.
- Two topbar rows, or any wrapped bar. One row per band, always.
- The desktop split (chat column beside canvas) squeezed below 900 px. Stack it, then
  below 760 px replace the stack with the sheet architecture above.
- A 262 px fixed side panel on a 390 px screen — any fixed-width panel must become a
  full-width sheet on phones.
- Buttons that shrink under a container query on the exact devices where fingers are
  the pointer. Density inverts: desktop may be dense, phone may not.

## Separate app or same app?

Same app, different shell. The web app installs as a PWA and the market gap (AI
text-to-3D on phones) rewards shipping now; a separate native app would fork the
codebase to rebuild the same screens. Branch the SHELL by viewport/pointer (distinct
phone composition, not squeezed desktop), keep the engine/state shared, and a native
wrapper (Capacitor / App Store) stays open later with this same design.

## Checklist for any new mobile surface

- [ ] Reachable one-handed? (primary action in the bottom half)
- [ ] One primary action on screen?
- [ ] Secondary content in a sheet with a swipe-down exit?
- [ ] 44 pt targets, safe-area insets, no wrapped bars?
- [ ] Subject visible while the control is open?
- [ ] Chrome yields during direct manipulation?
- [ ] Works in both themes; motion respects `prefers-reduced-motion`?
