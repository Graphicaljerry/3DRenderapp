import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// First paint before the heavy app: the entry bundle is just React + this file, so
// the boot splash (below) paints in the first frames while the real app chunk —
// three.js, the viewer, the workspace — streams in parallel (the import() starts
// NOW, not when React gets around to the lazy component). The OCCT kernel then
// warms after the app has painted (see the boot effect in App.tsx).
const appPromise = import("./App");
const App = React.lazy(() => appPromise);

// Shown while the app chunk loads. Invisible for the first ~250 ms (CSS delay), so
// fast/cached loads never flash it; on slow networks it replaces a blank screen.
// Theme comes from the index.html pre-paint script (data-theme + backdrop).
function BootSplash() {
  return (
    <div className="boot-splash" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#14b8a6" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" />
        <path d="M3 7 12 12 21 7" />
        <path d="M12 12V22" />
      </svg>
    </div>
  );
}

// Shows the real error instead of a blank white screen if anything throws while rendering.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error) {
    console.error(err);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif", color: "#15181e", maxWidth: 800, margin: "0 auto" }}>
          <h2>Something went wrong loading Moldable</h2>
          <p style={{ color: "#6b7280" }}>Copy this if you need help; then click Reload.</p>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f6f7f9", border: "1px solid #e3e6ea", borderRadius: 8, padding: 12, fontSize: 12 }}>
            {String(this.state.err?.stack || this.state.err?.message || this.state.err)}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 12, padding: "8px 14px", border: "none", borderRadius: 8, background: "#2f7a70", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={<BootSplash />}>
        <App />
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
