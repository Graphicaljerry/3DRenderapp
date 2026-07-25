# Moldable — native macOS app (Tauri)

This wraps the **existing** Moldable web build (`../dist`) in a native window using
[Tauri v2](https://v2.tauri.app). The web app is unchanged — the desktop shell just
renders the same `dist/` through the system WebView (WKWebView on macOS), so the
`.dmg` is tiny (~20–35 MB) and runs natively on Apple Silicon.

**Why Tauri, not Electron:** the app uses only WKWebView-safe features (three.js WebGL,
*single-threaded* OCCT/Manifold WASM — no `SharedArrayBuffer`/threads, same-origin ES
module workers, IndexedDB, plain https to Supabase). So Tauri gives a 4–5× smaller
download with no compatibility work. The only feature that degrades is the *optional*
on-device LLM (needs WebGPU, only in WKWebView on macOS 26+); the default cloud brains
are plain https and always work.

## Build the DMG — automatic

The `.dmg` can only be built on **macOS** (Apple's WebKit + bundler), so CI does it on
a free Apple-Silicon runner. **No manual step:** `.github/workflows/build-mac.yml` runs
on **every push to `main`** (docs/harness-only commits are skipped) and refreshes a
rolling `mac-latest` pre-release. That gives the download page one permanent URL:

```html
<a href="https://github.com/Graphicaljerry/3DRenderapp/releases/download/mac-latest/Moldable_aarch64.dmg">
  Download for Mac (Apple Silicon)
</a>
```

The asset filename is deliberately **stable** (`Moldable_aarch64.dmg`) so that link
never breaks; the build's identity lives in the version instead — the bundle is stamped
`0.2.<commit count>`, matching the app's own status-bar number (app `v218` →
`Moldable 0.2.218`).

Extras:
- **Versioned release:** `git tag v0.2.0 && git push origin v0.2.0` also cuts a normal
  Release with the same DMG attached (for milestone builds worth keeping).
- **Ad-hoc build:** Actions tab → *Build macOS DMG* → *Run workflow* (also uploads the
  `.dmg` as a run artifact).

**On a Mac locally:**

```bash
cd moldable-lite
npm ci
npm run tauri dev     # hot-reloading dev window
npm run tauri build   # → src-tauri/target/release/bundle/dmg/Moldable_*.dmg
```

## Signing + notarization (for a clean public download)

Unsigned builds work but macOS shows an "unidentified developer" prompt (users
right-click the app → **Open** the first time). For a friction-free download you need
an **Apple Developer account** ($99/yr) and these repo secrets — then uncomment the
`APPLE_*` block in `.github/workflows/build-mac.yml` and `tauri-action` signs +
notarizes + staples automatically:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an app-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

## What the DMG gives users

- Native Apple-Silicon app — Dock icon, real window, no browser chrome around the 3D viewport.
- Fully offline CAD (the WASM kernel, templates, edits, measure, export are bundled; only cloud AI + sync need the internet, same as the web app).
- More memory headroom than a browser tab → heavier meshes.
- Fast-follow (small Rust addition in `src/lib.rs`): `.3mf` / `.stl` / `.step` file
  associations + real Save/Open dialogs so double-clicking a model opens Moldable.

## What is / isn't verifiable off a Mac

The web build and Tauri config are validated on any OS (`npx tauri info`). The actual
`.dmg`, the WKWebView runtime smoke test (WASM instantiating, workers spawning, the
Supabase relay fetch from the `tauri://localhost` origin), and code-signing all require
the macOS runner or a real Mac — the CI workflow's first green build is the go-signal.
