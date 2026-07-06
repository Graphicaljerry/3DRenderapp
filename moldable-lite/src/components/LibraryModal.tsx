import { IconX } from "./icons";
import { useEffect, useState } from "react";
import { listProjects, deleteProject, duplicateProject } from "../store/projects";
import type { Project } from "../store/types";

export function LibraryModal({ onOpen, onClose, currentId }: { onOpen: (p: Project) => void; onClose: () => void; currentId?: string }) {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await listProjects());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

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
          <div className="lib-grid">
            {items.map((p) => {
              const last = p.versions[p.versions.length - 1];
              return (
                <div key={p.id} className={`lib-card ${p.id === currentId ? "current" : ""}`}>
                  <button className="lib-open" onClick={() => onOpen(p)}>
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
                    <div className="lib-meta">{p.versions.length} version{p.versions.length === 1 ? "" : "s"}</div>
                  </button>
                  <div className="lib-actions">
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
