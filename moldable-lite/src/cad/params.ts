// Extract the `const defaultParams = { ... }` numeric design parameters that the
// system prompt asks the model to declare. Regex-only (no eval of model code).

export type CadParams = Record<string, number>;

export function extractParams(code: string): CadParams | null {
  const m = code.match(/const\s+defaultParams\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return null;
  const out: CadParams = {};
  // Full JS number syntax. The old pattern stopped at the mantissa, so `tolerance: 1e-3`
  // was read as 1 — a thousandfold error that then rode along on every later adjustment
  // (a commit sends the WHOLE map), silently reshaping the part. A leading-dot literal
  // (`.5`) was skipped entirely and the row never appeared.
  const re = /(\w+)\s*:\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(m[1]))) {
    const n = parseFloat(mm[2]);
    if (Number.isFinite(n)) out[mm[1]] = n;
  }
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

// ---- Parameter presentation ------------------------------------------------------
// Everything below derives from the identifier and the VALUE alone. There is no schema:
// the names come out of AI-generated code and change with every model, so anything that
// needs semantics we do not have (units, categories, which ones matter) has to be either
// inferred defensibly or left alone.

/** A parameter that counts things is an integer, and a fractional count is nonsense.
 *  Matched on the identifier because that is all we have — deliberately narrow, so a
 *  miss falls back to a normal decimal rather than silently rounding a real dimension. */
export function isCountParam(name: string): boolean {
  // The boundary is a word break, NOT any non-letter: `[^a-z]` let `slots_depth` and
  // `holes_dia` through, and force-rounding a snake_case DEPTH to an integer is exactly
  // the silent-wrong-dimension case this narrowness exists to avoid.
  return /(^|[^a-z])(count|num|qty|segments|sides|teeth|rows|cols|columns|holes|slots|ribs|layers|turns|starts)($|[^a-z_])/i.test(name);
}

/** Decimals actually present in the default, so the step matches how the value was
 *  authored: 3.5 steps by 0.1, 70 steps by 1. The old three-magnitude-bucket rule gave
 *  a 0.5 step to a value of 3.5 and made it impossible to land on 3.7. */
export function paramStep(v: number): number {
  if (!isFinite(v) || v === 0) return 0.1;
  const s = String(v);
  const dot = s.indexOf(".");
  const decimals = dot < 0 ? 0 : s.length - dot - 1;
  if (decimals >= 2) return 0.01;
  if (decimals === 1) return 0.1;
  return Math.abs(v) >= 50 ? 1 : 0.5;
}

/** SOFT limits — what a drag is bounded by. Typed input is NOT bound by these (see
 *  Blender's soft/hard split): 0.25x-3x around the AI's value is a guess, and refusing
 *  a number the user typed because our guess disagrees is the wrong side to err on.
 *
 *  Two things the range has to respect, both learned from real breakage:
 *   - NEGATIVE parameters exist (offsets, insets). Ranging on |v| put a −5 parameter
 *     inside [1, 15], so the first pixel of a drag flipped it to +1 and it could never
 *     be dragged back. Negative values get a negative range.
 *   - `cur` is the value the row is actually AT. Without it, typing 100 into a row whose
 *     default is 10 and then nudging collapsed it to the guessed max of 30 and trapped
 *     it there — the drag bound must always contain where the user already is. */
export function paramSoftRange(v: number, cur = v): { min: number; max: number; step: number } {
  const step = paramStep(v);
  const grow = (min: number, max: number) => ({
    min: Number.isFinite(cur) ? Math.min(min, cur) : min,
    max: Number.isFinite(cur) ? Math.max(max, cur) : max,
    step,
  });
  if (v === 0) return grow(-10, 10);
  const mag = Math.abs(v);
  const lo = Math.floor((mag * 0.25) / step) * step;
  const hi = Math.ceil((mag * 3) / step) * step;
  return v < 0 ? grow(-hi, Math.min(0, -lo)) : grow(Math.max(0, lo), hi);
}

/** The bounds a DRAG may not pass. Deliberately far outside the soft range: that range
 *  is a recommendation drawn as the meter's fill, and clamping the drag to it made a
 *  value you could still reach by typing impossible to drag to — the control contradicted
 *  itself. This is only a sanity rail (no negative sizes, nothing absurd). */
export function paramHardRange(v: number, cur = v): { min: number; max: number } {
  const mag = Math.max(Math.abs(v) || 1, Math.abs(cur) || 1);
  return v < 0 ? { min: -mag * 20, max: 0 } : { min: 0, max: mag * 20 };
}

const ABBREV: Record<string, string> = {
  dia: "diameter", diam: "diameter", rad: "radius", len: "length", ht: "height",
  thk: "thickness", thick: "thickness", cnt: "count", num: "number", qty: "quantity",
  min: "minimum", max: "maximum", tol: "tolerance", clr: "clearance", w: "width",
  h: "height", d: "depth", r: "radius",
};

/** `screwHoleDia` -> `Screw hole diameter`. The raw identifier is still shown, quietly,
 *  because it is what appears in the generated source and in the AI's own vocabulary —
 *  hiding it entirely would break the link between this panel and the Source tab. */
export function humanizeParam(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => ABBREV[w.toLowerCase()] ?? w);
  const s = words.join(" ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Evaluate a typed value: a plain number, a relative edit (+10, *2, /4), or a small
 *  arithmetic expression. NEVER eval — this parses a fixed grammar of numbers and
 *  + - * / ( ) only, so nothing from generated code or a paste can execute. */
export function evalParamInput(raw: string, current: number): number | null {
  const t = raw.trim();
  if (!t) return null;
  // Leading operator = relative to the current value ("+10" means current + 10).
  const rel = /^([+\-*/])\s*(.+)$/.exec(t);
  const expr = rel ? `${current}${rel[1]}(${rel[2]})` : t;
  if (!/^[0-9+\-*/(). \t]+$/.test(expr)) return null;

  let i = 0;
  const ws = () => { while (i < expr.length && /\s/.test(expr[i])) i++; };
  const num = (): number | null => {
    ws();
    if (expr[i] === "(") {
      i++;
      const v = sum();
      ws();
      if (expr[i] !== ")") return null;
      i++;
      return v;
    }
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(expr.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const prod = (): number | null => {
    let a = num();
    if (a === null) return null;
    for (;;) {
      ws();
      const op = expr[i];
      if (op !== "*" && op !== "/") return a;
      i++;
      const b = num();
      if (b === null) return null;
      if (op === "/" && b === 0) return null;
      a = op === "*" ? a * b : a / b;
    }
  };
  const sum = (): number | null => {
    let a = prod();
    if (a === null) return null;
    for (;;) {
      ws();
      const op = expr[i];
      if (op !== "+" && op !== "-") return a;
      i++;
      const b = prod();
      if (b === null) return null;
      a = op === "+" ? a + b : a - b;
    }
  };
  const v = sum();
  ws();
  return v !== null && i === expr.length && isFinite(v) ? v : null;
}

export type ParamRow = { key: string; value: number; isCount: boolean; frac: number };
export type ParamGroup = { title: string; rows: ParamRow[] };

/** Order and group the panel by MAGNITUDE, biggest first.
 *
 *  A visual thinker's first question about a list of generated parameter names is never
 *  "what is hookReach" — it is "which of these is the big one". That is answerable from
 *  the VALUE alone, needs no semantics we do not have, and costs nothing to compute.
 *
 *  Grouping by identifier morphology (clustering screwHole* together) was tried and
 *  rejected: run over the real template models it produces zero groups on about half of
 *  them, because generated parameter names rarely share a prefix. Magnitude always
 *  partitions. Counts are split off because they are not lengths and do not belong on
 *  the same scale as one.
 *
 *  Order comes from the DESIGN's values (`defaults`), never the edited ones. Ordering by
 *  the live value made the list re-sort as you dragged: the row slid out from under the
 *  cursor mid-scrub, and crossing a band boundary moved it to another section entirely,
 *  which remounts the node and kills the drag outright. The layout has to hold still
 *  while you edit it.
 */
export function groupParams(defaults: CadParams, values: CadParams): ParamGroup[] {
  const all: ParamRow[] = Object.keys(defaults).map((k) => ({
    key: k,
    value: values[k] ?? defaults[k],
    isCount: isCountParam(k),
    frac: 0,
  }));
  const counts = all.filter((r) => r.isCount);
  const dims = all.filter((r) => !r.isCount);
  const maxV = Math.max(1e-6, ...dims.map((r) => Math.abs(defaults[r.key])));
  for (const r of dims) r.frac = Math.abs(defaults[r.key]) / maxV;
  dims.sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key));

  // Below six rows there is nothing to navigate, and section headers would be more
  // chrome than content. One sorted list.
  if (dims.length < 6) {
    return [{ title: "", rows: dims }, ...(counts.length ? [{ title: "Counts", rows: counts }] : [])];
  }
  const band = (r: ParamRow) => (r.frac >= 0.35 ? 0 : r.frac >= 0.06 ? 1 : 2);
  const titles = ["Overall size", "Features", "Fine detail"];
  const groups: ParamGroup[] = titles
    .map((title, i) => ({ title, rows: dims.filter((r) => band(r) === i) }))
    .filter((g) => g.rows.length > 0);
  // A section of one is a header with nothing to compare against — fold it into a neighbour.
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].rows.length === 1 && groups.length > 1) {
      const t = i > 0 ? i - 1 : 1;
      groups[t].rows = i > 0 ? [...groups[t].rows, ...groups[i].rows] : [...groups[i].rows, ...groups[t].rows];
      groups.splice(i, 1);
      i--;
    }
  }
  if (counts.length) groups.push({ title: "Counts", rows: counts });
  return groups;
}
