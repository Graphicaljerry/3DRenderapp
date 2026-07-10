import { IconX } from "./icons";
import { TEMPLATES, templateThumb, type Template } from "../cad/templates";

function Thumb({ t }: { t: Template }) {
  const src = templateThumb(t.id);
  return (
    <div className="tpl-thumb">
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span className="tpl-thumb-empty" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" /><path d="M3 7 12 12 21 7" /><path d="M12 12V22" />
          </svg>
        </span>
      )}
    </div>
  );
}

/** Full gallery: every template as a photo card. One tap → parametric model, no AI, no key. */
export function TemplatesModal({ onPick, onClose, busy }: { onPick: (t: Template) => void; onClose: () => void; busy: boolean }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Templates</h2>
          <button className="x" onClick={onClose} aria-label="Close templates"><IconX size={16} /></button>
        </div>
        <p className="fine">Common prints, ready to go — tap one and it builds instantly, no AI call, no key. Every dimension stays live: drag the sliders or just ask for changes.</p>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="tpl-card" disabled={busy} onClick={() => onPick(t)} title={`Build the ${t.name.toLowerCase()} template`}>
              <Thumb t={t} />
              <span className="tpl-name">{t.name}</span>
              <span className="tpl-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Empty-chat teaser: the first few templates + a door to the full gallery. */
export function TemplateStrip({ onPick, onMore, busy }: { onPick: (t: Template) => void; onMore: () => void; busy: boolean }) {
  return (
    <div className="tpl-strip">
      <div className="tpl-strip-grid">
        {TEMPLATES.slice(0, 4).map((t) => (
          <button key={t.id} className="tpl-card sm" disabled={busy} onClick={() => onPick(t)} title={`Build the ${t.name.toLowerCase()} template`}>
            <Thumb t={t} />
            <span className="tpl-name">{t.name}</span>
          </button>
        ))}
      </div>
      <button className="tpl-more" onClick={onMore}>
        All {TEMPLATES.length} templates — one tap, no key needed →
      </button>
    </div>
  );
}
