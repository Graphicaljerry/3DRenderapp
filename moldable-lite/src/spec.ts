// The tiny CAD schema the model emits and the builder consumes.
// Millimetres. Z is up. `pos` is the CENTRE of each primitive.

export type Shape =
  | { type: "box"; size: [number, number, number]; pos?: [number, number, number]; rot?: [number, number, number] }
  | { type: "cylinder"; r: number; h: number; pos?: [number, number, number]; rot?: [number, number, number] }
  | { type: "cone"; r: number; h: number; pos?: [number, number, number]; rot?: [number, number, number] }
  | { type: "sphere"; r: number; pos?: [number, number, number] }
  | { type: "torus"; r: number; tube: number; pos?: [number, number, number]; rot?: [number, number, number] };

export interface ModelSpec {
  name: string;
  summary?: string;
  units?: "mm";
  solids: Shape[];
  cuts?: Shape[];
}

/** Best-effort parse: strips prose/fences, extracts the JSON object, validates minimally. */
export function parseSpec(text: string): ModelSpec {
  let t = text.trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b < 0 || b <= a) throw new Error("No JSON object found in the model's reply.");
  t = t.slice(a, b + 1);
  let spec: ModelSpec;
  try {
    spec = JSON.parse(t);
  } catch (e) {
    throw new Error("The model's reply was not valid JSON.");
  }
  if (!spec || !Array.isArray(spec.solids) || spec.solids.length === 0) {
    throw new Error("Spec has no solids to build.");
  }
  if (!spec.cuts) spec.cuts = [];
  if (!spec.name) spec.name = "Untitled part";
  return spec;
}
