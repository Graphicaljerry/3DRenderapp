import { useState } from "react";
import { IconX } from "./icons";
import { svgInfo } from "../svg/extrude";

export type SvgMode = "extrude" | "revolve" | "emboss" | "attach";
export interface SvgParams { sizeMm: number; heightMm: number; baseMm: number; reliefMm: number; recessed: boolean }

// Drop an SVG → turn it into a solid three ways: straight extrude, revolve
// (lathe a profile), or emboss (art on a base plate). No AI call.
export function ExtrudeModal({
  svgText, svgUrl, name, hasModel, onCreate, onClose,
}: {
  svgText: string; svgUrl: string; name: string;
  hasModel: boolean; // a model is on the canvas → offer "Add to model" (attachment)
  onCreate: (mode: SvgMode, params: SvgParams) => void;
  onClose: () => void;
}) {
  const info = svgInfo(svgText);
  const [mode, setMode] = useState<SvgMode>("extrude");
  const [sizeMm, setSizeMm] = useState(50);
  const [heightMm, setHeightMm] = useState(3);
  const [baseMm, setBaseMm] = useState(2);
  const [reliefMm, setReliefMm] = useState(1.5);
  const [recessed, setRecessed] = useState(false);

  const aspect = info.w > 0 && info.h > 0 ? info.h / info.w : 1;
  const longIsW = info.w >= info.h;
  const xMm = longIsW ? sizeMm : sizeMm * (info.w / (info.h || 1));
  const yMm = longIsW ? sizeMm * aspect : sizeMm;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const canCreate = info.shapeCount > 0 && sizeMm > 0 && (mode !== "extrude" || heightMm > 0);

  const num = (v: number, set: (n: number) => void, min: number, step: number, label: string) => (
    <label>{label}<span className="ex-field"><input type="number" min={min} step={step} value={v} onChange={(e) => set(+e.target.value)} /> mm</span></label>
  );

  const preview = mode === "extrude" || mode === "attach"
    ? `≈ ${r1(xMm)} × ${r1(yMm)} × ${r1(heightMm)} mm · holes kept`
    : mode === "revolve"
      ? `≈ ${r1(sizeMm)} mm tall, revolved around the left edge`
      : `plate ≈ ${r1(xMm)} × ${r1(yMm)} mm · ${recessed ? "recessed" : "raised"} ${r1(reliefMm)} mm on a ${r1(baseMm)} mm base`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="measure extrude" onClick={(e) => e.stopPropagation()}>
        <div className="measure-head">
          <span>SVG → 3D</span>
          <button className="x" aria-label="Close" onClick={onClose}><IconX /></button>
        </div>

        <div className="measure-steps">
          {(["extrude", "revolve", "emboss", ...(hasModel ? (["attach"] as SvgMode[]) : [])] as SvgMode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} title={m === "attach" ? "Extrude the SVG and place it ON the current model as a movable object — position it, then Merge" : undefined} onClick={() => setMode(m)}>{m === "attach" ? "Add to model" : m[0].toUpperCase() + m.slice(1)}</button>
          ))}
        </div>

        <div className="extrude-preview"><img src={svgUrl} alt={name} /></div>

        {info.shapeCount === 0 ? (
          <p className="fine no-line">No filled shapes found. Give your paths a solid fill (not just a stroke), then drop it again.</p>
        ) : (
          <>
            <div className="extrude-row">
              {mode === "revolve"
                ? num(sizeMm, setSizeMm, 1, 1, "Height")
                : num(sizeMm, setSizeMm, 1, 1, "Longest side")}
              {(mode === "extrude" || mode === "attach") && num(heightMm, setHeightMm, 0.2, 0.2, "Thickness")}
              {mode === "emboss" && num(baseMm, setBaseMm, 0.4, 0.2, "Base")}
              {mode === "emboss" && num(reliefMm, setReliefMm, 0.2, 0.2, "Relief")}
            </div>
            {mode === "emboss" && (
              <div className="measure-steps" style={{ marginTop: 8 }}>
                <button className={!recessed ? "on" : ""} onClick={() => setRecessed(false)}>Raised</button>
                <button className={recessed ? "on" : ""} onClick={() => setRecessed(true)}>Recessed</button>
              </div>
            )}
            <p className="fine">
              {preview}
              {mode === "revolve" && " · best with a side-profile SVG"}
            </p>
          </>
        )}

        <div className="modal-actions">
          <button className="ghost sm" onClick={onClose}>Cancel</button>
          <button className="primary sm" disabled={!canCreate} onClick={() => onCreate(mode, { sizeMm, heightMm, baseMm, reliefMm, recessed })}>Create 3D model</button>
        </div>
      </div>
    </div>
  );
}
