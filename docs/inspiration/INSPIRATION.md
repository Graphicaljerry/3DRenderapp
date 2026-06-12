# UI Inspiration (curated from Mobbin)

_Last updated: 2026-06-12_

Reference screens for our wireframes, found via Mobbin. Click the links to view full-size.
(Direct image files aren't stored in the repo — the dev environment's network policy blocks
downloading from mobbin.com — so this doc is the index. The screenshots were reviewed in-session.)

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

## What we're deliberately doing differently

- **Print-awareness everywhere:** dimensions readout, bed-fit check, wall-thickness warnings —
  none of the above tools have this; it's our differentiator.
- **Code transparency:** Claude/Lovable hide most code by default; we keep an always-available
  Code tab because OpenSCAD *is* the model and power users will want it.
- **Local-first/BYO-key:** all of the above are hosted SaaS; we run in the user's browser.
