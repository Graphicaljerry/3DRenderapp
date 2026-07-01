import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Viewer, type ViewerHandle } from "./Viewer";
import { buildGeometry } from "./build";
import { parseSpec, type ModelSpec } from "./spec";
import { generateSpecText, MODELS, type ApiMsg } from "./anthropic";
import { EXAMPLE_SPEC } from "./example";

type ChatMsg = { role: "user" | "assistant"; text: string; error?: boolean };
type Status = "idle" | "generating";
const KEY_LS = "moldable_key";
const MODEL_LS = "moldable_model";

const SUGGESTIONS = [
  "a 60×40 mm bracket, 4 mm thick, with two 4 mm holes",
  "a phone stand angled at 60 degrees",
  "a 22 mm broom-handle wall mount",
];

export default function App() {
  const [key, setKey] = useState<string>(() => localStorage.getItem(KEY_LS) ?? "");
  const [model, setModel] = useState<string>(() => localStorage.getItem(MODEL_LS) ?? MODELS[0].id);
  const [entered, setEntered] = useState<boolean>(() => !!localStorage.getItem(KEY_LS));

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const apiHistory = useRef<ApiMsg[]>([]);
  const [spec, setSpec] = useState<ModelSpec | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [dims, setDims] = useState<{ x: number; y: number; z: number } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [tab, setTab] = useState<"3d" | "code">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState("");
  const viewer = useRef<ViewerHandle>(null);

  function saveKey(k: string, m: string) {
    localStorage.setItem(KEY_LS, k.trim());
    localStorage.setItem(MODEL_LS, m);
    setKey(k.trim());
    setModel(m);
    setEntered(true);
    setShowSettings(false);
  }

  function loadSpec(s: ModelSpec) {
    const { geometry: g, dims: d } = buildGeometry(s);
    setSpec(s);
    setGeometry(g);
    setDims(d);
  }

  function loadExample() {
    try {
      loadSpec(EXAMPLE_SPEC);
      setMessages([{ role: "assistant", text: EXAMPLE_SPEC.summary ?? "Loaded the example." }]);
      apiHistory.current = [{ role: "assistant", content: JSON.stringify(EXAMPLE_SPEC) }];
      setEntered(true);
    } catch (e) {
      alert("Failed to build example: " + (e as Error).message);
    }
  }

  async function send(prompt: string) {
    const p = prompt.trim();
    if (!p || status === "generating") return;
    if (!key) {
      setShowSettings(true);
      return;
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", text: p }]);
    setStatus("generating");

    const base: ApiMsg[] = [...apiHistory.current, { role: "user", content: p }];
    try {
      let text = await generateSpecText(key, model, base);
      let parsed: ModelSpec;
      try {
        parsed = parseSpec(text);
      } catch {
        // one self-heal retry
        const retry: ApiMsg[] = [
          ...base,
          { role: "assistant", content: text },
          { role: "user", content: "That was not valid JSON for the schema. Reply with ONLY the JSON object." },
        ];
        text = await generateSpecText(key, model, retry);
        parsed = parseSpec(text);
      }
      loadSpec(parsed); // may throw on bad geometry
      apiHistory.current = [...base, { role: "assistant", content: text }];
      setMessages((m) => [...m, { role: "assistant", text: parsed.summary ?? `Built “${parsed.name}”.` }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: "⚠ " + (e as Error).message, error: true }]);
    } finally {
      setStatus("idle");
    }
  }

  const specJson = useMemo(() => (spec ? JSON.stringify(spec, null, 2) : ""), [spec]);

  if (!entered) {
    return <KeyCard model={model} onContinue={saveKey} onExample={loadExample} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <CubeMark />
          <span className="wordmark">Moldable</span>
          <span className="lite">lite</span>
          <span className="sep">/</span>
          <span className="project">{spec?.name ?? "Untitled part"}</span>
        </div>
        <div className="topbar-right">
          <span className="pill">Engine · Parametric</span>
          <button className="ghost" onClick={() => setShowSettings(true)}>
            {key ? "Settings" : "Add API key"}
          </button>
        </div>
      </header>

      <main className="split">
        <section className="chat">
          <div className="messages">
            {messages.length === 0 && (
              <div className="empty">
                <p className="empty-q">What do you want to make?</p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role} ${m.error ? "err" : ""}`}>
                <span className="who">{m.role === "user" ? "You" : "Moldable"}</span>
                <div className="bubble">{m.text}</div>
              </div>
            ))}
            {status === "generating" && (
              <div className="msg assistant">
                <span className="who">Moldable</span>
                <div className="bubble muted">Thinking…</div>
              </div>
            )}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={key ? "Describe a part, or a change…" : "Add your API key to start…"}
            />
            <button type="submit" className="send" disabled={status === "generating"}>↑</button>
          </form>
        </section>

        <section className="viewer">
          <div className="viewer-head">
            <div className="tabs">
              <button className={tab === "3d" ? "on" : ""} onClick={() => setTab("3d")}>3D View</button>
              <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>Spec</button>
            </div>
            {tab === "3d" && (
              <div className="viewer-tools">
                <button className="ghost sm" onClick={() => setWireframe((w) => !w)}>{wireframe ? "Solid" : "Wireframe"}</button>
                <button className="ghost sm" onClick={() => viewer.current?.resetView()}>Reset view</button>
              </div>
            )}
          </div>

          <div className="viewer-body">
            <div style={{ display: tab === "3d" ? "block" : "none", height: "100%" }}>
              <Viewer ref={viewer} geometry={geometry} wireframe={wireframe} />
              {!geometry && <div className="viewer-empty">Describe something to see it here.</div>}
            </div>
            {tab === "code" && (
              <pre className="code">{specJson || "// No model yet."}</pre>
            )}
          </div>

          <div className="statusbar">
            <span className="dims">{dims ? `${dims.x} × ${dims.y} × ${dims.z} mm` : "—"}</span>
            <span className={`fits ${dims && dims.x <= 256 && dims.y <= 256 && dims.z <= 256 ? "ok" : "no"}`}>
              {dims ? (dims.x <= 256 && dims.y <= 256 && dims.z <= 256 ? "fits bed 256³ ✓" : "larger than 256³ bed") : ""}
            </span>
            <button className="primary" disabled={!geometry} onClick={() => viewer.current?.exportSTL(spec?.name ?? "model")}>
              Export STL
            </button>
          </div>
        </section>
      </main>

      {showSettings && (
        <SettingsModal
          initialKey={key}
          initialModel={model}
          onSave={saveKey}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function KeyCard({
  model,
  onContinue,
  onExample,
}: {
  model: string;
  onContinue: (k: string, m: string) => void;
  onExample: () => void;
}) {
  const [k, setK] = useState("");
  const [m, setM] = useState(model);
  return (
    <div className="gate">
      <div className="card">
        <div className="brand big">
          <CubeMark />
          <span className="wordmark">Moldable</span>
          <span className="lite">lite</span>
        </div>
        <h1>Turn a description into a 3D-printable model.</h1>
        <label>Anthropic API key</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="primary block" disabled={!k.trim()} onClick={() => onContinue(k, m)}>Continue</button>
        <p className="fine">No account. Your key stays in this browser (localStorage), sent only to Anthropic.</p>
        <button className="link" onClick={onExample}>Try the built-in example first — zero API spend →</button>
      </div>
    </div>
  );
}

function SettingsModal({
  initialKey,
  initialModel,
  onSave,
  onClose,
}: {
  initialKey: string;
  initialModel: string;
  onSave: (k: string, m: string) => void;
  onClose: () => void;
}) {
  const [k, setK] = useState(initialKey);
  const [m, setM] = useState(initialModel);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Settings</h2>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <label>Anthropic API key</label>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" />
        <label>Model</label>
        <select value={m} onChange={(e) => setM(e.target.value)}>
          {MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button className="primary block" onClick={() => onSave(k, m)}>Save</button>
        <p className="fine">Stored only in this browser. Clear it any time via your browser's site data.</p>
      </div>
    </div>
  );
}

function CubeMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2f7a70" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 21 7 21 17 12 22 3 17 3 7Z" />
      <path d="M3 7 12 12 21 7" />
      <path d="M12 12V22" />
    </svg>
  );
}
