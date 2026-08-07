// Font plumbing for the Text tool. Google serves woff2 to every modern browser and
// woff2 is brotli-packed, so outlines need a decompress step before opentype.js can
// read them: css2 stylesheet → latin subset URL → wawoff2 (wasm) → opentype.Font.
// Everything is cached by family so retyping text costs nothing.
import type { Font } from "opentype.js";

/** A working set of Google families across the useful buckets — sans, serif, slab,
 *  display, script, mono. Any other Google family can be typed by name. */
export const GOOGLE_FONTS = [
  "Inter", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato", "Nunito",
  "Oswald", "Bebas Neue", "Anton", "Archivo Black", "Righteous", "Bungee",
  "Black Ops One", "Orbitron", "Audiowide", "Press Start 2P",
  "Playfair Display", "Merriweather", "Lora", "Abril Fatface",
  "Lobster", "Pacifico", "Dancing Script", "Caveat", "Permanent Marker",
  "JetBrains Mono", "Roboto Mono",
] as const;

const cache = new Map<string, Promise<Font>>();

async function parseFontBytes(bytes: ArrayBuffer): Promise<Font> {
  const opentype = await import("opentype.js");
  return opentype.parse(bytes);
}

/** woff2 → ttf. Google serves woff2 to every browser and opentype can't read it, so
 *  this is unavoidable; the wasm is inlined in the module, no extra request.
 *
 *  The binding is driven directly rather than through wawoff2's own `decompress()`:
 *  that wrapper builds its init promise by assigning `onRuntimeInitialized` AFTER
 *  importing the module, and with the wasm inlined the runtime is often already up by
 *  then — the callback never fires and the promise hangs forever. Checking `calledRun`
 *  first closes that race. */
type EmModule = { calledRun?: boolean; onRuntimeInitialized?: () => void; decompress(b: Uint8Array): Uint8Array | false };
let wawPromise: Promise<EmModule> | null = null;
/** wawoff2's decoder is a non-modularised emscripten build: it declares `var Module`
 *  at the top level of a classic script and mutates it as the runtime boots. Importing
 *  it as a module — which is what a bundler does — leaves that object unreachable and
 *  the runtime never runs, so the decode hangs forever with no error. Loading it the
 *  way it expects (a <script> tag, reading window.Module) is the reliable path. The
 *  wasm is inlined as base64 inside it, so this is one request and works offline. */
function loadWoff2Decoder(): Promise<EmModule> {
  wawPromise ??= new Promise<EmModule>((resolve, reject) => {
    const w = window as unknown as { Module?: unknown };
    const prior = w.Module;
    // Hand emscripten the object to fill in BEFORE the script runs: its first line is
    // `var Module = typeof Module !== "undefined" ? Module : {}`, so a pre-set global is
    // adopted and onRuntimeInitialized is guaranteed to be in place when the wasm
    // finishes instantiating. Waiting for the callback also matters — reaching for
    // decompress any earlier hits an unset `asm` and throws.
    const em = { onRuntimeInitialized: () => { setTimeout(() => { w.Module = prior; }, 0); resolve(em as unknown as EmModule); } };
    w.Module = em;
    const el = document.createElement("script");
    el.async = true;
    el.src = new URL("wawoff2/build/decompress_binding.js", import.meta.url).href;
    el.onerror = () => { w.Module = prior; reject(new Error("The font decoder couldn't load.")); };
    document.head.appendChild(el);
  });
  return wawPromise;
}
async function decompressWoff2(bytes: Uint8Array): Promise<ArrayBuffer> {
  const em = await loadWoff2Decoder();
  const ttf = em.decompress(bytes);
  if (!ttf) throw new Error("That font file couldn't be unpacked.");
  return ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
}

/** Load a Google font by family name. Throws with a plain-language message when the
 *  family doesn't exist or the network says no. */
export function loadGoogleFont(family: string): Promise<Font> {
  const key = `g:${family.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}`).then((r) => {
      if (!r.ok) throw new Error(`Google Fonts doesn't know “${family}” — check the exact name on fonts.google.com.`);
      return r.text();
    });
    // The stylesheet is split into per-script subsets; latin carries A–Z. Fall back to
    // the last block for symbol/icon fonts that have no latin split.
    const url =
      /\/\* latin \*\/[^@]*@font-face\s*{[^}]*?url\((https:[^)]+?)\)/.exec(css)?.[1] ??
      [...css.matchAll(/url\((https:[^)]+?)\)/g)].pop()?.[1];
    if (!url) throw new Error(`Couldn't read “${family}” from Google Fonts.`);
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const bytes = new Uint8Array(buf);
    const ttf = url.endsWith(".woff2") ? await decompressWoff2(bytes) : buf;
    return parseFontBytes(ttf);
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key)); // a failed fetch must not poison the family forever
  return p;
}

/** A font the user handed us — a .ttf/.otf file, or a local font's bytes. Registered
 *  under a name so text specs can refer back to it this session; editing a text after
 *  a reload with its file gone prompts a re-pick rather than failing silently. */
export function registerFontBytes(name: string, bytes: ArrayBuffer): Promise<Font> {
  const key = `u:${name.toLowerCase()}`;
  const p = bytes.byteLength >= 4 && new DataView(bytes).getUint32(0) === 0x774f4632 // "wOF2"
    ? decompressWoff2(new Uint8Array(bytes)).then(parseFontBytes)
    : parseFontBytes(bytes);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

export function getFont(family: string, custom: boolean): Promise<Font> {
  if (custom) {
    const hit = cache.get(`u:${family.toLowerCase()}`);
    if (hit) return hit;
    return Promise.reject(new Error(`The font “${family}” came from a file that isn't loaded any more — pick the file again to edit this text.`));
  }
  return loadGoogleFont(family);
}

/** Chrome/Edge expose installed fonts (with the user's permission); Safari and the
 *  desktop app's WKWebView don't — there the "font file" picker is the local path. */
export const canListLocalFonts = typeof window !== "undefined" && "queryLocalFonts" in window;

export async function listLocalFonts(): Promise<{ family: string; fullName: string }[]> {
  const q = (window as unknown as { queryLocalFonts(): Promise<{ family: string; fullName: string }[]> }).queryLocalFonts;
  const fonts = await q.call(window);
  const seen = new Set<string>();
  const out: { family: string; fullName: string }[] = [];
  for (const f of fonts) {
    if (seen.has(f.family)) continue;
    seen.add(f.family);
    out.push({ family: f.family, fullName: f.fullName });
  }
  return out;
}

export async function loadLocalFont(family: string): Promise<Font> {
  const key = `u:${family.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const q = (window as unknown as { queryLocalFonts(o?: { postscriptNames?: string[] }): Promise<Array<{ family: string; blob(): Promise<Blob> }>> }).queryLocalFonts;
  const matches = (await q.call(window)).filter((f) => f.family === family);
  if (!matches.length) throw new Error(`“${family}” isn't installed on this device.`);
  const bytes = await (await matches[0].blob()).arrayBuffer();
  return registerFontBytes(family, bytes);
}
