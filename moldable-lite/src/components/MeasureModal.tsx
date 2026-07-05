import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconX } from "./icons";

// Turn a coin/card in the photo into real millimetres. All geometry is done in
// the overlay's own pixel space: because the reference line and every measured
// line share that space, the mm ratio is scale-invariant — we never need the
// image's natural resolution. (Assumes a roughly straight-on photo; perspective
// is the honest limit, noted in the UI.)

type Pt = { x: number; y: number };
type Line = { a: Pt; b: Pt };

const REFS: { id: string; label: string; mm: number }[] = [
  { id: "card-long", label: "Credit / ID card — long edge", mm: 85.6 },
  { id: "card-short", label: "Credit / ID card — short edge", mm: 54 },
  { id: "quarter", label: "US quarter", mm: 24.26 },
  { id: "penny", label: "US penny", mm: 19.05 },
  { id: "euro1", label: "1 euro coin", mm: 23.25 },
  { id: "aa", label: "AA battery — length", mm: 50.5 },
  { id: "custom", label: "Custom size…", mm: 0 },
];

const len = (l: Line) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
const mid = (l: Line) => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });
const r1 = (n: number) => Math.round(n * 10) / 10;

export function MeasureModal({ imageUrl, onApply, onClose }: { imageUrl: string; onApply: (text: string) => void; onClose: () => void }) {
  const [step, setStep] = useState<"scale" | "measure">("scale");
  const [refId, setRefId] = useState("card-long");
  const [customMm, setCustomMm] = useState(20);
  const [scaleLine, setScaleLine] = useState<Line | null>(null);
  const [measures, setMeasures] = useState<{ id: number; line: Line; label: string }[]>([]);
  const [preview, setPreview] = useState<Line | null>(null);
  const draft = useRef<Pt | null>(null);
  const nextId = useRef(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const refMm = refId === "custom" ? customMm : REFS.find((r) => r.id === refId)!.mm;
  const pxPerMm = scaleLine && refMm > 0 ? len(scaleLine) / refMm : 0;
  const toMm = (l: Line) => (pxPerMm > 0 ? len(l) / pxPerMm : 0);

  const ptOf = (e: ReactPointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draft.current = ptOf(e);
    setPreview({ a: draft.current, b: draft.current });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!draft.current) return;
    setPreview({ a: draft.current, b: ptOf(e) });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!draft.current) return;
    const line = { a: draft.current, b: ptOf(e) };
    draft.current = null;
    setPreview(null);
    if (len(line) < 6) return; // ignore a stray tap
    if (step === "scale") setScaleLine(line);
    else setMeasures((m) => [...m, { id: nextId.current++, line, label: String.fromCharCode(65 + m.length) }]);
  };

  const canInsert = pxPerMm > 0 && measures.length > 0;
  function insert() {
    const refLabel = refId === "custom" ? `${refMm} mm reference` : REFS.find((r) => r.id === refId)!.label;
    const list = measures.map((m) => `${m.label} = ${r1(toMm(m.line))} mm`).join(", ");
    onApply(`Measured from the photo — treat as ground truth (scale: ${refLabel} = ${refMm} mm): ${list}.`);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="measure" onClick={(e) => e.stopPropagation()}>
        <div className="measure-head">
          <span>Measure from photo</span>
          <button className="x" aria-label="Close" onClick={onClose}><IconX /></button>
        </div>

        <div className="measure-steps">
          <button className={step === "scale" ? "on" : ""} onClick={() => setStep("scale")}>1 · Set scale{scaleLine ? " ✓" : ""}</button>
          <button className={step === "measure" ? "on" : ""} disabled={!scaleLine} onClick={() => setStep("measure")}>2 · Measure</button>
        </div>

        <div className="measure-stage">
          <img src={imageUrl} alt="reference" draggable={false} />
          <svg ref={svgRef} className="measure-svg" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            {scaleLine && (
              <g className="ln scale">
                <line x1={scaleLine.a.x} y1={scaleLine.a.y} x2={scaleLine.b.x} y2={scaleLine.b.y} />
                <text x={mid(scaleLine).x} y={mid(scaleLine).y - 6}>{refMm} mm</text>
              </g>
            )}
            {measures.map((m) => (
              <g className="ln meas" key={m.id}>
                <line x1={m.line.a.x} y1={m.line.a.y} x2={m.line.b.x} y2={m.line.b.y} />
                <text x={mid(m.line).x} y={mid(m.line).y - 6}>{m.label} · {r1(toMm(m.line))} mm</text>
              </g>
            ))}
            {preview && <line className="ln-preview" x1={preview.a.x} y1={preview.a.y} x2={preview.b.x} y2={preview.b.y} />}
          </svg>
        </div>

        {step === "scale" ? (
          <div className="measure-panel">
            <p className="fine">Drag a line across a known object in the photo, then tell me what it is.</p>
            <div className="measure-row">
              <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                {REFS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              {refId === "custom" && (
                <input type="number" min={1} step={0.1} value={customMm} onChange={(e) => setCustomMm(+e.target.value)} aria-label="Reference size in mm" />
              )}
              <span className="measure-scale">{pxPerMm > 0 ? `scale set (${r1(refMm)} mm)` : "no scale yet"}</span>
            </div>
          </div>
        ) : (
          <div className="measure-panel">
            <p className="fine">Drag a line across each dimension you need. Rename or delete below.</p>
            {measures.length === 0 && <p className="fine muted-line">No measurements yet.</p>}
            {measures.map((m) => (
              <div className="measure-item" key={m.id}>
                <input value={m.label} onChange={(e) => setMeasures((all) => all.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))} aria-label="Measurement label" />
                <span className="measure-mm">{r1(toMm(m.line))} mm</span>
                <button className="x" aria-label="Delete measurement" onClick={() => setMeasures((all) => all.filter((x) => x.id !== m.id))}><IconX size={12} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <span className="fine measure-note">Photograph straight-on for best accuracy.</span>
          <button className="ghost sm" onClick={onClose}>Cancel</button>
          <button className="primary sm" disabled={!canInsert} onClick={insert}>Use these measurements</button>
        </div>
      </div>
    </div>
  );
}
