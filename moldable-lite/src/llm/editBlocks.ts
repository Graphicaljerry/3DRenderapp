// SEARCH/REPLACE "edit blocks" (aider-style) let the model return only the changed
// lines of a small edit instead of the whole replicad program — cutting OUTPUT tokens
// (the expensive side). Applied locally, then the result is re-executed; if a block
// fails to match or the code doesn't build, the caller falls back to a full regenerate,
// so a bad delta is only ever a latency cost, never a broken model.

export interface EditBlock {
  search: string;
  replace: string;
}

// <<<<<<< SEARCH \n <old> \n ======= \n <new> \n >>>>>>> REPLACE  (fence markers, ≥5 chars)
const BLOCK_RE = /<{5,}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n?={5,}\s*\r?\n([\s\S]*?)\r?\n?>{5,}\s*REPLACE/g;

/** True if the text looks like it contains at least one SEARCH/REPLACE block. */
export function hasEditBlocks(text: string): boolean {
  return /<{5,}\s*SEARCH/.test(text) && />{5,}\s*REPLACE/.test(text);
}

/** Extract every SEARCH/REPLACE block from a model response. */
export function parseEditBlocks(text: string): EditBlock[] {
  const out: EditBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text)) !== null) out.push({ search: m[1], replace: m[2] });
  return out;
}

const rstripLines = (s: string) => s.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n");

/** Apply blocks to `code` in order. Exact match first, then a trailing-whitespace-tolerant
 *  match. Returns the new code, or null if any block can't be matched (→ caller falls back). */
export function applyEditBlocks(code: string, blocks: EditBlock[]): string | null {
  if (!blocks.length) return null;
  let out = code;
  for (const b of blocks) {
    if (b.search === "") {
      // Empty SEARCH = insertion; append the new text (rare — models usually anchor edits).
      out = `${out}\n${b.replace}`;
      continue;
    }
    if (out.includes(b.search)) {
      out = out.replace(b.search, b.replace); // first occurrence
      continue;
    }
    // Lenient: ignore trailing whitespace differences per line.
    const normOut = rstripLines(out);
    const normSearch = rstripLines(b.search);
    const idx = normOut.indexOf(normSearch);
    if (idx >= 0 && normOut.indexOf(normSearch, idx + 1) === -1) {
      // Unique match on the normalized text — map back to the original span by line count.
      const before = normOut.slice(0, idx).split("\n").length - 1; // lines before match
      const span = normSearch.split("\n").length;
      const lines = out.split("\n");
      lines.splice(before, span, ...b.replace.split("\n"));
      out = lines.join("\n");
      continue;
    }
    return null; // couldn't place this block → give up, caller regenerates in full
  }
  return out;
}
