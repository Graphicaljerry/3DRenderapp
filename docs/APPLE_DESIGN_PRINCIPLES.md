# If Apple built this app

Design and UX principles Apple would bring to Moldable, grounded in the actual
codebase rather than in general advice.

**How this was produced.** Six research lenses (HIG foundations; how Apple builds
inspectors in Final Cut / Logic / Motion / iWork; defaults and progressive
disclosure; direct manipulation and 3D; the measurable craft system; and what
Apple would cut), each researched against Apple's own sources, then applied to
this repository by an agent that read the code. Every recommendation then passed
two independent critics — one rejecting generic UX advice and anything the app
already does, one fact-checking the Apple claim against Apple's sources. 46 of 72
recommendations survived both; 26 were cut.

**Read the citations sceptically anyway.** Line numbers were accurate at the time
of writing and drift with edits.

---

# If Apple built this app

## The organizing idea

Apple would not ship Moldable as *an AI CAD tool*. It would ship it as **a machine that turns a sentence into a thing you can print** — and then delete, hide, or rename every surface that exists to prove that a machine is doing it.

That single reframe decides almost every open question in this codebase. The Source panel, the engine pill, the `Thought process` disclosure, the triangle count, the five decisions stacked above the composer, the word "AI" in twenty-odd strings — all of them are the app narrating its own implementation. Meanwhile the one thing that actually distinguishes Moldable from every chat-to-mesh toy — *does this fit my bed, is it watertight, will it need supports, is that 40 mm a number I said or a number the model invented* — lives one click down inside a collapsed dock section.

Apple's move is to invert that ratio: promote print reality into permanent chrome, demote the machinery to an Advanced toggle and a file format, and make every control that is on screen actually do something.

---

## 1. Decide instead of asking

### The default is the product. A control that collects an answer and discards it is worse than no control.

**Apple precedent.** HIG › Settings: *"Avoid using settings to ask for setup information you can get in other ways"* and *"Minimize the number of settings you offer."* Final Cut Pro sets project format, frame size and frame rate from the first clip you drop in — inferred from an action you were taking anyway, then shown and revisable in the inspector.

**Today.** `FitControl` renders on every precise build (`Workspace.tsx:1926`, gated only on `p.mode === "precise"`), but `App.tsx:3126` reads `const fitLine = guided ? fitDirective(fit) : ""`. Outside the fix-a-broken-part flow the chosen fit never reaches the prompt. The only other path, `applyFit` (`App.tsx:2719-2725`), returns early unless a parameter literally named `clearance` exists. Clicking Loose/Snug/Press changes a mm readout and nothing else. This is the single highest-value differentiator in the product wired to a no-op in the common case.

**Change.** `App.tsx:3126` → `const fitLine = fitDirective(fit);`, unconditionally. Then move `FitControl` out of the resting composer and surface the *result* instead: when a build produces a `clearance` parameter, show `Fit: Snug · 0.2 mm` as a live-scrubbable row in `ParamsPanel`. Correct default applied silently → one-click adjustment in a disclosure → parametric depth in the Inspector. That is the Photos `Auto → Options → Option-key` ladder exactly.

### Five decisions before the first word typed

**Apple precedent.** HIG › Design principles › Simplicity: *"Include just what's necessary… keeps the important things close by and lets the others fall away."* HIG › Layout: *"Take advantage of progressive disclosure… display parts of items to hint that people can reveal additional content."* Note the second half — Apple's named failure mode is content hidden with *no affordance that more exists*.

**Today.** `.modebar-row` (`Workspace.tsx:1900-1930`) presents the Auto|Precise|Generative `seg`, `BrainPicker`/`EnginePicker`, a tri-state web toggle, `FitControl`, and the `.texchip` colour toggle — five engine decisions before anything is on the canvas. The app already knows good answers to all five: `ORGANIC_RE`/`CADISH_RE` auto-route at `App.tsx:119-127`, web already defaults to `auto`.

**Change.** Keep only the three-way `seg` at rest. Collapse the rest behind one `.modebar-more` disclosure whose **label is the resolved summary** — `Claude · web auto · snug fit` — so the hidden state is signalled, not merely hidden.

### Infer from the action, but say what you inferred

**Apple precedent.** Final Cut's first-clip rule works because the inferred configuration is then visible and revisable in the project inspector, with documented per-clip overrides (Spatial Conform, Rate Conform). Inference without a visible result is not the Final Cut pattern — it is a surprise.

**Today.** `App.tsx:1447`: `if (!guided && (mode !== "precise" || !ready)) setMode("generative");` inside `pickImage`. Attaching a photo silently reassigns the engine. The only feedback is a `.modehint` line that renders in some branches, plus the `seg` quietly repainting.

**Change.** Keep the inference. Set a `modeInferred` flag alongside it and render a persistent chip in the existing `.imgchip` row: *"Building as an AI mesh from this photo"* with a trailing `.link` *"Use Precise (CAD) instead."* Clear it in `clearImage` (`App.tsx:1449`). The explanation attaches to the thing that caused it.

---

## 2. Never state a result you did not check

### No printer named → no bed-fit verdict. Not a softened one. None.

**Apple precedent.** HIG › Machine learning › Confidence: *"When you know that confidence values correspond to result quality, you generally want to avoid showing results when confidence is low."* Apple Style Guide forbids labels whose referent is ambiguous.

**Today.** `DEFAULT_PRINTER` (`src/print/printability.ts:41-45`) is a nameless `{ bed: { x: 256, y: 256, z: 256 }, … }` the user never chose. `ExportPanel` still renders `<Check ok={fits} label="Fits your bed" …>` (`Workspace.tsx:970`), `PrintabilityPanel` renders `Fits the bed` (`3187`), and `blocked = r != null && (fits === false || tight === false)` (`946`) **gates export on that unverified check**. The `bedchip` already knows better — it falls back to `p.printer.name ?? "generic"` in its tooltip (`2678`).

**Change.** Thread `printerNamed = p.printer.name != null`. When false, both panels replace the fit row with an actionable prompt — *"Which printer? Pick yours to check the fit"* — and `fits` drops out of `blocked` entirely. Watertightness is genuinely computed, so it alone may gate. `PathToPrint` must not report "Print Ready" against an unverified bed.

### Generated dimensions are assumptions, and assumptions get named

**Apple precedent.** HIG › Generative AI › Inputs: *"Avoid using AI-generated content in situations where a possible hallucination could misinform and harm someone."* When notification summaries produced false headlines, Apple **disabled** the feature for News in the iOS 18.3 beta rather than adding a warning label; it returned ~18 months later carrying four stacked mitigations.

**Today.** The entire mitigation is one line of fine print on a screen the user leaves: `<p className="launch-fine">Sizes are AI-generated. Check the fit before a long print.</p>` (`App.tsx:4747`). In the workspace the statusbar renders `<span className="dims">` (`Workspace.tsx:2675`) as a plain confident measurement. `grep -rn provenance src/` returns zero.

**Change.** Add `origin: "stated" | "assumed"` to the parameter records built beside `cadDefaults`, populated in `send()` by matching each default against numeric literals in the user's prompt (the `CADISH_RE` number group already scans that string). Render it twice: an `.assumed-row` list on the post-build assistant message with inline editable mm fields and one *"These are right"* confirm; and an `assumed` marker on those rows in `ParamsPanel`. Until confirmed, the statusbar prefixes `≈`. Then the fine print can say something true: *"Sizes come from your description; the app marks the ones it guessed."*

### Translate statistics into verdicts

**Apple precedent.** HIG › Machine learning › Attribution: *"In most situations, using percentages, statistics, and other technical jargon doesn't help people assess the results you provide."* Confidence: *"translate confidence values into concepts that people already understand… express it in terms of actionable suggestions"* — Apple's worked example replaces a percentage with *"This is a good time to buy."*

**Today.** `PrintabilityPanel` (`Workspace.tsx:3185-3192`) is a table of raw numbers: `3 open edge(s)`, `148,231` triangles, `62.4 cm³`, `Overhangs > 45° · 12% of faces`. The actionable buttons sit *below* the numbers rather than replacing them.

**Change.** Rewrite the six `row()` calls as verdict + inline action. `Watertight / manifold` → **Sealed** / *"3 gaps in the surface — Fix it"* with `onRepair` inlined. `Overhangs > 45° · 12%` → **Supports** / *"Needs supports under the arms — Show me where"* (the heatmap becomes the drill-down, not a peer button). Triangle count and approximate volume move behind the Advanced flag; nothing a non-CAD user decides depends on them. Keep the one genuinely actionable number: the bounding box in mm.

### Narrate the build in plain language, not in tokens

**Apple precedent.** HIG › Generative AI › Outputs (8 June 2026): *"instead of 'Processing…', say 'Finding substitutions for ingredients' or 'Summarizing key themes from your notes.'"*

**Today.** `GenTimer` (`Workspace.tsx:3139-3153`) renders a spinner and `generating · 12s` — a vague status plus a stopwatch, the two things the HIG names. Beside it, raw reasoning tokens stream into `.think-live` under the heading `Thinking`, then file under `<details><summary>Thought process</summary>`.

**Change.** Require a `PLAN:` block of 2-5 imperative lines before the ```js fence in `REPLICAD_SYSTEM_PROMPT` (`src/llm/prompts.ts`), each naming an operation and its numbers — *"Cutting two M4 clearance holes 40 mm apart"*. Parse them in `send()` where reasoning is already split off, emit as `steps: string[]`, render as a `.build-steps` list in `MessageRow` with the current step spinning. `GenTimer`'s label becomes the current step. A beginner can catch a misread sentence there; `const gusset = draw()` they cannot.

### Plain language, held consistently

**Apple precedent.** Apple Style Guide, *Apple Intelligence*: *"Don't abbreviate as AI."* Apple's feature names — Clean Up, Genmoji, Image Playground, Writing Tools — name an outcome or a place, never a mechanism.

**Today.** The Settings tab is literally `"AI brain"` (`App.tsx:5101`); the preview bar says `AI change ready` (`Workspace.tsx:2198`); four direct-manipulation labels say `— free, no AI`; the mode button says `Generative (AI mesh)` (`1907`); the revert tooltip says `Revert to the AI's ${def}` (`3624`). Separately, the topbar pill names a third-party library — `Engine · replicad` (`1661`) — and the de-jargoning is *half* applied: the buttons say `Round` and `Bevel` (`3446`) while the placeholder beside them says *"add a 2 mm fillet · chamfer this edge 1 mm"* (`2646`, `2648`).

**Change.** One vocabulary list, enforced by a CI grep. `AI brain` → **Building**; `AI change ready — this is a preview` → **Change ready — preview**; `Ask AI to change this` → **Describe the change**; `— free, no AI` → **— instant, no build**; `Generative (AI mesh)` → **Sculpted**; `Engine · replicad` / `primitive` → **Precise (CAD)** / **Simple shapes**; `CodePanel`'s label → **Model code (JavaScript)** / **Shape spec (JSON)**. Rewrite the two Selection placeholders to name the buttons the user can actually see: *"e.g. round this edge 2 mm · bevel it 1 mm."*

---

## 3. Modelessness and escape

### A flow you can only enter once is a mode

**Apple precedent.** HIG › Design principles › Agency: *"Let them move through your interface and access features without being locked into specific flows or modes… When a guided flow is necessary, make it easy to skip or escape."*

**Today.** `startGuided()` (`App.tsx:2704`) appends an assistant message. That makes `messages.length > 0`, which unmounts the block gated at `Workspace.tsx:2985` — which contains the `.guided-cta` at `2990` that is the *only* in-workspace door to the flow. One message of any kind and the app's sharpest differentiator is reachable only via `goHome()`, abandoning the open part. The identical defect class was diagnosed and fixed for the OAuth greeting at `App.tsx:1251-1273` by moving it to a `.banner`; the remedy was never applied here.

**Change.** Add a permanent item to the composer's paperclip attach menu — *"Fix a broken part — photo in, replacement out"* — calling `p.onStartGuided`. Keep the big card in the empty state as the loud first-run version. Un-gate `startGuided` so it is callable with a model already open.

### Escape peels exactly one layer

**Apple precedent.** HIG › Modality: *"A modal experience takes people out of their current context and requires an action to dismiss."* A missing Escape is a modality defect, not a nicety.

**Today.** No modal closes on Escape. Five `<div className="overlay" onClick={onClose}>` roots (`App.tsx:5091`, `LibraryModal.tsx:106`, `TemplatesModal.tsx:24`, `MeasureModal.tsx:86`, `ExtrudeModal.tsx:45`) with no key handler. The global branch at `App.tsx:3508` calls `dismissOverlays()`, which touches tool state only — never `showSettings`, `showLibrary`, `showTemplates`, `showMeasure`, `svgDraft`, `markMode`, `showHelp` or `dockOpen`. Meanwhile `HelpSheet` promises the opposite: *"Esc… closes any open panel"* (`Workspace.tsx:1155`).

**Change.** Make `App.tsx:3508` an explicit top-down stack — modal (`svgDraft` → `showMeasure` → `showTemplates` → `showLibrary` → `showSettings`) → transient (`markMode`, `aiPreview`) → tool state — returning after the first hit. Remove the `if (typing) return` early-out for Escape specifically; Escape from a focused textarea inside Settings must still close Settings.

### Transient views dismiss the same way everywhere

**Apple precedent.** HIG › Popovers ("a transient view") and Design principles › Familiarity. Also Accessibility › Mobility — `onMouseLeave` has no touch equivalent.

**Today.** The comment at `Workspace.tsx:67-71` declares *"Only ONE popup open at a time, anywhere in the app."* `SnapMenu` (`713-714`) and `ResizeMenu` (`748-749`) honour it with `useSoloMenu` + `useOutsideClose`. `MaterialMenu` (`634-635`) and `SurfaceMenu` (`665-666`) use a bare `useState` — they stack on each other and close only by re-clicking their own trigger. The profile menu (`1829`) dismisses on `onMouseLeave` **only**, on a product whose CSS explicitly accommodates iPad (`styles.css:85-89`).

**Change.** Four lines per component: a `box` ref, `useSoloMenu(open, …)`, `useOutsideClose(box, open, …)` — which also grants Escape for free (`Workspace.tsx:78`). Delete the `onMouseLeave` on the profile menu and wrap it the same way.

### Settings must not eat a typed key

**Apple precedent.** HIG › Design principles › Responsibility, *"Act in people's best interest"*, read with Modality's *"requires an action to dismiss."* A backdrop click is not an explicit decision.

**Today.** Theme, tint, units, dimensions mode, plate colour and grid opacity commit on change (`App.tsx:5112`, `5136`). API keys, printer geometry and engine selection commit only inside `saveAll` (`5080-5088`). The backdrop is `onClick={onClose}` with no dirty check (`5091`). Paste an Anthropic key, click beside the card, lose it — having just watched other settings in the same card apply live.

**Change.** Unify, don't warn. Commit the deferred fields on blur the way theme and units commit on change, reducing `Save all` to a no-op. If key validation makes that undesirable, track `dirty` and gate the backdrop: `onClick={dirty ? undefined : onClose}`, footer relabelled `Discard changes` / `Save`.

### Undo must say which stack it is about to pop, and show the result

**Apple precedent.** HIG › Undo and redo: *"Show the results of an undo or redo. If the affected content has scrolled offscreen, scroll it back into view"* — otherwise people *"think that the action had no effect"* and repeat it. Plus labelled items: *Undo Typing*, *Redo Bold*.

**Today.** `App.tsx:3464-3468`: `if (undoPaint()) return; if (separatedRef.current) regroupParts(); else void stepHead(-1);` — three stacks, one keystroke, one `canUndo` flag (`3432`), no label. The "Regroup parts" tooltip concedes the overlap in prose: *"(same as Undo while parts are separated)"* (`Workspace.tsx:1697`). And `stepHead` rebuilds silently — undo a 2 mm fillet on the far side of the part and nothing on screen changes.

**Change.** (1) Compute the label from whichever stack will fire — `Undo paint stroke` / `Undo separate parts` / `Undo "${summary}"` — into the button's `title`/`aria-label` and a 2 s canvas toast. (2) After `await rebuildHead(next)`, diff the new bbox and call `viewer.current?.resetView()` if the changed region is outside the frustum. The imperative handle already exposes it.

### Alerts get verbs, not OK

**Apple precedent.** HIG › Alerts: *"A specific button title like 'Erase,' 'Convert,' 'Clear,' or 'Delete' helps people understand the action they're taking."* HIG › Modality: *"avoid creating a modal experience that feels like an app within your app."*

**Today.** `LibraryModal` — itself a full-screen custom modal — opens four native dialogs: `prompt("New folder name:")` (`:58`, `:93`) and `confirm(…)` (`:83`, `:246`). Untitled, unthemed, thread-blocking, and their action button is literally labelled **OK**.

**Change.** Split by reversibility. Naming a folder is not destructive — replace both `prompt()` calls with an inline `<input>` using the existing `EditableName` pattern (`Workspace.tsx:465`). Project deletion *is* unrecoverable, so keep a confirmation but render it in-app with buttons titled **Delete** and **Cancel**, Cancel focused, Delete styled with the `.ghost.sm.danger` class already at `LibraryModal.tsx:245`.

---

## 4. The Inspector is one live projection of the selection

### Sections are multi-open; only tabs are one-at-a-time

**Apple precedent.** iWork's three levels: inspector mode and tab are strictly exclusive, but named sections behind disclosure arrows are multi-open — Fill, Border and Shadow all expandable at once (Keynote guide, *Add a border to a slide*). Motion's Properties Inspector keeps Transform, Blending and Drop Shadow open simultaneously.

**Today.** The dock was refactored into a real accordion (`.dock-section`/`.dock-caret`/`aria-expanded`, `Workspace.tsx:2618-2637`) but kept single-select: `const open = dockPanel === key` (`2620`). Seven disclosure carets that behave as radio buttons. Worse, the pick effect at `1597` force-switches to `selection`, so clicking a face while scrubbing parameters collapses Parameters.

**Change.** `dockPanel` → `openPanels: Set<DockPanel>` persisted as `moldable_dock_open`; header click toggles membership. Give `.dock-section.on.fill` `flex: 1 1 auto` only when it is the sole open `fill` section. Make the four programmatic openers *add* rather than replace. A non-destructive pick effect removes the need for Motion's pin button entirely.

### The inspector is never empty — it retargets to the next-broadest object

**Apple precedent.** Keynote's Format sidebar with nothing selected shows the *slide* (Background, Slide Layout, Allow layering); Apple's help instructs users to deselect on purpose to reach it. Motion keeps a Project object at the top of the Layers list for the same reason.

**Today.** `DockSelection` has a whole-part branch but gates it on `if (modelSelected && dims)` (`Workspace.tsx:1091`), and `modelSelected` is only true after an explicit click. At every cold start — with a fully described model on screen and Selection open by default — the user reads `Click a face, an edge or a corner to see what you can do with it.` (`1109`).

**Change.** Drop the `modelSelected` guard so the whole-part branch renders whenever `dims` exists; demote that sentence to a `.dock-note` footnote. Fill it out from data already on `Props`: Size, Engine, Plate, Filament (`ColorSwatch`), Parts. Reserve `.dock-empty` for `!p.geometry`, where it should read as project scope: *"No model yet — describe one in chat."*

### Selection is bidirectional — including attachments

**Apple precedent.** WWDC23 10161: *"Inspector is the name for views that show further detail of selected content."* Motion: *"Adjustments made in the canvas are simultaneously updated in the Inspector, and vice versa."*

**Today.** Attachments are first-class selectable objects (`selAttachIds`, `App.tsx:391`) but the Inspector does not project them: `picked` (`Workspace.tsx:1596`) excludes them, `DockSelection` has no attachment branch, and the controls that *do* act on them — `Check clearance` / `Cut to fit` / `Drop to plate` — are stranded in `objectsPanel` (`1749-1761`), visible only when Objects is open. So a part sits visibly highlighted on the canvas while the panel named Selection shows an empty state.

**Change.** Add an attachment branch: Name (`EditableName`), Size, Position, Plate for one; *"N parts selected"* plus shared rows for several. Move `.lp-fitrow` into that branch so actions sit with their object; leave Objects as the pure hierarchy list (Apple's Layers-list role). Add `|| p.selAttachIds.length > 0` to `picked`.

### One inspector, not a floating second copy

**Apple precedent.** FCP documents the split per control rather than duplicating surfaces: corner scaling is viewer-only (*"These controls aren't available in the Video inspector"*) while Anchor X/Y is inspector-only (*"This control isn't available in the onscreen controls"*).

**Today.** Whole-part size exists on three surfaces: `SelectionInspector` — a floating card literally headed `Selection` (`Workspace.tsx:848`) with editable W/D/H; the dock's Selection section, which shows the same numbers **read-only** and points elsewhere (`1096`); and `ResizeMenu`'s `Set size…` popover. The trailing sidebar named Selection is the one place you cannot edit the selection's size, and two panels titled "Selection" can be on screen at once.

**Change.** Move `SelectionInspector`'s commit logic (`836-842`) into the dock's whole-part branch as three editable rows and delete the floating card (`2484-2486`). Reduce `ResizeMenu` to what the sidebar cannot do as well — the % field, the uniform lock, `Scale to fit bed` — dropping its duplicated W/D/H fields (`802-807`).

### Numbers are value sliders: drag the number, click to type, no stepper

**Apple precedent.** FCP glossary, verbatim: *"value slider — A type of numerical slider control that appears as a number… by dragging over the number to decrease or increase the parameter value, or by double-clicking the number and entering a new value."* No Apple pro-app inspector uses steppers.

**Today.** Moldable has one excellent value slider and four plain fields — and the good one is wired backwards. In `ParamsPanel` the scrub is bound to the **label** (`.prow-name`, `cursor: ew-resize`, `styles.css:1690-1694`) while the **number** sits behind a `.pf-fill` progress bar that looks draggable and only accepts typing. `DirectOpBar`'s mm field, `HolePanel`'s diameter/depth/X/Y, `ResizeMenu`'s W/D/H and `SelectionInspector`'s W/D/H are raw `<input type="number">` with native spinners. `evalParamInput` and `paramSoftRange` (`cad/params.ts:88`, `:55`) are already generic and used in exactly one place.

**Change.** Extract a shared `<ValueField value step min max unit onCommit />`: 3 px scrub threshold, Shift = 0.25× fine (matching `3559`), tap-with-no-movement focuses and selects, blur runs `evalParamInput`, arrows nudge, `appearance: textfield` kills the spinner. Add the scrub to the number in `ParamsPanel` too, so `.pf-fill` finally means what it looks like. Then replace the four raw inputs — hole diameter and quick-edit mm get expression input for free.

### Available sections are a function of what is selected

**Apple precedent.** FCP guide, verbatim: *"The inspectors that are available depend on the item that's selected. For example, you must select a transition to see the Transition inspector."* Motion renames its fourth tab per selection type (Camera / Text / Shape). Apple removes the affordance rather than showing an apologetic one.

**Today.** `DOCK_ITEMS` is a module constant of seven (`Workspace.tsx:1136-1144`) mapped unconditionally. On a fresh generative mesh, four of seven sections can only apologise: *"Parameter sliders work on Precise (CAD) models…"*, *"No model analysed yet."*, *"Nothing to export yet…"* — dead weight above the fold in a 262 px column.

**Change.** Compute the list at render (params → `activeKind === "replicad" && cadDefaults`; print/export → `!!geometry`; history → `versions.length > 0`), guard the open state so a filtered-out section falls back to selection, and rename Source → "Mesh source" for generative per Motion's context-renaming.

### Deep-link into a sibling instead of restating it

**Apple precedent.** FCP: *"In the Video inspector, click the Color Inspector button next to a color correction effect"* — the Video inspector points at Color rather than duplicating its controls.

**Today.** The same four print facts render three times from one `PrintabilityReport`: floating `MeshStats` (`Workspace.tsx:1212-1224`, `showStats` defaults true), `PrintabilityPanel` (`3187-3192`), and `ExportPanel`'s Check rows (`969-972`) **with its own duplicate copies of the fix buttons** (`976-987`). Three vocabularies for one report: `Watertight` / `Watertight / manifold` / `Fits bed` / `Fits the bed` / `Fits your bed`.

**Change.** One `readinessRows(report, printer, dims)` returning `{key, label, ok, detail}`. Full rows plus fixes live in Printability. `ExportPanel` gets a one-line verdict — *"Ready to print"* / *"2 checks need attention"* — plus a **Review in Printability** button, and otherwise owns only filename, formats, plates, pieces and hand-off. Demote `MeshStats` to the collapsed Printability header's summary line.

### Print reality is chrome, not a destination

**Apple precedent.** HIG › Confidence: *"help people make decisions by conveying confidence in terms of actionable suggestions."* Apple's own pattern is a persistent plain-language state — Battery Health's *Peak Performance Capability*, Screen Time's daily line — with the diagnostic one level down.

**Today.** The statusbar (`Workspace.tsx:2674-2695`) shows raw dims, bed size, a build tag and an abstract `Design ─ Check ─ Print Ready` stepper. Whether the model *fits* or *needs supports* exists only inside two collapsed dock panels.

**Change.** Replace `PathToPrint` with a verdict chip reading `p.report` directly: `78 × 70 × 78 mm · Fits your Bambu P1S · No supports`; `Taller than your plate — rotate or split`; `Needs supports`; `Pick your printer to check the fit`. Tapping it opens Printability as the drill-down. The `dims` span and the `bedchip` merge into one element.

---

## 5. Direct manipulation, bought with fewer degrees of freedom

### One manipulator live at a time

**Apple precedent.** AR HIG › Designing object interactions: *"Limit movement to the two-dimensional surface on which the object rests"*, *"Limit object rotation to a single axis."* Reality Composer Pro is structural about it: *"click a mode (Move, Rotate, or Scale)… and then use the manipulator."* WWDC25 274 exposes `supportedOperations` for the same purpose. Apple never shows six DOF at once.

**Today.** The rail flyout offers Move/Rotate/Scale as if exclusive (`Workspace.tsx:2340-2344`), but `enterTransform` (`Viewer.tsx:3185`) attaches translate arrows **and** rotate rings — `if (mode === "move") s.tcR.attach(pivot);` (`3232`), and unconditionally for attachments (`3214`, comment: *"combined: arrows + rings together"*). `selBox` adds 8 draggable scale anchors on top (`1857`). Seven live handles on one object — which is why the app needs a 40-line raycast arbitration layer (`arbitrate`, `Viewer.tsx:500-535`) whose only job is guessing which gizmo you meant, with a hand-tuned *"translate wins ties within 2 mm of ray depth"* rule.

**Change.** Attach exactly one control per mode. Suppress the `selBox` anchor drag path unless `transformMode === "scale"` (keep the box drawn as chrome). Then delete `arbitrate` / `pickerOf` / `arbTick` / `arbPending` and the `enabled` toggling entirely — the arbitration problem stops existing. Add `G` to cycle modes so the pointer never leaves the object.

### Every manipulator gets a numeric twin and an explicit reset

**Apple precedent.** Keynote User Guide: *"Drag the Rotate button in the center of the object. You can also click the 3D Object tab in the Format sidebar, then use the 3D Rotation controls… Click Reset Rotation to set all the values to zero degrees."* Motion carries *Reset Parameter* on every row.

**Today.** The rotate rings and translate arrows have **no numeric counterpart anywhere and no reset**. `SelectionInspector` is W/D/H only; `ResizeMenu` is scale only. Grepping `rotat` across Workspace.tsx finds tooltips and a Printability suggestion — no field. Attachments are worse: the gizmo writes directly onto the mesh with no parametric commit (`commitTransform` returns early on `!pivot`, `Viewer.tsx:3268`) and their rows in `objectsPanel` show name, swatch, plate and an ×. The gizmo is the only way to place an attachment.

**Change.** Extend `SelectionInspector`'s successor (now the dock's Selection branch) to three groups: Position X/Y/Z, Rotation X/Y/Z, Size W/D/H, each with the per-row revert already built in `ParamsPanel` plus a group-level **Reset rotation**. Route typed values through the existing `onTransformCommit` payload so they take the identical code path as a drag. Mirror the three rows onto attachment rows as an expandable detail.

### The model should look touchable before you touch it

**Apple precedent.** WWDC23 10073: *"All interactive elements should be highlighted, and we do this with a hover effect. But because your eyes move quickly, the effect needs to be subtle."* WWDC25 274: `ManipulationComponent.configureEntity` *"adds a HoverEffectComponent"* by default.

**Today.** With no tool armed — the state of every user when their first model lands — the model is inert to the pointer: the hover handler bails at `Viewer.tsx:1463` (`if (!cb.current.selectMode || !s2.mesh) return;`). Yet clicking it *does* something (`930-937`: *"No tool active → a tap on the part selects the WHOLE model"*). A control that gives zero indication it is one — which is exactly why the discoverability burden lands on a 15-row help sheet.

**Change.** Before the `selectMode` bail, add a no-tool hover branch: raycast `s2.mesh` and `s2.attachMap`, set `cursor: pointer` and a subtle `--accent` rim lift — deliberately weaker than the 0.42-opacity pick overlay, so it reads *"you can touch this"*, not *"this is picked"*. Clear in the existing `onLeave` (`1485`).

### Hover and commitment must look different

**Apple precedent.** HIG › Focus and selection: *"People rely on the focus system to help them know where they are in your app."* WWDC23 10073 frames hover as *"reinforcing intention without being prominent"* — weak and transient; commitment is the strong signal.

**Today.** `showFeature` (`Viewer.tsx:3061`) is the single path for both, called from the hover handler (`1473`) and again on the locked pick (`1480`), driving one `s.highlight` mesh at `0x2563eb, opacity 0.42`. Edges and vertices share one `markMat`. The only cue that a pick committed is the `ContextBar` appearing — a 2D element that is clamped away from the right edge, so on a right-side pick it does not even sit over the feature.

**Change.** Split on the material: `locked` → opacity 0.45 and the brand accent `0x498a6f` (already the `selBox` and `.ctxbar` colour, so *green = committed* becomes one app-wide signal); hover → 0.22 and neutral blue. Add a thin locked-state boundary outline so commitment survives an edge-on view.

### Float controls as ornaments — small, and near their content

**Apple precedent.** HIG › Ornaments: an ornament *"floats in a plane that's parallel to its associated window and slightly in front of it… If the associated window moves, the ornament moves with it."* WWDC23 10072: *"In the immersive cinema, the playback controls are placed small and nearby."*

**Today.** For one and the same picked face the app runs two opposite conventions. `ContextBar` (`Workspace.tsx:880-915`) does it correctly with a rAF projection loop. But the Hole panel — which drives the in-world hole ghost and its alignment guides — is `.pin-panel hole-panel` at `position: absolute; top: 64px; left: calc(10px + var(--rail-w) + 12px)` (`styles.css:1260`), a fixed corner. The Point panel uses the identical slot and prints the pin's own x, y, z as coordinates for a thing elsewhere on screen.

**Change.** Render both through `ContextBar`, anchored at `holeCtl.draft.at` and the pin position, reusing its dock-clamping logic. Give them a `.ctxbar` panel variant with the 45° pointer tail. Collapse the fastener and magnet `<select>`s into one row to keep the ornament small. The shared-slot collision disappears for free.

### Do not let the user get lost — prevent it, then offer recovery

**Apple precedent.** Motion's *Use 3D view tools* ships three always-visible canvas controls — Pan, Orbit, Dolly — plus *"Double-clicking a 3D view tool resets all parameters"* and Reset View at ⌃R. visionOS enforces a ~1.5 m boundary where *"the entire experience begins to fade and passthrough increases"*, restoring on recenter. AR HIG: *"Let people reset the experience if it doesn't meet their expectations."*

**Today.** Of Motion's three, Moldable surfaces two: dolly and orbit. **Pan has no on-screen control at all** — hidden middle/right-drag, which is why `HelpSheet`'s first row has to spell it out (`Workspace.tsx:1149`). And OrbitControls is constructed with no bounds whatsoever (`Viewer.tsx:335-336`) — grep finds no `minDistance`, `maxDistance`, `maxTargetRadius` or pan clamp. Pan the target into empty space and the app renders an empty bed with no cue. The six scattered reset/frame entry points only help someone who already knows the word "frame".

**Change.** (a) Add a pan button to `.zoom-ctl` so pan/orbit/dolly have one persistent home. (b) Bound the controls from the model's bounding sphere (≈0.3× to 12×) and clamp `maxTargetRadius` near the plate. (c) When the projected bounding sphere leaves the viewport for >400 ms, fade in one centred pill: **"Model is off-screen — Frame it"** calling `resetView()`. Recovery that appears when needed, instead of six that are always there and never noticed.

### Prefer a 3D hint in a 3D context

**Apple precedent.** AR HIG › Communicating with people, verbatim: *"In a three-dimensional context, prefer 3D hints. For example, placing a 3D rotation indicator around an object is more intuitive than displaying text-based instructions in a 2D overlay. Avoid displaying textual overlay hints in a 3D context unless people aren't responding to contextual hints."*

**Today.** Every piece of stage onboarding is 2D text, and all of it is gated. The two `.box-hint` pills only appear once a tool is already armed. The whole gesture vocabulary lives in `HelpSheet`'s 15 rows behind an icon-only `<IconHelp />` whose words exist solely as `aria-label` and `title`. Nothing in Viewer.tsx draws an affordance around a freshly built model.

**Change.** On the first model of a session (gate on `moldable_seen_orbit`), draw Apple's literal example: a translucent `--accent` arc arrow orbiting the bounding sphere, one slow revolution, fading on the first orbit drag or after ~4 s. Add a second one-shot hint on the first face pick — a pulsing arrow along the face normal, reusing the existing `pushArrow` group (`Viewer.tsx:392-401`) — so drag-to-extrude teaches itself instead of being HelpSheet row 5. Draw both statically under `prefers-reduced-motion`.

### Alignment guides cover four relationships, transiently

**Apple precedent.** Keynote › Use alignment guides: four independently toggleable classes — *"at object center… at object edges… for relative sizing… for relative spacing"* — appearing only during the drag. RCP pairs a snapping toggle with an explicit, editable Snap Distance.

**Today.** Exactly one relationship exists, and only inside the Hole tool (`layoutHoleGhost`, `Viewer.tsx:2204-2221`). Dragging an attachment produces no centre, edge, equal-spacing or plate-centre feedback — only a numeric grid snap whose own note admits *"Snap-to-object is on the roadmap"* (`Workspace.tsx:737`) and after-the-fact `Check clearance` buttons.

**Change.** A transient layer on `dragging-changed`, disposed on release, covering centre / edge / equal-spacing, rendered as thin `--accent` lines at `renderOrder` 5 matching the existing hole-guide construction, snapping within `snap.move` mm (or ~1 mm proximity when snapping is off — Apple's *proximity means intent*). Add matched-dimension as an `= 24.0 mm` badge. Delete the roadmap note.

---

## 6. Accessibility as specification

### Keyboard camera control — orbit is not optional

**Apple precedent.** HIG › Accessibility › Mobility: *"Offer alternatives to gestures. Make sure your UI's core functionality is accessible through more than one type of physical interaction"*; *"Let people use the keyboard alone to navigate and interact with your app."* Apple publishes no carve-out for pro or creative apps.

**Today.** `new OrbitControls(camera, renderer.domElement)` (`Viewer.tsx:334`) never gets `listenToKeyEvents`. The mount is a bare `<div ref={mount} className="viewerCanvas" />` (`2462`) — no `tabIndex`, no `role`, no `aria-label`; it cannot receive focus. The only keyboard camera control in the entire app is `case "f": viewer.current?.resetView()`. View snaps give four fixed cameras; there is no non-gestural way to orbit to an arbitrary angle — which is what inspecting an overhang requires.

**Change.** `tabIndex={0} role="application" aria-label="3D model view — arrow keys orbit, Shift+arrows pan, +/− zoom"`, a `:focus-visible` ring, and a keydown handler **on that div** (not window, so it never fights the global layer): arrows orbit 5° (1° with Shift, matching the app's Shift-is-fine convention), Shift+arrows pan, `+`/`−` → `zoomBy`, `0` → `resetView`.

### The stage must announce what changed

**Apple precedent.** HIG › VoiceOver (new page, 7 March 2025): *"Examine your app for places where relationships among elements are visual only"*; *"Inform VoiceOver when visible content or layout changes occur."*

**Today.** `grep aria-live` across App.tsx, Workspace.tsx and Viewer.tsx returns **zero**. A build completing, a face being selected, a push-pull committing, an AI preview arriving and an undo rebuilding all happen silently. The picked-feature description exists only as rendered text inside `DockSelection`.

**Change.** One `<div className="sr-only" aria-live="polite" aria-atomic="true">` inside `.viewer-body`, fed by an `announce(text)` helper, called from five events: build completion in `applyResult`, `featureCtl.pick` (reuse the exact string `DockSelection` already composes — *"Top face, planar, 40 × 20 mm"*), `onTransformCommit`/`onPushPull`, `aiPreview.active`, and `stepHead` with the undo label above. Add `.sr-only` to styles.css — there is no visually-hidden utility today.

### Control sizes: 28×28 is the floor, and coarse pointers must not get *smaller*

**Apple precedent.** HIG › Accessibility › Mobility publishes the real table: iOS/iPadOS 44×44 pt **default**, 28×28 pt **minimum**; macOS 28×28 default, 20×20 minimum. Plus *"Consider spacing between controls as important as size."* The 44 pt folklore is why dense pro tools get mis-specced; 28 is the sanctioned floor.

**Today.** No `@media (pointer: coarse)` sizing block exists at all — the only coarse rule in the file is the iOS font-size fix (`styles.css:85-89`). `.zoom-ctl button` is 26×26 with `gap: 2px` (`591`, `590`); `.view-snaps button` computes to ~22 px tall with `gap: 2px` (`517`, `516`); and inside the 680 px container query `.canvas-rail .ghost.sm.iconbtn` shrinks to 30 px at `gap: 0` (`423-424`) — i.e. iPad portrait, fingers, zero separation.

**Change.** One coarse-pointer block raising only the canvas clusters and leaving desktop density alone: zoom buttons 32×32, rail buttons 34 px, `gap: 6px` / `padding: 5px` on `.zoom-ctl, .view-snaps, .plate-bar`, `.view-snaps button { padding: 8px 14px }`.

### Label the rail where hover does not exist

**Apple precedent.** WWDC21 10126 *Discoverable design* rejects the hamburger on exactly this ground: *"when the hamburger menu is closed, people don't know what's inside. The three lines don't convey anything."* HIG › Disclosure controls: *"Provide a descriptive label."*

**Today.** `styles.css:1560`: `.canvas-rail .btn-label { display: none; } /* icon-only rail; titles carry the words */`. The escape hatch is `:hover .rail-name` (`1650`) — a pointer that touch devices do not have. On iPad, Select, Move, Measure, Mark, Paint, Material and Texture are seven unlabelled glyphs, and the Help button that would explain them is itself icon-only.

**Change.** `@media (pointer: coarse) { .canvas-rail { width: auto } .canvas-rail .rail-name { max-width: 110px; opacity: 1; margin-left: 8px } }` plus a visible "Help" label under the same query. Keep hover-expand on fine pointers — that is the correct density trade there.

### Text size: build the custom control, because macOS has no Dynamic Type

**Apple precedent.** HIG › Accessibility › Vision: *"give people the option to enlarge text by at least 200 percent… either through custom UI, or by adopting Dynamic Type."* HIG › Typography › macOS: *"macOS doesn't support Dynamic Type."* The *"either through custom UI"* clause is explicit permission to build your own — which is the only option on web.

**Today.** Every size is a px literal (10 → 20 px, 17 distinct values); `grep -c rem styles.css` returns 4. `html { -webkit-text-size-adjust: 100% }` (`:73`) additionally pins iOS. Settings › Appearance offers theme, tint, units, dimensions mode, plate colour, grid opacity — no text size. A user who needs 150% text has no path at all.

**Change.** A `--ui-scale` variable set from a Small/Default/Large/Larger segmented control (1.0 / 1.125 / 1.25 / 1.5) in Appearance, persisted as `moldable_ui_scale`, applied by a pre-paint script the way `data-theme` already is; `html { font-size: calc(100% * var(--ui-scale, 1)) }` with a `--fs-*` rem ramp. Start with the reading-load surfaces: `.bubble`, `.composer textarea`, `.dock-*`, `.prow`/`.pnum`. Then test at 150% — `.topbar`'s hard 58 px and the composer's 40-132 px clamp both need `min-height`.

### Contrast is a size-banded floor with a published fallback

**Apple precedent.** HIG › Accessibility › Vision publishes the table Accessibility Inspector enforces (Up to 17 pt / All weights / 4.5:1), plus the fallback: *"If your app doesn't provide this minimum contrast by default, ensure it at least provides a higher contrast color scheme when the system setting Increase Contrast is turned on."* HIG › Dark Mode raises the goal for custom colours to 7:1, *"especially in small text."*

**Today.** `--subt` fails AA in both themes — light `#9aa0a8` on `--bg` ≈ **2.6:1**, dark `#666769` on `#1c1c1e` ≈ **3.0:1** — and it is used 61 times, almost always on the *smallest* type: `.msg-model` 10.5 px, `.ins-unit` 10.5 px, `.lp-group` 10 px, `.build-tag` 10 px, `.modehint` 11 px. Several compound it with `opacity: .6`. `grep prefers-contrast` across the whole `src/` returns zero, as do `forced-colors` and `prefers-reduced-transparency`.

**Change.** Retune the bottom two rungs to clear the floor — light `--subt: #6e747c`, `--mut: #5f6672`; dark `--subt: #8a8b8e` — keeping the four-rung hierarchy intact. Add a `@media (prefers-contrast: more)` block after the dark `:root`. Drop the `opacity: .6` multipliers on `.lib-thumb-empty` / `.tpl-thumb-empty`; opacity on text is not recoverable by an Increase Contrast override.

### The diff overlay must not be red/green alone

**Apple precedent.** HIG › Accessibility › Vision: *"Convey information with more than color alone… Offer visual indicators, like distinct shapes or icons, in addition to color."*

**Today.** The one signal telling a user what an AI turn changed before Apply or Discard is pure red/green: `Viewer.tsx:2134-2135`, `mk(diff.added, 0x22c55e)` / `mk(diff.removed, 0xef4444)`, mirrored in `.apb-add` / `.apb-rem`. The legend pairs swatches with words — but the decision is made looking at the *model*, where hue is the only channel.

**Change.** Switch removed to the app's own attention token `--live` `#ff6a2c` — green/orange separates under all three common dichromacies and the token already exists — and render the removed shell as wireframe or stipple so *form* distinguishes it too. Put a `+`/`−` glyph inside the legend swatches.

### Reduce Motion is five named substitutions, not a kill switch

**Apple precedent.** HIG › Accessibility › Cognitive names the tactics: *"reducing automatic and repetitive animations, including zooming, scaling, and peripheral motion"*, *"Tightening animation springs"*, *"Replacing transitions in x-, y-, and z-axes with fades to avoid motion."*

**Today.** Eleven hand-maintained opt-out blocks, no global guard — so the list has already failed: `@keyframes boot-splash-pulse` (`styles.css:1481-1484`) is an infinite opacity + `scale(1.06)` loop, the literal example in Apple's sentence, appearing in no reduce-motion block. And the two panel entrances that *are* guarded are killed outright rather than replaced with the fade Apple prescribes.

**Change.** One global `@media (prefers-reduced-motion: reduce)` guard at the top of styles.css zeroing all durations, then re-author the transitions worth keeping as fades under the same query: `@keyframes panel-fade { from { opacity: 0 } }` on the two docks, replacing translateX. Delete the eleven per-rule blocks so the list can no longer be forgotten.

---

## 7. Craft: use the token, not the value

### Tracking is a published curve, not a constant

**Apple precedent.** HIG › Typography › Tracking values publishes the full table: **+26/1000em at 8 pt, +12 at 10 pt, 0 at 12 pt, −26 at 17 pt, −12 at 22 pt, +3 at 24 pt**. WWDC20 10175: *"you'll need to apply a new set of tracking values between 17 and 28 points."*

**Today.** `styles.css:188` applies one `letter-spacing: -0.01em` to a selector list spanning 13 px to 20 px — one value across the steepest part of the curve. Worse, `.wordmark` is `font-size: 17px; letter-spacing: 0.2px` (`:217`) — **+0.012em at exactly the tightest point on Apple's curve (−0.026em)**, i.e. ~0.038em looser than reference. Meanwhile the 9-10.5 px microcopy, where Apple calls for +0.012 to +0.026em, carries none at all.

**Change.** Band it: `--track-micro: 0.02em` (9 px), `--track-small: 0.008em` (10-10.5 px), `--track-body: 0` (11-12.5 px, where the curve crosses), `--track-tight: -0.02em` (17-20 px), `--track-display: -0.032em` (`.launch-h1`, already correct). Split `styles.css:188` so it assigns only `font-family`. Schibsted Grotesk ships as three static weights from Google Fonts with no `opsz` axis, so hand-banded tracking is the only route here — switching the link to `wght@400..700` would at least let weight interpolate.

### The viewport runs a second, hard-coded palette

**Apple precedent.** HIG › Color, verbatim: *"Avoid hard-coding system color values in your app"*; *"Each dynamic color is semantically defined by its purpose, rather than its appearance or color values."* HIG › Dark Mode: dark colours *"aren't necessarily inversions of their light counterparts."*

**Today.** The chrome is disciplined — 61 uses of `var(--subt)`, `--ctl` as a `color-mix` wash. But the **primary content surface** ignores the theme almost entirely. `theme` is used in Viewer.tsx for exactly two things: the build plate (`:173`) and the scene background (`:2043`). Every label is a literal: measurement chips are `{ fg: "#0f766e", bg: "rgba(255,255,255,0.94)", border: "#0d9488" }` (`:1306`, `:1892`); pin labels are `#2563eb` / `#dbeafe` (`:2094-2097`); meshes are `#c7ccd3`, `#b9bec3`, `#7fc4b9`. None of those hues exist in the app palette. In dark mode the user gets near-black chrome, a `#17181a` scene, and **white chips with Tailwind-default blue and teal text** floating over the model.

**Change.** A `SCENE_COLORS` map beside `THEME_SCENE` with light/dark entries for the four label roles the code actually has (`measure`, `pin`, `pinActive`, `dim`), derived from the app tokens via `getComputedStyle(document.documentElement).getPropertyValue('--accent-d')` so one palette drives chrome and scene. Same for the three mesh greys. Because labels are baked into `THREE.CanvasTexture`, add `theme` to the effect that builds them so they re-bake on toggle.

### One icon system, weight-matched and size-relative

**Apple precedent.** HIG › SF Symbols: *"Each of the nine symbol weights… corresponds to a weight of the San Francisco system font, helping you achieve precise weight matching between symbols and adjacent text"*, and *"The scales are defined relative to the cap height of the San Francisco system font."*

**Today.** `icons.tsx:1-2` states the rule — *"24px grid, 1.8px stroke, currentColor… no emojis"* — and then breaks it six ways: strokes of 1.6/1.8/2/2.2/2.4/2.6 and render sizes of 13/16/17/18/20, so `IconPaperclip` (16 px @ 2.0) and `IconUser` (20 px @ 1.8) sit in the same composer row beside 12.5 px text at different optical weights. The no-emoji claim is not held either: `🎨`/`⬜` at `Workspace.tsx:1962`, `⚠️` at `:3258`, plus `✓`/`▲`/`▾`/`−`/`└`/`⌀` standing in for icons. The theme toggle is two different controls — a text glyph on the Launchpad (`App.tsx:4705`), an SVG cross-fade in the Workspace.

**Change.** `base` → `width="1em" height="1em"` on a 24 viewBox so every icon inherits size from adjacent text (the cap-height rule), plus `.ico-s`/`.ico-l` scale classes. Remove all six per-icon stroke overrides and expose weight as a prop mapping to three steps (1.8 / 2.1 / 2.4). Replace the emoji and glyph stand-ins with set members, and make the theme toggle one control.

---

## What Apple would cut

**The Source panel.** `DOCK_ITEMS` ships `{ key: "code", label: "Source", fill: true }` as a peer of Selection. Apple has never shown a consumer the code it wrote for them — App Store Review Guideline 2.5.2 carves out source-code visibility only for *"Educational apps designed to teach, develop, or allow students to test executable code."* Clean Up, Genmoji, Image Playground and Writing Tools expose zero intermediate representation. Cut the entry, drop the `fill` flag it forced into the layout, and relocate it behind a `showSource` toggle in Settings › Appearance › Advanced — Safari's Develop menu is the shape. **STEP export is already the Apple-shaped escape hatch**: the model can leave editable without a code panel proving it is real.

**The word "AI", everywhere.** Twelve-plus primary-chrome strings. The Style Guide bans the abbreviation outright.

**Triangle counts and approximate volume.** Nothing a non-CAD user decides depends on them. Behind the same Advanced flag.

**The build tag.** `v{__BUILD_STAMP__}` in both the statusbar and the Launchpad header, with a tooltip explaining display refresh rate and device pixel ratio. Developer diagnostics in consumer chrome.

**The Launchpad's `<details className="adv">` key block** (`App.tsx:4818-4829`). A credentials chore nested inside a credentials chore, every field of which already exists in Settings. The `house` relay should be the unconditional default brain when `houseStatusNow()` passes, so a typed sentence builds with nothing added.

**`Skip`** (`App.tsx:4846`). `() => setEntered(true)` lands on an empty canvas with the placeholder *"Describe a part, or a change…"*. A workspace with nothing in it is not an outcome. Keep one low-commitment exit — *"Look around first"* — that opens the built-in example.

**The floating `MeshStats` card**, and `ExportPanel`'s duplicate check rows and duplicate fix buttons. Three renderings of one report.

**`arbitrate` / `pickerOf` / `arbTick` / `arbPending`** (`Viewer.tsx:495-535`). 40 lines of raycast guessing that exist only because two gizmos are attached at once. Attach one and the problem is gone.

**`tab` state.** `App.tsx:968` initialises it to `"3d"`; `setTab` is threaded into Workspace and **never called**. Fourteen render branches still test it, `TAB_PANEL` (`Workspace.tsx:1138`) is declared and never read, and `Workspace.tsx:2330`/`2358` still disable Mark and Paint with `p.tab !== "3d"`. Dead state gating live UI.

**The always-on `FitControl`.** Not the feature — the placement. Wire it, then move it into the disclosure and surface the result as a parameter row.

---

## Prioritized

| Change | Effort | Impact |
|---|---|---|
| Wire Part fit to every precise build (`App.tsx:3126` → unconditional `fitDirective`) | S | **High** |
| Escape peels one modal layer at a time (`App.tsx:3508` stack) | S | **High** |
| Guided entry moves to the composer attach menu so it never unmounts | S | **High** |
| Inspector is never empty — drop the `modelSelected` guard, show document scope | S | **High** |
| Fix `--subt` contrast in both themes + `prefers-contrast` block | S | **High** |
| Cut the Source section to a Settings › Advanced toggle | S | **High** |
| No bed-fit verdict, and no export gate, until the printer is named | M | **High** |
| Print verdict chip replaces the abstract stepper in the statusbar | M | **High** |
| Multi-open Inspector sections (`openPanels: Set`) | M | **High** |
| Attachments project into the Inspector; move `.lp-fitrow` with them | M | **High** |
| Collapse four composer decisions behind one summary-labelled disclosure | M | **High** |
| Photo-attach mode switch becomes visible and one-click revertible | S | **High** |
| Keyboard camera control on a focusable viewport | M | **High** |
| No-tool hover highlight on the model | S | **High** |
| One manipulator per mode; delete `arbitrate` | M | **High** |
| Position/Rotation/Size numeric twins + Reset rotation | M | **High** |
| Camera bounds + "Model is off-screen — Frame it" | M | **High** |
| Dock's Selection becomes the editable size surface; delete the floating card | M | **High** |
| Plain-language `PLAN:` build narration replaces `generating · 12s` | M | **High** |
| Viewer palette derives from theme tokens | M | **High** |
| Remove the Launchpad key ask; house relay as default; one exit | M | **High** |
| `ValueField` — one scrubbable numeric control across five surfaces | L | **High** |
| Mark generated dimensions as assumed until confirmed | L | **High** |
| Undo labels its stack and frames the result | M | **High** |
| `MaterialMenu`/`SurfaceMenu`/profile menu adopt solo + outside-close | S | Med |
| Coarse-pointer control sizes (28 pt floor) + labelled rail | S | Med |
| Diff overlay gets a second channel (green/orange + wireframe) | S | Med |
| Global Reduce Motion guard + fade substitutions | S | Med |
| Size-banded tracking; fix `.wordmark` | S | Med |
| Workspace empty state stops re-asking the Launchpad question | S | Med |
| Launchpad autofocus guarded on `(pointer: fine)` | S | Med |
| Dock sections filtered by what is selected | S | Med |
| Plain-language pass + `UI_TERMS` map, grep-gated in CI | S | Med |
| Statistics → verdicts in Printability | M | Med |
| `readinessRows()` — one report, Export deep-links to Printability | M | Med |
| Native `prompt`/`confirm` → inline rename + in-app Delete/Cancel | M | Med |
| Settings commits on blur (or gates the backdrop on `dirty`) | M | Med |
| `aria-live` announcements for the five silent model events | M | Med |
| Hole/Point panels become ornaments anchored to their feature | M | Med |
| Hover vs locked selection materials | S | Med |
| Icon system: 1em sizing, one stroke rule, no emoji | M | Med |
| 3D orbit + extrude hints on first use | M | Med |
| `--ui-scale` text size control + rem migration | L | Med |
| Transient alignment guides for attachment drags | L | Med |

---

## Where this app should deliberately diverge

**Keep the engine chooser.** Apple Intelligence ships no model selector because every path produces the same *kind* of artifact. Precise and Generative here produce categorically different things — a parametric solid you can scrub and export as STEP, versus a mesh with no editable dimensions. Auto-routing should carry the common case; the override stays, because guessing wrong costs the user a rebuild, not a slightly different phrasing.

**Keep version history visible.** Apple has never shipped a persistent history panel to consumers; the Mac's safety net is invisible until invoked. But that assumes a *linear* editing session. Users here iterate through many generated candidates, most of which are wrong, and the value of a candidate is often only apparent three turns later. Visible history is load-bearing — and note its own precondition: it stays visible *because* Undo currently means three things. Once Undo means one thing and announces it, revisit.

**Keep the Source panel available, behind Advanced — do not delete it.** The relocation is right; the deletion would not be. `replicad` code is the app's only genuine escape hatch when the model gets a shape 90% right, and the audience overlaps heavily with people who read JavaScript. Safari's Develop menu is the precedent precisely because Apple did *not* delete Web Inspector.

**Keep BYO keys and local-first storage.** Apple's onboarding rule assumes Apple owns the inference. This app does not, and a user's own key is a feature — it is what makes an unmetered eight-hour design session possible. The Apple move is to make the *first* build require nothing, not to remove the key path.

**Go further than Apple on honesty about generated numbers.** Apple's mitigation for a hallucinated notification summary is a wrong sentence you read in two seconds. Here it is eight hours of filament and a bracket that does not fit. The `origin: "stated" | "assumed"` marking, the `≈` prefix and the confirm row are stricter than anything Apple ships for generative output — correctly, because the consequence is physical and irreversible.

**Accept pro density.** 28×28 is the sanctioned floor, not 44, and this is exactly the app that should sit at the floor on fine pointers — a tool rail, an inspector and a canvas competing for the same screen. The divergence is that coarse pointers get the *larger* treatment rather than the current inversion, where the 680 px container query shrinks controls precisely where fingers are used.