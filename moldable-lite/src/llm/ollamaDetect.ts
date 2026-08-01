// Local-LLM discovery. No filesystem paths: Ollama (like Docker Desktop) IS its API —
// one probe of the daemon's well-known port answers "is it installed, and which models
// are already downloaded", which is everything the picker needs. Works from the Tauri
// desktop app and from localhost dev out of the box; a HOSTED page can only reach the
// daemon if the user sets OLLAMA_ORIGINS to allow the site (surfaced in Settings).
export interface OllamaInfo {
  models: { name: string; sizeGB: number }[];
}

export async function detectOllama(timeoutMs = 1500): Promise<OllamaInfo | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const r = await fetch("http://localhost:11434/api/tags", { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j: any = await r.json();
    const models = (Array.isArray(j?.models) ? j.models : [])
      .map((m: any) => ({ name: String(m?.name ?? ""), sizeGB: m?.size ? m.size / 1e9 : 0 }))
      .filter((m: { name: string }) => m.name);
    return { models };
  } catch {
    return null; // not installed, not running, or CORS — all mean "no offer"
  }
}
