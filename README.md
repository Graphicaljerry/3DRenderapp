# 3D Print AI Assistant

An AI assistant for designing 3D-printable objects by **describing them in plain language**
(and later, by **uploading a photo or sketch**). Chat with an AI, watch the model appear in a
live 3D viewer, tweak it by continuing the conversation, then export a print-ready STL.

> Status: **Planning.** No code yet — this repo currently contains the project plan and the
> wireframe content outline. See [`docs/PLAN.md`](docs/PLAN.md) and
> [`docs/WIREFRAMES.md`](docs/WIREFRAMES.md).

## The one-paragraph pitch

You type *"a wall bracket for a 22 mm broom handle, two screw holes 60 mm apart"* and the
assistant generates the part, shows it in 3D, and lets you refine it (*"make the screw holes
bigger"*, *"add a 45° support gusset"*) by chatting. When you like it, you download an STL and
print it. For organic things (a figurine, an ornament), it switches to a different AI engine that
can dream up freeform shapes.

## How it works (two engines, picked automatically)

| Engine | Best for | How it generates geometry |
| --- | --- | --- |
| **Parametric (Phase 1)** | Brackets, boxes, holders, gears, functional parts | An LLM (Claude by default) writes **OpenSCAD** code; the app compiles it to STL **in your browser** via WebAssembly. Clean, watertight, editable. |
| **Generative mesh (Phase 2)** | Figurines, characters, organic/artistic shapes | A text/image-to-3D API (Meshy, Tripo, Hunyuan3D, etc.) returns a mesh; the app cleans it for printing. |

## Key design decisions

- **Local-first web app.** Runs in your browser, no backend required to start.
- **Bring your own API keys.** You paste your own keys (Anthropic, and later a mesh provider).
  Keys live in your browser only. You pay providers directly; no accounts or billing to build.
- **Personal use first, commercial-ready later.** The architecture keeps a clean path to adding
  login + hosted keys if you ever decide to ship it to others.
- **FDM filament target**, but exports standard STL that works for any printer or print service.

## Quick links

- 📋 [Project plan, goals & roadmap](docs/PLAN.md)
- 🖼️ [Wireframe content outline](docs/WIREFRAMES.md)
