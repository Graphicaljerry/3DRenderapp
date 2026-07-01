// Tolerant fenced-block extraction for replicad code.
export function extractJsBlock(text: string): string {
  const tagged = text.match(/```(?:js|javascript|ts|typescript)\s*\n([\s\S]*?)```/i);
  if (tagged) return tagged[1].trim();
  const any = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (any) return any[1].trim();
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
