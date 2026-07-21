import { IconX } from "./icons";
import { useEffect, useMemo, useState } from "react";
import { listProjects, deleteProject, duplicateProject, putProject } from "../store/projects";
import type { Project } from "../store/types";

type SortId = "recent" | "oldest" | "name" | "versions";

/** Text a search query runs against: name + version summaries + the mesh prompt. */
function haystack(p: Project): string {
  return [p.name, p.genSource?.prompt ?? "", ...p.versions.map((v) => v.summary)].join(" ").toLowerCase();
}

export function LibraryModal({ onOpen, onClose, currentId, refreshTick }: { onOpen: (p: Project) => void; onClose: () => void; currentId?: string; refreshTick?: number }) {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortId>("recent");
  const [engineF, setEngineF] = useState<"all" | "cad" | "mesh">("all");
  const [folder, setFolder] = useState<string | null>(null); // null = all · "" = unfiled · name = that folder
  // Bulk selection: in Select mode, tapping a card toggles it instead of opening.
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    try {
      setItems(await listProjects());
    } finally {
      setLoading(false);
    }
  }
  // refreshTick bumps when the app finishes upgrading stale thumbnails in the
  // background — re-query so the new studio shots appear without reopening.
  useEffect(() => {
    void refresh();
  }, [refreshTick]);

  const folders = useMemo(() => [...new Set(items.map((i) => i.folder).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = items
      .filter((p) => (needle ? haystack(p).includes(needle) : true))
      .filter((p) => (engineF === "all" ? true : engineF === "mesh" ? p.engine === "generative" : p.engine !== "generative"))
      .filter((p) => (folder === null ? true : folder === "" ? !p.folder : p.folder === folder));
    const by: Record<SortId, (a: Project, b: Project) => number> = {
      recent: (a, b) => b.updatedAt - a.updatedAt,
      oldest: (a, b) => a.updatedAt - b.updatedAt,
      name: (a, b) => a.name.localeCompare(b.name),
      versions: (a, b) => b.versions.length - a.versions.length,
    };
    return [...list].sort(by[sort]);
  }, [items, q, sort, engineF, folder]);

  /** Move a project into a folder ("" = unfiled, "__new__" prompts for a name). */
  async function moveTo(p: Project, dest: string) {
    let name: string | undefined = dest || undefined;
    if (dest === "__new__") {
      const typed = prompt("New folder name:")?.trim().slice(0, 40);
      if (!typed) return;
      name = typed;
    }
    await putProject({ ...p, folder: name, updatedAt: Date.now() }); // updatedAt so it syncs across devices
    void refresh();
  }

  const folderCount = (f: string | null) =>
    f === null ? items.length : f === "" ? items.filter((i) => !i.folder).length : items.filter((i) => i.folder === f).length;

  function toggleSel(id: string) {
    setSelIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function exitSelect() {
    setSelMode(false);
    setSelIds(new Set());
  }
  async function deleteSelected() {
    if (!selIds.size) return;
    if (!confirm(`Delete ${selIds.size} model${selIds.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    for (const id of selIds) await deleteProject(id);
    exitSelect();
    void refresh();
  }
  /** Bulk move: same semantics as the per-card select ("" unfiles, "__new__" prompts once). */
  async function moveSelected(dest: string) {
    if (!selIds.size) return;
    let name: string | undefined = dest || undefined;
    if (dest === "__new__") {
      const typed = prompt("New folder name:")?.trim().slice(0, 40);
      if (!typed) return;
      name = typed;
    }
    for (const id of selIds) {
      const p = items.find((i) => i.id === id);
      if (p) await putProject({ ...p, folder: name, updatedAt: Date.now() });
    }
    exitSelect();
    void refresh();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Project library</h2>
          <button className="x" onClick={onClose}><IconX size={16} /></button>
        </div>
        {loading ? (
          <p className="fine">Loading…</p>
        ) : items.length === 0 ? (
          <p className="fine">No saved projects yet. Describe something and it's saved here automatically.</p>
        ) : (
          <>
            <div className="lib-toolbar">
              <input
                className="lib-search"
                type="search"
                placeholder="Search models…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search models"
              />
              <select value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Sort models" title="Sort">
                <option value="recent">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name A–Z</option>
                <option value="versions">Most versions</option>
              </select>
              <select value={engineF} onChange={(e) => setEngineF(e.target.value as "all" | "cad" | "mesh")} aria-label="Filter by engine" title="Filter by engine">
                <option value="all">All engines</option>
                <option value="cad">Precise (CAD)</option>
                <option value="mesh">Generative (mesh)</option>
              </select>
              <button className={`ghost sm${selMode ? " on" : ""}`} onClick={() => (selMode ? exitSelect() : setSelMode(true))} title="Select several models to delete or move them together">
                {selMode ? "Done" : "Select"}
              </button>
              <span className="lib-count" role="status">
                {shown.length === items.length ? `${items.length} model${items.length === 1 ? "" : "s"}` : `${shown.length} of ${items.length} models`}
              </span>
            </div>
            {selMode && (
              <div className="lib-bulk" role="toolbar" aria-label="Bulk actions">
                <span className="lib-bulk-count">{selIds.size} selected</span>
                <button className="ghost sm" onClick={() => setSelIds(new Set(shown.map((p) => p.id)))}>Select all shown</button>
                <button className="ghost sm" disabled={!selIds.size} onClick={() => setSelIds(new Set())}>Clear</button>
                <select
                  className="lib-move"
                  value=""
                  disabled={!selIds.size}
                  onChange={(e) => { if (e.target.value) void moveSelected(e.target.value === "__none__" ? "" : e.target.value); e.target.value = ""; }}
                  aria-label="Move selected to folder"
                  title="Move the selected models to a folder"
                >
                  <option value="" disabled>Move to…</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>📁 {f}</option>
                  ))}
                  <option value="__new__">＋ New folder…</option>
                  <option value="__none__">No folder</option>
                </select>
                <button className="ghost sm danger" disabled={!selIds.size} onClick={() => void deleteSelected()}>
                  Delete selected{selIds.size ? ` (${selIds.size})` : ""}
                </button>
              </div>
            )}
            {(folders.length > 0 || folder !== null) && (
              <div className="lib-folders" role="tablist" aria-label="Folders">
                <button className={`lib-chip${folder === null ? " on" : ""}`} onClick={() => setFolder(null)}>All ({folderCount(null)})</button>
                {folders.map((f) => (
                  <button key={f} className={`lib-chip${folder === f ? " on" : ""}`} onClick={() => setFolder(folder === f ? null : f)}>
                    📁 {f} ({folderCount(f)})
                  </button>
                ))}
                {items.some((i) => !i.folder) && (
                  <button className={`lib-chip${folder === "" ? " on" : ""}`} onClick={() => setFolder(folder === "" ? null : "")}>Unfiled ({folderCount("")})</button>
                )}
              </div>
            )}
            {shown.length === 0 ? (
              <p className="fine">Nothing matches — clear the search or filters.</p>
            ) : (
              <div className="lib-grid">
                {shown.map((p) => {
                  const last = p.versions[p.versions.length - 1];
                  const selected = selIds.has(p.id);
                  return (
                    <div key={p.id} className={`lib-card ${p.id === currentId ? "current" : ""}${selected ? " sel" : ""}`}>
                      <button
                        className="lib-open"
                        aria-pressed={selMode ? selected : undefined}
                        onClick={() => (selMode ? toggleSel(p.id) : onOpen(p))}
                      >
                        {selMode && <span className={`lib-check${selected ? " on" : ""}`} aria-hidden="true">{selected ? "✓" : ""}</span>}
                        <div className="lib-thumb">
                          {p.thumb ? (
                            <img src={p.thumb} alt="" loading="lazy" />
                          ) : (
                            <span className="lib-thumb-empty" aria-hidden="true">
                              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" /><path d="M3 7 12 12 21 7" /><path d="M12 12V22" />
                              </svg>
                            </span>
                          )}
                        </div>
                        <div className="lib-name">{p.name}</div>
                        <div className="lib-meta">
                          {new Date(p.updatedAt).toLocaleString()} · {p.engine}
                          {last?.dims ? ` · ${last.dims.x}×${last.dims.y}×${last.dims.z} mm` : ""}
                        </div>
                        <div className="lib-meta">
                          {p.versions.length} version{p.versions.length === 1 ? "" : "s"}
                          {p.folder ? ` · 📁 ${p.folder}` : ""}
                        </div>
                      </button>
                      {!selMode && <div className="lib-actions">
                        <button className="ghost sm" onClick={() => onOpen(p)}>Open</button>
                        <button
                          className="ghost sm"
                          onClick={async () => {
                            await duplicateProject(p.id);
                            void refresh();
                          }}
                        >
                          Duplicate
                        </button>
                        <select
                          className="lib-move"
                          value={p.folder ?? ""}
                          onChange={(e) => void moveTo(p, e.target.value)}
                          aria-label={`Folder for ${p.name}`}
                          title="Move to a folder"
                        >
                          <option value="">No folder</option>
                          {folders.map((f) => (
                            <option key={f} value={f}>📁 {f}</option>
                          ))}
                          <option value="__new__">＋ New folder…</option>
                        </select>
                        <button
                          className="ghost sm danger"
                          onClick={async () => {
                            if (confirm(`Delete “${p.name}”? This can't be undone.`)) {
                              await deleteProject(p.id);
                              void refresh();
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
