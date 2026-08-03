---
name: no-ai-slop
description: Guardrail against AI-slop design and AI-slop code. Use whenever designing or restyling UI, writing microcopy, or reviewing/writing code for Moldable. Encodes the researched tells that make interfaces read as "AI made this" and the code patterns that make a codebase read as machine-generated filler — with the fixes.
---

# No AI Slop

Slop is not one bad choice — it is the *statistical average* of every interface and
codebase the model has seen, shipped unedited. People spot it in under a second and
trust drops before they read a word. The counter-move is never "more decoration";
it is **fewer, deliberate decisions, repeated until they become a signature**.

## The one-second test

Before shipping any screen, ask: *if this were screenshotted next to ten
AI-generated apps, what would make someone certain it isn't one of them?*
If the answer is "nothing specific", the screen isn't done.

## Design tells → fixes

**Color & surface**
- ❌ Purple/indigo→blue gradient heroes, neon glows, cyan-on-dark accents, aurora/mesh blobs. ✅ One flat brand hue + neutrals; gradients only when they *do* something (mask a fade, tint a thumbnail).
- ❌ A gray 1px border around every card, on everything, always. ✅ Pick ONE separation strategy per surface: border *or* background shift *or* spacing. Delete the borders that aren't earning their line.
- ❌ Glassmorphism / backdrop-blur cards as default texture. ✅ Solid surfaces; blur only for true overlays.
- ⚠️ Second-generation slop exists: the "tasteful" cream + serif + sage-green look is now ALSO a recognizable default. A pleasant palette no longer differentiates — layout, motion and detail-craft do.

**Typography**
- ❌ Inter (or any one font) at three weights for display, body, logo and buttons alike. ✅ A real type system: distinct display voice, tight tracking on large sizes only, tabular numerals for data, a mono for machine values. (Moldable: Schibsted Grotesk display / system body / JetBrains Mono data — keep that contract.)
- ❌ Gradient text, letter-spaced ALL-CAPS "EYEBROW" labels above every heading.

**Layout**
- ❌ Centered hero → badge-pill above the H1 → three identical feature cards → bento grid. Identical card grids where every item has icon + title + two lines.
- ✅ One strong layout primitive repeated until it's a signature. Asymmetry where content earns it. Cards differ when their content differs.
- ❌ Uniform `rounded-2xl` on everything — or its cousin, a different radius on every element. ✅ A tokenized radius scale (2–3 values + pill), applied by element role.

**Components & icons**
- ❌ Emoji as icons (📁 🚀 ✨ ⚡ in headings, buttons, empty states) — a top-ranked tell. ✅ The project's own SVG icon set, one stroke width, one grid.
- ❌ Decorative sparkles anywhere. One ✨ is a flag; twenty is a diagnosis.
- ❌ "→" appended to every link. ✅ At most one arrowed call-to-action per view.

**Motion**
- ❌ Fade-up-on-scroll on every section, cards that lift/rotate on hover, shimmer everywhere. ✅ Motion only where it explains state change (enter/exit, progress, drag feedback); 150–250 ms; one easing family app-wide; `prefers-reduced-motion` respected.

**Copy**
- ❌ "Unleash / Elevate / Supercharge / Seamlessly / Effortless", exclamation points, emoji punctuation, em-dash-heavy marketing cadence, "Get Started" on a violet button.
- ✅ Say what the thing does, in the user's words, with real numbers ("Export STL · 3MF · STEP", "free key, ~1,500 req/day"). Error text states what happened and the next step. Buttons are verbs: Save, Export, Sign in, Not now.

## Code tells → fixes

- ❌ **Tutorial comments** that restate the line below them. ✅ A comment earns its place only by carrying what the code cannot: the constraint, the real-world bug, the "why".
- ❌ **Comments that lie** after a refactor. ✅ Comments are part of the diff — update or delete them with the code they describe.
- ❌ **One-use helpers & premature abstraction** — a function extracted "for reuse" with one caller, wrappers around wrappers. ✅ Inline until the third caller exists.
- ❌ **Duplicate near-identical blocks** solving the same problem twice in one file. ✅ Search before writing; extend the existing path.
- ❌ **Swallowed errors** — empty `catch {}` with no reason. ✅ Catch narrowly, and say in a comment what failure is being tolerated and why that's safe.
- ❌ **Type escape hatches** (`as any`, `@ts-ignore`) as a habit. ✅ Each one is a debt with a justification, or it doesn't ship.
- ❌ **Dead code**: unused imports/vars/branches, `console.log` leftovers, TODO litter. ✅ Zero tolerance — the linter and a pre-commit scan, not intentions.
- ❌ **Generic names** (`data`, `handleClick2`, `temp`, `utils.ts` grab-bags). ✅ Names carry domain meaning (`meshMark`, `dropToBed`, `reviveSplitPieces`).
- ❌ **Complexity inflation**: config objects, options params and layers "for the future". ✅ Build for the current caller; the future will state its requirements when it arrives.
- ❌ **Defensive boilerplate at machine scale**: try/catch + null-check + fallback around code that cannot fail. ✅ Trust invariants you established; validate at the boundaries only.

## Review pass (run on every feature)

1. Screenshot the changed UI; run the one-second test. Name the signature element.
2. Grep the diff for: emoji in UI strings, new gradients, new borders, new radius
   values outside the scale, "→" beyond one per view, buzzword copy.
3. Read the diff comment-by-comment: delete any comment that restates code;
   verify none now lie.
4. Grep the diff for `as any`, empty `catch`, `console.log`, one-caller helpers,
   duplicated logic.
5. Motion audit: every new animation must map to a state change; nothing animates
   just because it can.
