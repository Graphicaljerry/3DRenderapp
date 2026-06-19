# Wireframe Content Outline

_Last updated: 2026-06-12_

This is a **guide for sketching the wireframes** — it lists every screen/section the app needs and
the specific content that belongs in each. You don't need design skill to use it: grab paper,
Figma, Excalidraw, or tldraw and sketch boxes for each item below. The goal is to agree on
**layout and content**, not visuals (colors/fonts come later).

> Scope note: Screens marked **[P1]** are needed for the Phase 1 Parametric MVP. Screens marked
> **[P2+]** come later. Sketch the [P1] ones first.
>
> 🖼️ **Visual companion:** see [`docs/wireframes/wireframe-sheet.png`](wireframes/wireframe-sheet.png)
> — a rendered, annotated version of every screen below, made to be redrawn by hand.
> (`wireframe-sheet.html` is the editable source.) UI inspiration references live in
> [`docs/inspiration/INSPIRATION.md`](inspiration/INSPIRATION.md).
>
> 🧩 **Built in Figma (2026-06-19):** low-fidelity wireframes for the screens below now live in the
> Figma file under the **"WIREFRAMES — MOLDABLE"** section — Main workspace (from the hand sketch),
> Empty state, Project library, Settings, First-run key card, Image input [P2], Engine toggle [P2].
>
> **Desktop-first.** The split view assumes a laptop/desktop screen; mobile is out of scope for
> now (3D modeling on a phone isn't the use case).

---

## App flow & design principles (decided 2026-06-12)

**Apple-simple. There is no home page and no login.**

```
Open app ──► API key saved? ──► YES ──► Main Workspace (empty canvas + one centered prompt)
                    │
                    NO ──► one minimal key card (one field · one button · privacy line) ──► Workspace
```

- **The workspace IS the front door.** Like Apple Freeform or Notes: open the app, you're on the
  canvas. The empty state shows one centered question — *"What do you want to make?"* — with a
  single input and three quiet suggestion chips. (Pattern proven by Visual Electric and Manus —
  see `docs/inspiration/INSPIRATION.md`.)
- **No accounts exist.** Local-first means there is nothing to log into. The only first-run gate
  is the API-key card, shown exactly once.
- **One primary action per screen.** Workspace → **Export**. Key card → **Continue**. Everything
  else (Library, Settings, Code tab) is a quiet icon or hidden until relevant.
- **Export is a menu, not a button:** **STL** (print) · **STEP** (open & edit in Shapr3D) ·
  **OBJ**. STL/OBJ open in Shapr3D as reference meshes only — STEP is the editable one.
- A marketing/landing page is out of scope unless the app is ever published publicly.

---

## The big picture — app map

```
┌────────────────────────────────────────────────────────────┐
│  App Shell (top bar: logo · project name · Settings · New)  │
├──────────────────────┬─────────────────────────────────────┤
│                      │                                     │
│   Chat panel  [P1]   │      3D Viewer panel  [P1]          │
│   (left, ~40%)       │      (right, ~60%)                  │
│                      │                                     │
│                      │   [ Code / Mesh tab ]  [P1/P2]      │
├──────────────────────┴─────────────────────────────────────┤
│  Status / action bar: engine badge · export STL · errors    │
└────────────────────────────────────────────────────────────┘
```

The **main workspace is a two-pane split**: conversation on the left, live 3D model on the right.
Everything else (settings, library, onboarding) is a secondary screen or modal.

---

## 1. Main workspace — split view **[P1]**

The screen you'll live in. Sketch it as two side-by-side panes under a thin top bar.

### 1a. Top bar
- App name / logo (small).
- **Current project name** (click to rename).
- **New** button (start a fresh design).
- **Library** button (open saved projects).
- **Settings** (gear) — opens API keys & preferences.
- Engine indicator/badge: shows "Parametric" or "Organic" (Phase 2). In P1 it's always Parametric.

### 1b. Chat panel (left)
- **Message history**: alternating user + assistant bubbles.
  - Assistant messages can include short explanations ("I made a 60×40 mm bracket with two 4 mm
    holes…") — keep the raw code out of the bubble; it lives in the Code tab.
  - Show a small **"updated the model"** chip on messages that changed the geometry.
- **Input box** at the bottom: multi-line text field + Send button.
- **Suggestion chips** under the input for first-time/empty state, e.g.
  *"a phone stand"*, *"a 22 mm broom-handle wall mount"*, *"a box with a lid 80×50×30 mm"*.
- **Image upload button** (paperclip) — present but **disabled with a "coming soon" tooltip** in
  P1; becomes active in P2.
- **Generating** state: streaming text + a spinner/skeleton in the viewer.

### 1c. 3D Viewer panel (right)
- **3D canvas** showing the current model. Orbit (drag to rotate), zoom (scroll), pan.
- **Viewer toolbar** (small icons, corner of canvas):
  - Reset view / fit-to-screen.
  - Toggle grid / print-bed outline.
  - Toggle wireframe vs solid.
  - Measurement / show bounding-box dimensions (W × D × H in mm).
- **Empty state**: a friendly placeholder ("Describe something to get started").
- **Error state**: if the code fails to compile, show a clear inline message with a
  **"Fix it for me" button** (triggers the self-healing loop from PLAN.md §5) — never a blank
  screen or raw stack trace.
- **Version history**: each "updated the model" chip in chat doubles as a **"restore this
  version"** affordance (hover → restore). Iterations sometimes make things worse; going back
  must be one click.

### 1d. Code / Mesh tab (within or beside the viewer)
- **[P1] Code tab**: shows the **replicad (JavaScript CAD) code**. Read-only by default with an "Edit" toggle.
  - "Copy code" and "Re-run" buttons.
  - When the user edits and re-runs, the viewer updates.
- **[P2] Mesh tab**: for generative results — shows mesh stats (triangle count, watertight?,
  min wall thickness) instead of code.

### 1e. Status / action bar (bottom)
- **Export ▾** menu (primary action): **STL** (print) · **STEP** (edit in Shapr3D) · **OBJ**.
- **Model dimensions** readout (W × D × H mm) and whether it fits a typical bed (with a setting
  for bed size).
- **Engine badge** + which AI model is in use.
- Inline **error/warning** messages (e.g., "wall thinner than 1.2 mm — may be fragile").

---

## 2. Settings screen / modal **[P1]**

Where the user pastes keys and sets preferences. Can be a modal or a side drawer.

- **AI provider keys** section:
  - Anthropic (Claude) API key field — masked input, "Save", "Test connection".
  - **[P2]** Mesh provider key field(s) (Meshy/Tripo/etc.).
  - Clear note: *"Keys are stored only in your browser and never sent anywhere except the provider."*
- **Model picker**: which Claude model to use (default to the latest capable one).
- **Printer / output defaults**:
  - Units (mm).
  - Print-bed size (so the app can warn if a model won't fit).
  - Default minimum wall thickness for warnings.
  - Printer type (FDM selected by default).
- **Danger zone**: clear stored keys, clear local project history.

---

## 3. First-run key card **[P1]** — *not* a home page, *not* a login

Shown only when no API key is saved; never again after. Keep it to **one card**:

- One sentence on what the app does. One masked key field. One **Continue** button.
- One small privacy line: *"No account. Your key stays on this device."*
- Optional quiet link: "Try an example first" (loads a canned design, zero API spend).
- That's it — resist adding tours, carousels, or feature lists. The app teaches itself via the
  empty-state prompt and suggestion chips.

---

## 4. Project library **[P1 lightweight, P3 polish]**

Manage saved designs (stored locally).

- **Grid of saved projects**: thumbnail (rendered preview), name, date, engine type.
- Each card: open, rename, duplicate, delete, **export (STL · STEP · OBJ)**.
- "New project" tile.
- (P3) Search/filter by name or tag.

---

## 5. Image/sketch input flow **[P2+]**

Activated when image upload goes live.

- **Upload/drag-drop area** (from the chat paperclip).
- Preview of the uploaded photo/sketch with the user's text prompt alongside
  ("make it ~10 cm tall, hollow").
- Engine auto-switches to **Organic/generative**; show the engine badge change.
- Progress UI for the (slower) mesh generation.
- Result lands in the same 3D viewer; Mesh tab shows printability stats.

---

## 6. Engine routing / mode toggle **[P2+]**

- A small **toggle or segmented control** near the input: **Precise part ▸ Auto ▸ Organic shape**.
- "Auto" lets the app decide; the others force an engine.
- Tooltip explaining when to use each.

---

## Sketching checklist (do these in order)

1. **[P1]** Main workspace split view (§1) — this is 80% of the app. Sketch all sub-parts.
2. **[P1]** Settings modal (§2).
3. **[P1]** Onboarding / empty state (§3).
4. **[P1]** Library grid (§4) — can be simple at first.
5. **[P2+]** Image input flow (§5) and engine toggle (§6) — rough sketches are fine for now.

When these are sketched and we agree on layout & content, the next step is building the
**Phase 1 Parametric MVP** scaffold from `docs/PLAN.md` §6.
