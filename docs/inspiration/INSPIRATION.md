# UI Inspiration (curated from Mobbin)

_Last updated: 2026-06-12_

Reference screens for our wireframes, found via Mobbin. Click the links to view full-size.

Local captures of all 21 screens are stored in [`screens/`](./screens) (filenames match the order in the
tables below). Screens 01–15 are Firecrawl page captures, lightly cropped to remove Mobbin's site chrome.
Screens 16–21 are the original Mobbin app-screen PNGs themselves — fetched at full resolution via each
page's OpenGraph `screenUrl` and cropped to the moodboard tile ratio. The Mobbin links remain the
canonical source.

## Pattern 1 — Chat-left + live-preview-right split (our Main Workspace)

The exact layout of our app, proven across the current generation of AI build tools:

| App | Screen | Takeaway for us |
| --- | --- | --- |
| **Lovable** | [chat + live preview](https://mobbin.com/screens/b1bb2a2b-bef4-47bf-9bf0-cda62c653e98) | Narrow chat (~30%), dominant preview pane, "Publish"-style primary action top-right → ours is **Export STL**. Loading state shown *in the preview pane* ("Starting live preview…"). |
| **Base44** | [chat with build plan + progress](https://mobbin.com/screens/7c37fcf1-f9fb-41d4-80ce-00510d1c0836) | Assistant message lays out a readable plan; "Wrote entities/Transaction" chips = our **"⬡ updated the model"** chips. Friendly "Building your idea…" interstitial. |
| **Claude** | [chat + artifact preview](https://mobbin.com/screens/885e249d-6fe3-4461-9e87-7f743f6fbd36) | Tab strip above the artifact (Preview/Code) = our **3D View / Code** tabs. Status lines ("Writing ×4, Done…") keep generation transparent. |
| **Vercel AI SDK** | [playground compare view](https://mobbin.com/screens/ec7e6852-bcb0-4cd8-9ed7-807260aabfaf) | Model picker in the pane header — ours lives in Settings + a small badge in the status bar. |

## Pattern 2 — 3D viewport ergonomics (our Viewer panel)

| App | Screen | Takeaway for us |
| --- | --- | --- |
| **Spline** | [viewport + toolbar](https://mobbin.com/screens/7f37c140-31ce-4cf9-8920-4aab992aa3df) | Floating icon toolbar over the canvas (not a heavy menu bar); orientation gizmo bottom-center; Export top-right. |
| **Spline** | [orbit onboarding hint](https://mobbin.com/screens/3c038273-a456-4532-9375-5d567b791c14) | First-run tooltip teaching orbit ("Hold ⌥ + drag") — copy this for our empty state. |

## Pattern 3 — Text/image → 3D generation (our Phase 2)

| App | Screen | Takeaway for us |
| --- | --- | --- |
| **Krea AI** | [Image-to-3D / Text-to-3D toggle](https://mobbin.com/screens/052d3205-ac8e-4e7d-b473-c083267dab5e) | **Runs Hunyuan3D-2.1 — direct validation of our Phase 2 provider shortlist.** Segmented toggle (Image to 3D / Text to 3D / Mesh only) = our Precise/Auto/Organic toggle. Model name shown bottom-left. |
| **Krea AI** | [prompt bar over viewport](https://mobbin.com/screens/634bda59-688c-4d26-88e1-ddb5f5a6ef07) | Prompt input floats over the 3D scene; "Generating 10 meshes" progress pill at top. |
| **Krea AI** | [result actions](https://mobbin.com/screens/cadf0bab-c557-4631-ad62-1213d30bf676) | Under-the-result actions: **Retry · Reuse parameters · Download** — adopt for organic results. |

## Pattern 4 — No home page: launch straight into the canvas (our app flow)

Added 2026-06-12 for the "Apple-simple" direction. These apps have **no home page** — opening
the app *is* the empty state, with one prompt input:

| App | Screen | Takeaway for us |
| --- | --- | --- |
| **Visual Electric** | [empty canvas + floating prompt](https://mobbin.com/screens/cb9eb41c-7413-4a89-a5c7-149ff25a8e23) · [with placeholder "What would you like to create?"](https://mobbin.com/screens/36a6c5c4-d0e4-418a-b0c6-5a218a26c6fe) | **The strongest reference for our launch experience.** Opens directly onto an "Untitled" canvas; a floating card holds the prompt; one Share button top-right (ours: Export). Zero navigation chrome. |
| **Manus** | ["What can I do for you?"](https://mobbin.com/screens/156621d5-5d04-427e-acd0-a20be1c8d1ca) | Single centered question + input + a few capability chips — exactly our empty-state pattern ("What do you want to make?"). |
| **ElevenLabs** | [single-purpose tool card](https://mobbin.com/screens/c61030c7-7dd0-4ba2-b209-175af5a3af94) | One card: title, one-line description, input, suggestions below. Template for our first-run key card. |
| **Craft** (iOS) | [clean dotted canvas](https://mobbin.com/screens/6011086c-42ca-43e5-aa73-2d1d6de04934) | Apple-minimal canvas chrome: tiny corner controls, everything else is content. |
| **Play** (iOS) | [floating inspector panels](https://mobbin.com/screens/e2228a8f-fd11-46e6-8321-76e7f46a608d) | Properties slide up as a translucent panel instead of a permanent sidebar — option for our Settings. |

> Note: **Shapr3D itself isn't indexed in Mobbin's library** (searched iOS; nearest results were
> adjacent canvas apps). For Shapr3D's actual UI conventions, reference the app directly.

## Pattern 5 — More 3D generation & export (found via Mobbin)

Added 2026-06-14 to round out the 3D-generation and export story for Phase 2:

| App | Screen | Takeaway for us |
| --- | --- | --- |
| **Krea AI** | [text→3D scene building](https://mobbin.com/screens/26034a96-934d-4a5c-bd25-06d3af820c5a) | Whole-scene composition from a prompt ("Add 3D objects to the scene…") plus a skybox/ambient-lighting panel — a richer take on our text-to-3D than single-object generation. |
| **Runway** | [text→3D texture generation](https://mobbin.com/screens/157dd717-d291-4852-b67d-63fffc90098e) | Texturing a bare mesh from a text prompt with a side settings panel — validates a future "texture this model" step on top of geometry. |
| **Spline** | [export & share (GLTF/URL/PNG)](https://mobbin.com/screens/56356620-0316-47fc-ad17-b2b241e682a0) | Single export dialog offering multiple targets + a "Done" confirmation — model for our **Export STL** dialog (add format choices later). |
| **Spline** | [export: 3D printing / STL](https://mobbin.com/screens/644fe085-a067-4017-9f91-36f8ecb20a02) | Form-style export/viewer settings — the closest reference to our print-export configuration. |
| **Krea AI** | [transform gizmo + inspector](https://mobbin.com/screens/4339d6ba-27e4-4020-9e1c-6d4aa6f9fe75) | Selected object shows a transform gizmo in the viewport and a properties inspector on the right — our object-edit pattern. |
| **Spline** | [orbit gizmo + 3D viewer](https://mobbin.com/screens/1800910b-adb8-403b-8f9a-31ed971d88ba) | Bottom-center orbit/orientation gizmo with orthographic/perspective toggle — reinforces the Pattern 2 viewport ergonomics. |

## Pattern 6 — More AI generation & model sourcing (found via Mobbin)

Added 2026-06-16. Two ways a user gets a model into the app — generate it, or import one:

| App | Screen | Takeaway for us |
| --- | --- | --- |
| **Luma AI** | [generate → 4-candidate results](https://mobbin.com/screens/39d279e7-b76f-4148-a841-189e411aa5d7) | One prompt returns a 2×2 grid of candidates to pick from — exactly our "generate N meshes, choose one" loop. |
| **Luma AI** | [prompt enrichment chips](https://mobbin.com/screens/341e8667-5d8e-4ed6-8c05-eec77be59b88) | Camera-angle / style / lighting chips build the prompt for the user — a great model for guiding non-expert prompts. |
| **Unity Asset Store** | [3D asset library — browse & import](https://mobbin.com/screens/04955ff2-5e81-43ea-a890-90e14a06f387) | Category-driven 3D asset marketplace — reference for an "import an existing model" path alongside generation. |

> **Not yet captured — slicers & desktop CAD.** The dedicated slicers (Bambu Studio, OrcaSlicer,
> UltiMaker Cura, PrusaSlicer) and desktop CAD (Fusion 360, Onshape, Shapr3D) are **not indexed in
> Mobbin**, and the dev environment's egress allowlist blocks fetching their screenshots from the
> open web (vendor sites + Wikimedia all return `host_not_allowed`). To add these, whitelist those
> hosts in the environment's network egress settings, then re-run.

## Color & theme directions (proposed)

First-pass palettes for the app (also laid out as swatches in the Figma moodboard, section 07):

- **Graphite Pro** — default 3D workspace (dark). Neutral graphite keeps focus on the model; one blue accent for primary actions.
  Canvas `#0E0F12` · Surface `#16181C` · Panel `#20242A` · Border `#2C313A` · Text `#E7EAEE` · Accent `#4C8DFF` · Success `#32D583`
- **Paper Light** — launch / empty canvas (light). Clean paper for the Apple-simple empty state; orange = filament / print accent.
  Canvas `#FFFFFF` · Surface `#F4F5F7` · Border `#DDE1E6` · Text `#16181B` · Muted `#687078` · Accent `#2D7DF6` · Filament `#FF6A2C`
- **Molten** — print identity / energetic accents. References molten filament + heated bed; warm accents for generate / print CTAs.
  Canvas `#121013` · Surface `#1E1B20` · Panel `#2A262E` · Text `#ECE7EF` · Accent `#FF7A45` · Heated `#FFC24B` · Cool `#34D8C2`

## What we're deliberately doing differently

- **Print-awareness everywhere:** dimensions readout, bed-fit check, wall-thickness warnings —
  none of the above tools have this; it's our differentiator.
- **Code transparency:** Claude/Lovable hide most code by default; we keep an always-available
  Code tab because the code *is* the model and power users will want it.
- **Local-first/BYO-key:** all of the above are hosted SaaS; we run in the user's browser.
