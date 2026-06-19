#!/usr/bin/env python3
"""Generate the minimalist icon set (SVGs + a preview grid) for the app.

Style: 24x24 viewBox, 1.7 stroke, round caps/joins, currentColor (no fills) —
the Lucide/Feather visual language, so these sit cleanly next to Lucide icons.
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

HEAD = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        'fill="none" stroke="currentColor" stroke-width="1.7" '
        'stroke-linecap="round" stroke-linejoin="round">')

# (category, file, label, inner-svg)
ICONS = [
    # ---- Brand marks / logo glyphs ----
    ("Brand marks", "logo-box", "Cube mark",
     '<path d="M12 2 21 7 21 17 12 22 3 17 3 7Z"/><path d="M3 7 12 12 21 7"/><path d="M12 12V22"/>'),
    ("Brand marks", "logo-extrude", "Words → object",
     '<rect x="6" y="9" width="8" height="8" rx="0.5"/><path d="M9 6 17 6 17 14"/><path d="M6 9 9 6"/><path d="M14 9 17 6"/><path d="M14 17 17 14"/>'),
    ("Brand marks", "logo-spark-cube", "AI cube",
     '<path d="M11 4 18 8 18 15 11 19 4 15 4 8Z"/><path d="M4 8 11 12 18 8"/><path d="M11 12V19"/><path d="M19.5 2 20.3 4.2 22.5 5 20.3 5.8 19.5 8 18.7 5.8 16.5 5 18.7 4.2Z"/>'),

    # ---- Create & AI ----
    ("Create & AI", "sparkles", "Generate",
     '<path d="M12 3 13.6 9 19.5 10.5 13.6 12 12 18 10.4 12 4.5 10.5 10.4 9Z"/><path d="M18.5 3 19.1 5.2 21.3 5.8 19.1 6.4 18.5 8.6 17.9 6.4 15.7 5.8 17.9 5.2Z"/>'),
    ("Create & AI", "prompt-text", "Prompt",
     '<path d="M4 7V5H20V7"/><path d="M12 5V19"/><path d="M9 19H15"/>'),
    ("Create & AI", "regenerate", "Regenerate",
     '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    ("Create & AI", "upload", "Upload reference",
     '<path d="M12 15V4"/><path d="M8 8 12 4 16 8"/><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>'),

    # ---- 3D viewport ----
    ("Viewport", "orbit", "Orbit / rotate",
     '<circle cx="12" cy="12" r="2.5"/><path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5"/><path d="M17 4l2.6.5-.5 2.6"/>'),
    ("Viewport", "move", "Move / pan",
     '<path d="M12 2v20"/><path d="M2 12h20"/><path d="M9 5 12 2 15 5"/><path d="M9 19 12 22 15 19"/><path d="M5 9 2 12 5 15"/><path d="M19 9 22 12 19 15"/>'),
    ("Viewport", "zoom-in", "Zoom",
     '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>'),
    ("Viewport", "scale", "Scale / fit",
     '<path d="M9 3H3v6"/><path d="M15 21h6v-6"/><path d="M3 3l6 6"/><path d="M21 21l-6-6"/>'),
    ("Viewport", "wireframe", "Wireframe / mesh",
     '<path d="M12 3 20 7.5 20 16.5 12 21 4 16.5 4 7.5Z"/><path d="M4 7.5 12 12 20 7.5"/><path d="M12 12V21"/><circle cx="12" cy="3" r="1"/><circle cx="20" cy="7.5" r="1"/><circle cx="20" cy="16.5" r="1"/><circle cx="12" cy="21" r="1"/><circle cx="4" cy="16.5" r="1"/><circle cx="4" cy="7.5" r="1"/>'),

    # ---- Edit / geometry ----
    ("Edit", "layers", "Layers",
     '<path d="M12 2 22 8.5 12 15 2 8.5Z"/><path d="M2 13 12 19.5 22 13"/>'),
    ("Edit", "boolean", "Boolean / combine",
     '<rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1"/>'),
    ("Edit", "undo", "Undo",
     '<path d="M9 14 4 9 9 4"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>'),

    # ---- Material & light ----
    ("Material & light", "material", "Material",
     '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="9" r="1.4"/>'),
    ("Material & light", "light", "Lighting",
     '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M19.1 4.9l-1.4 1.4"/><path d="M6.3 17.7l-1.4 1.4"/>'),

    # ---- 3D printing (the differentiators) ----
    ("3D printing", "printer", "3D printer",
     '<path d="M4 3h16v16H4z"/><path d="M4 8h16"/><path d="M11.2 8v2.2h1.6V8"/><path d="M9 18l1.5-3h3l1.5 3"/>'),
    ("3D printing", "slice", "Slice / layers",
     '<path d="M6 6h12"/><path d="M5 10h14"/><path d="M4 14h16"/><path d="M3 18h18"/>'),
    ("3D printing", "filament", "Filament spool",
     '<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="2.5"/><path d="M19 12h3"/><path d="M22 12v4"/>'),
    ("3D printing", "build-plate", "Build plate",
     '<path d="M3 17h18"/><path d="M3 17v2"/><path d="M21 17v2"/><path d="M9 17V11h6v6"/><path d="M9 11l3-2 3 2"/>'),
    ("3D printing", "supports", "Supports",
     '<path d="M7 4h10v5H7z"/><path d="M9 9v8"/><path d="M12 9v8"/><path d="M15 9v8"/><path d="M6 18h12"/>'),
    ("3D printing", "infill", "Infill",
     '<path d="M9 6.5l3 1.75v3.5L9 13.5l-3-1.75v-3.5z"/><path d="M15 6.5l3 1.75v3.5L15 13.5l-3-1.75v-3.5z"/><path d="M12 11.5l3 1.75v3.5L12 18.5l-3-1.75v-3.5z"/>'),

    # ---- File & status ----
    ("File & status", "export", "Export / download",
     '<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 18v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1"/>'),
    ("File & status", "printability", "Printability check",
     '<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z"/><path d="M9 12l2 2 4-4"/>'),
    ("File & status", "share", "Share",
     '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6.5l-6.8 4"/>'),
    ("File & status", "gallery", "Gallery / grid",
     '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
    ("File & status", "settings", "Settings",
     '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>'),
]


def svg(inner):
    return HEAD + inner + "</svg>\n"


def main():
    for _cat, name, _label, inner in ICONS:
        with open(os.path.join(OUT, name + ".svg"), "w") as f:
            f.write(svg(inner))

    # ---- preview.html : responsive wrap grid (mirrors a Figma auto-layout grid) ----
    cats = []
    for cat, name, label, inner in ICONS:
        if not cats or cats[-1][0] != cat:
            cats.append((cat, []))
        cats[-1][1].append((name, label, inner))

    sections = []
    for cat, items in cats:
        cells = "".join(
            f'<figure class="cell"><span class="ic">{svg(inner)}</span>'
            f'<figcaption>{label}<small>{name}</small></figcaption></figure>'
            for name, label, inner in items
        )
        sections.append(
            f'<h2>{cat} <span class="count">{len(items)}</span></h2>'
            f'<div class="grid">{cells}</div>'
        )

    total = len(ICONS)
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Icon system — {total} icons</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font:15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
          margin:0; padding:32px 40px 64px; background:#fafafa; color:#111; }}
  header h1 {{ font-size:22px; margin:0 0 4px; }}
  header p {{ margin:0 0 8px; color:#666; max-width:60ch; }}
  h2 {{ font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#888;
        margin:40px 0 14px; border-bottom:1px solid #e6e6e6; padding-bottom:8px; }}
  h2 .count {{ background:#eee; color:#666; border-radius:10px; padding:1px 8px; font-size:11px; }}
  .grid {{ display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(116px,1fr)); }}
  .cell {{ margin:0; background:#fff; border:1px solid #ececec; border-radius:12px;
           padding:16px 8px 10px; display:flex; flex-direction:column; align-items:center;
           gap:10px; text-align:center; transition:.15s; }}
  .cell:hover {{ border-color:#bbb; box-shadow:0 2px 10px rgba(0,0,0,.06); }}
  .ic svg {{ width:28px; height:28px; color:#111; display:block; }}
  figcaption {{ font-size:12px; color:#333; line-height:1.25; }}
  figcaption small {{ display:block; color:#aaa; font-size:10px; margin-top:2px; }}
  .dark {{ margin-top:48px; background:#0e0f12; border-radius:16px; padding:24px 28px; }}
  .dark h2 {{ color:#888; border-color:#222; }}
  .dark .cell {{ background:#17181c; border-color:#26282e; }}
  .dark .ic svg {{ color:#f2f2f2; }}
  .dark figcaption {{ color:#cfcfcf; }}
</style></head>
<body>
<header>
  <h1>Icon system &mdash; {total} minimalist icons</h1>
  <p>24&times;24, 1.7px stroke, round caps, <code>currentColor</code> &mdash; the Lucide/Feather
  language, so these drop in beside Lucide. Bold = the custom 3D / print glyphs that no standard
  set ships.</p>
</header>
{''.join(sections)}
<div class="dark"><h2>On dark</h2><div class="grid">{''.join(
    f'<figure class="cell"><span class="ic">{svg(inner)}</span><figcaption>{label}</figcaption></figure>'
    for _c, _n, label, inner in ICONS)}</div></div>
</body></html>
"""
    with open(os.path.join(OUT, "preview.html"), "w") as f:
        f.write(html)

    print(f"Wrote {total} SVGs + preview.html to {OUT}")


if __name__ == "__main__":
    main()
