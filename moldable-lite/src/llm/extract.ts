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
