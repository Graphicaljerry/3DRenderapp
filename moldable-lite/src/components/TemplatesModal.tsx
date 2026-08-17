import { IconX } from "./icons";
import { useEscape } from "../lib/useEscape";
import { TEMPLATES, templateThumb, type Template } from "../cad/templates";
import { SCULPT_GLYPHS } from "../assets/templates/sculptGlyphs";

function Thumb({ t }: { t: Template }) {
  // Parts show their REAL render (captured from this app's own kernel). Sculpts show a
  // drawing: the engine returns something different every run, so a photo-real preview
  // would promise a specific result the card can't deliver.
  const glyph = t.kind === "mesh" ? SCULPT_GLYPHS[t.id] : undefined;
  const src = glyph ? undefined : templateThumb(t.id);
  return (
    <div className={`tpl-thumb${glyph ? " sculpt" : ""}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span className="tpl-thumb-empty" aria-hidden="true">
          {glyph ?? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" /><path d="M3 7 12 12 21 7" /><path d="M12 12V22" />
            </svg>
          )}
        </span>
      )}
    </div>
  );
}

/** Full gallery: every template as a photo card. One tap → parametric model, no AI, no key. */
export function TemplatesModal({ onPick, onClose, busy }: { onPick: (t: Template) => void; onClose: () => void; busy: boolean }) {
  useEscape(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Templates</h2>
          <button className="x" onClick={onClose} aria-label="Close templates"><IconX size={16} /></button>
        </div>
        <p className="fine">
          <b>Parts</b> build instantly — no AI call, no key — and every dimension stays live: drag it in
          Adjust or just ask for changes. <b>Sculpts</b> are shapes CAD can't hold, so they run on the
          mesh engine: one generation each, at whatever your chosen engine charges.
        </p>
        {(["cad", "mesh"] as const).map((kind) => (
          <section key={kind} className="tpl-sect">
            <h3 className="tpl-sect-title">
              {kind === "cad" ? "Parts — exact, editable, free" : "Sculpts — organic shapes, one AI generation each"}
            </h3>
            <div className="tpl-grid">
              {TEMPLATES.filter((t) => t.kind === kind).map((t) => (
                <button key={t.id} className="tpl-card" disabled={busy} onClick={() => onPick(t)}
                  title={kind === "cad" ? `Build the ${t.name.toLowerCase()} — instant, free` : `Sculpt the ${t.name.toLowerCase()} on the mesh engine`}>
                  <Thumb t={t} />
                  <span className="tpl-name">{t.name}</span>
                  <span className="tpl-blurb">{t.blurb}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Empty-chat teaser: the first few templates + a door to the full gallery. */
export function TemplateStrip({ onPick, onMore, busy }: { onPick: (t: Template) => void; onMore: () => void; busy: boolean }) {
  return (
    <div className="tpl-strip">
      <div className="tpl-strip-grid">
        {TEMPLATES.filter((t) => t.kind === "cad").slice(0, 4).map((t) => (
          <button key={t.id} className="tpl-card sm" disabled={busy} onClick={() => onPick(t)} title={`Build the ${t.name.toLowerCase()} template`}>
            <Thumb t={t} />
            <span className="tpl-name">{t.name}</span>
          </button>
        ))}
      </div>
      <button className="tpl-more" onClick={onMore}>
        All {TEMPLATES.length} templates — parts and sculpts
      </button>
    </div>
  );
}
