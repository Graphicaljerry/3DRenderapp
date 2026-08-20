// Tolerant fenced-block extraction for replicad code. Models sometimes emit a
// partial/wrong block first and a corrected one after — take the LAST complete
// fenced block, which is the most-corrected version.
export function extractJsBlock(text: string): string {
  const all = [...text.matchAll(/```(?:js|javascript|ts|typescript)?[^\n]*\n([\s\S]*?)```/gi)];
  if (all.length) return all[all.length - 1][1].trim();
  const open = text.match(/```(?:js|javascript)?\s*\n([\s\S]*)$/i);
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
