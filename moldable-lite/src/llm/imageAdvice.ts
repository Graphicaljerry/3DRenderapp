// What picture should the user attach, for THIS brain? Every vision API resizes and
// re-encodes what it receives, so pixels past the model's ceiling are pure upload cost
// and formats outside its list fail outright (iPhone HEIC against Claude/GPT being the
// classic). One sentence of the right advice at the attach point prevents both.
//
// Ceilings, per provider docs (Aug 2026): Anthropic downscales past ~1568px on the long
// edge (tokens ≈ w×h/750); OpenAI's high-detail path works on 768px-short-side tiles;
// Gemini tiles at 768px and uniquely accepts HEIC/HEIF; mesh engines (image→3D) want
// one clear subject and reward ~1024px+.

export function imageAdvice(opts: { provider: string; mesh?: boolean }): string {
  const sketch = "Photos and hand-drawn sketches both work — write dimensions on the sketch and they're used exactly.";
  if (opts.mesh) {
    return `One clear subject on a plain background, facing the camera. JPG, PNG or WebP, ~1024 px or larger. ${sketch}`;
  }
  switch (opts.provider) {
    case "anthropic":
      return `JPG, PNG or WebP up to ~1568 px on the long side — bigger is downscaled, not sharper. iPhone HEIC photos aren't readable: share or export as JPG first. Straight-on, even light; a ruler or coin in frame nails the scale. ${sketch}`;
    case "gemini":
      return `JPG, PNG, WebP — and HEIC straight off an iPhone. ~768–2048 px works best. Straight-on, even light; a ruler or coin in frame nails the scale. ${sketch}`;
    case "openai":
      return `JPG, PNG or WebP, ~768–2048 px. HEIC isn't readable — share or export as JPG first. Straight-on, even light; a ruler or coin in frame nails the scale. ${sketch}`;
    case "ollama":
    case "local":
      return `Vision depends on the local model (llava / qwen-vl families see; plain coders don't). JPG or PNG around ~1024 px. ${sketch}`;
    default: // openrouter, house, groq, custom — the routed model varies
      return `JPG, PNG or WebP, ~1024–1568 px on the long side (HEIC often isn't readable — share as JPG). Straight-on, even light; a ruler or coin in frame nails the scale. ${sketch}`;
  }
}
