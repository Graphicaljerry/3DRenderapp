import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

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
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
