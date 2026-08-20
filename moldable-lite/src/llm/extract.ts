// Tolerant fenced-block extraction for replicad code.
//
// The block we want is the one that DEFINES main() — not simply the last one. Models
// answering a spec that ends "put these exact values in defaultParams" habitually write
// the program, then recap the parameter object in a second ```js block. Taking the last
// block handed the kernel that recap: valid JavaScript with no main() in it, which came
// back as "Your code must define `function main(replicad, params)`" — the kernel blaming
// the model for a program it had in fact written correctly, one block higher up.
//
// Falling back to the last block preserves the original behaviour for the case that rule
// was written for: a first, wrong attempt followed by a corrected one.
const FENCE = /```[a-z]*[^\n]*\n([\s\S]*?)```/gi;

/** Does this text define a top-level `main` the kernel can reach? Covers the declaration
 *  forms models actually use; `export`-prefixed ones count, since stripModuleSyntax()
 *  turns them into plain declarations before the code is compiled. */
function definesMain(code: string): boolean {
  return /^[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+main\s*\(/m.test(code)
    || /^[ \t]*(?:export\s+)?(?:const|let|var)\s+main\s*=/m.test(code);
}

/** Remove ES-module and CommonJS syntax the sandbox cannot accept.
 *
 *  The kernel compiles the program with `new Function`, which is a script, not a module:
 *  a leading `export` is a hard SyntaxError and `module.exports` is a ReferenceError. A
 *  model that writes `export function main(...)` has written a perfectly good program and
 *  was being failed on a keyword, so strip the wrapper rather than reject the part. */
export function stripModuleSyntax(code: string): string {
  return code
    .replace(/^[ \t]*export\s+default\s+(?=(?:async\s+)?function\s+main\b|class\b)/gm, "")
    .replace(/^[ \t]*export\s+(?=(?:async\s+)?function\b|(?:const|let|var|class)\b)/gm, "")
    .replace(/^[ \t]*export\s+default\s+main\s*;?[ \t]*$/gm, "")
    .replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm, "")
    .replace(/^[ \t]*module\.exports\s*=[^\n;]*;?[ \t]*$/gm, "");
}

export function extractJsBlock(text: string): string {
  const blocks = [...text.matchAll(FENCE)].map((m) => m[1].trim()).filter(Boolean);
  const withMain = blocks.filter(definesMain);
  if (withMain.length) return withMain[withMain.length - 1];
  if (blocks.length) return blocks[blocks.length - 1];
  const open = text.match(/```[a-z]*[^\n]*\n([\s\S]*)$/i);
  if (open) return open[1].trim();
  return text.trim();
}

// JSON object extraction for the fallback engine.
export function extractJsonObject(text: string): string {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("No JSON object found in the reply.");
  return text.slice(a, b + 1);
}

/** One entry in a conversation being sent to a model — the shape App.tsx builds. */
type Msg = { role: string; content: unknown };

/** Strip superseded programs out of the conversation before it is sent.
 *
 *  Every assistant turn in the history carries the FULL replicad program it wrote, and
 *  the current program travels with the request anyway (in the system prompt's build-log
 *  framing, and verbatim in the user message on the edit path). So a session's fifth edit
 *  was re-billing four dead versions of the same part — for a real cabinet-sized program
 *  that is thousands of input tokens per message, every message, buying nothing: the
 *  model needs to know WHAT it did (the prose and the build log say so), not re-read
 *  code it already replaced.
 *
 *  `keepNewest` keeps the most recent assistant program intact — the full-regen path
 *  relies on it as the code being edited. The edit path passes false, because it embeds
 *  the current program in the user message itself.
 *
 *  Only string assistant content is touched. User turns are never touched: their fenced
 *  blocks are things the USER pasted, which is their message, not our copy. */
export function trimOldPrograms<T extends Msg>(msgs: T[], keepNewest: boolean): T[] {
  // A fresh regex per use: /g regexes are stateful (lastIndex), and sharing one between
  // test() and replace() makes it skip matches in ways that depend on call order.
  const fence = () => /```(?:js|javascript|ts|typescript)?[^\n]*\n[\s\S]*?```/g;
  const carries = (m: Msg) => m.role === "assistant" && typeof m.content === "string" && fence().test(m.content);
  // Oldest first, so trimming the first N-1 code-carrying turns leaves the newest whole.
  let sparable = msgs.filter(carries).length - (keepNewest ? 1 : 0);
  return msgs.map((m) => {
    if (sparable <= 0 || !carries(m)) return m;
    sparable -= 1;
    return { ...m, content: (m.content as string).replace(fence(), "[program omitted — superseded by a later version; the current program travels with this request]") };
  });
}
