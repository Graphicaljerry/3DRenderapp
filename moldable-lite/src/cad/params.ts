// Extract the `const defaultParams = { ... }` numeric design parameters that the
// system prompt asks the model to declare. Regex-only (no eval of model code).

export type CadParams = Record<string, number>;

export function extractParams(code: string): CadParams | null {
  const m = code.match(/const\s+defaultParams\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return null;
  const out: CadParams = {};
  const re = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(m[1]))) out[mm[1]] = parseFloat(mm[2]);
  return Object.keys(out).length ? out : null;
}

/** Sensible slider bounds around a default value. */
export function paramRange(v: number): { min: number; max: number; step: number } {
  if (v === 0) return { min: 0, max: 10, step: 0.1 };
  const mag = Math.abs(v);
  const step = mag < 2 ? 0.1 : mag < 20 ? 0.5 : 1;
  const min = Math.max(0, Math.floor(v * 0.25 / step) * step);
  const max = Math.ceil((v * 3) / step) * step;
  return { min, max, step };
}
