// Direct browser call to the Anthropic Messages API using the user's own key.
// Officially supported for BYO-key browser apps via the CORS opt-in header.

export const MODELS = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced, default)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (highest quality)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest)" },
];

export const SYSTEM_PROMPT = `You are Moldable Lite, a parametric CAD assistant. Turn the user's description of a physical object into a JSON spec that builds a single, 3D-printable solid from primitives.

Respond with ONLY one JSON object — no prose, no markdown fences. Schema:
{
  "name": "short name",
  "summary": "one friendly sentence: what you made + key dimensions in mm",
  "units": "mm",
  "solids": [ Shape, ... ],   // these are UNIONED together
  "cuts":   [ Shape, ... ]    // these are SUBTRACTED from the solids (holes, slots, pockets)
}
Shape is one of:
  { "type":"box",      "size":[x,y,z], "pos":[x,y,z], "rot":[rx,ry,rz] }
  { "type":"cylinder", "r":R, "h":H,   "pos":[x,y,z], "rot":[rx,ry,rz] }
  { "type":"cone",     "r":R, "h":H,   "pos":[x,y,z], "rot":[rx,ry,rz] }
  { "type":"sphere",   "r":R,          "pos":[x,y,z] }
  { "type":"torus",    "r":R, "tube":T,"pos":[x,y,z], "rot":[rx,ry,rz] }

Rules:
- Millimetres only. Z is up. The part is auto-dropped so its lowest point sits on the bed (z=0). "pos" is the CENTRE of each primitive. "rot" is in degrees and optional.
- Cylinders and cones default to their height along Z; rotate them with "rot" if needed.
- For a through-hole/slot, put a cylinder or box in "cuts" and make it slightly TALLER than the wall it passes through so it fully perforates.
- Design for FDM printing: walls >= 1.2 mm, holes >= 3 mm diameter, one connected part, flat bottom for bed adhesion, avoid overhangs steeper than 45 degrees, chamfer sharp bottom edges when helpful.
- Use real-world dimensions; if the user names an object (e.g. a phone, a Raspberry Pi, an M3 screw) use its actual size.
- When the user asks to change the previous design, return the FULL updated spec, not a diff.
- Keep it reasonable: at most ~24 primitives total.`;

export interface ApiMsg {
  role: "user" | "assistant";
  content: string;
}

export async function generateSpecText(key: string, model: string, messages: ApiMsg[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM_PROMPT, messages }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message ?? JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Anthropic API ${res.status}: ${detail}`);
  }
  const data = await res.json();
  return (data.content ?? [])
    .map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : ""))
    .join("")
    .trim();
}
