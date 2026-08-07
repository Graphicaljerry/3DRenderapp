/** A deploy replaces the hashed chunk files, so a tab loaded before it 404s on the
 *  next code-split feature it touches. main.tsx already reloads on Vite's
 *  vite:preloadError — but that event only fires through the preload helper, and a
 *  leaf chunk with no deps imports directly (how "Split failed: Failed to fetch
 *  dynamically imported module" still reached a user on v345). This is the same
 *  reload-once, callable from any dynamic import's catch. Returns true when it
 *  reloaded (the caller should stay quiet); false means a real error to report.
 *  Same sessionStorage guard as main.tsx, so the two paths share one budget and a
 *  dead network can't reload-loop. */
export function reloadIfStaleChunk(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  if (!/dynamically imported module|Importing a module script|error loading dynamically/i.test(msg)) return false;
  if (sessionStorage.getItem("moldable_chunk_reload") === "1") return false;
  sessionStorage.setItem("moldable_chunk_reload", "1");
  location.reload();
  return true;
}
