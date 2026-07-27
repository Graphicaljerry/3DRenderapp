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
      <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#498a6f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" />
        <path d="M3 7 12 12 21 7" />
        <path d="M12 12V22" />
      </svg>
    </div>
  );
}

// Shows the real error instead of a blank white screen if anything throws while rendering.
// Styling lives in styles.css (.crash) so it follows the app theme — inline light-mode
// hex here used to flash a white full-screen panel over the dark root that the
// index.html pre-paint script had already painted.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err?: Error; copied: boolean }> {
  state: { err?: Error; copied: boolean } = { copied: false };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error) {
    console.error(err);
  }
  render() {
    if (this.state.err) {
      const detail = String(this.state.err?.stack || this.state.err?.message || this.state.err);
      return (
        <div className="crash">
          <div className="crash-inner">
            <h2>Something went wrong loading Moldable</h2>
            <p>Copy this if you need help; then click Reload.</p>
            <pre>{detail}</pre>
            <div className="crash-actions">
              <button className="reload" onClick={() => location.reload()}>Reload</button>
              {/* The copy above tells the user to "copy this" — so give them the button. */}
              <button
                className="copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(detail).then(
                    () => this.setState({ copied: true }),
                    () => {},
                  );
                }}
              >
                {this.state.copied ? "Copied" : "Copy details"}
              </button>
            </div>
          </div>
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
