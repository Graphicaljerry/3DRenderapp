# Moldable — native desktop apps (Tauri)

This wraps the **existing** Moldable web build (`../dist`) in a native window using
[Tauri v2](https://v2.tauri.app). The web app is unchanged — the desktop shell renders
the same `dist/` through the OS's own WebView, so the installers are tiny and run
natively: **macOS** (Apple Silicon `.dmg`, ~10 MB) and **Windows 10/11** (x64
`.exe` installer).

**Why Tauri, not Electron:** the app uses only WebView-safe features (three.js WebGL,
*single-threaded* OCCT/Manifold WASM — no `SharedArrayBuffer`/threads, same-origin ES
module workers, IndexedDB, plain https to Supabase). So Tauri gives a ~10× smaller
download than Electron's bundled Chromium, with no compatibility work.

Per-platform note: Windows uses **WebView2**, which *is* Chromium — so everything
behaves exactly like the browser, including WebGPU (the optional on-device LLM works
there). macOS uses **WKWebView**, where WebGPU only arrives in macOS 26; that one
opt-in feature degrades on older macOS, and the default cloud brains are unaffected.

## Builds are automatic

Installers can only be built on their own OS, so CI does it on free GitHub runners.
**No manual step:** `.github/workflows/build-desktop.yml` runs on **every push to
`main`** (docs/harness-only commits skipped), builds both platforms in parallel, and
refreshes a rolling `desktop-latest` pre-release. That gives the download page two
permanent URLs:

```html
<a href="https://github.com/Graphicaljerry/3DRenderapp/releases/download/desktop-latest/Moldable_aarch64.dmg">
  Download for Mac (Apple Silicon)
</a>
<a href="https://github.com/Graphicaljerry/3DRenderapp/releases/download/desktop-latest/Moldable_x64-setup.exe">
  Download for Windows (x64)
</a>
```

Asset filenames are deliberately **stable** so those links never break; the build's
identity lives in the version instead — each bundle is stamped `0.2.<commit count>`,
matching the app's own status-bar number (app `v220` → `Moldable 0.2.220`).

Publishing is a **separate job** on purpose: if each platform published itself, the two
runners would race to recreate the same release and clobber each other's asset.

Extras:
- **Versioned release:** `git tag v0.3.0 && git push origin v0.3.0` also cuts a normal
  Release with both installers attached (for milestone builds worth keeping).
- **Ad-hoc build:** Actions tab → *Build desktop apps* → *Run workflow*.

**Locally** (builds for whatever OS you're on):

```bash
cd moldable-lite
npm ci
npm run tauri dev     # hot-reloading dev window
npm run tauri build   # → src-tauri/target/release/bundle/…
```

## Signing (for a clean public download)

Unsigned builds work, at the cost of a one-time prompt per platform:

| Platform | What the user sees | Their workaround |
| --- | --- | --- |
| macOS | "unidentified developer" (or "damaged" on macOS 15+) | right-click → **Open**; or `xattr -cr /Applications/Moldable.app` |
| Windows | SmartScreen "Windows protected your PC" | **More info** → **Run anyway** |

**macOS**, to remove it: an **Apple Developer account** ($99/yr) and the secrets below
— then uncomment the `APPLE_*` block in `.github/workflows/build-desktop.yml` and
`tauri-action` signs + notarizes + staples automatically:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an app-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

**Windows**, to remove SmartScreen: an **Authenticode code-signing certificate** from a
CA (~$200–400/yr OV; an EV cert clears SmartScreen immediately, OV builds reputation
over time). Optional — the "Run anyway" click is a perfectly normal beta experience.

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
