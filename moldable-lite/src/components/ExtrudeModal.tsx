import { useState } from "react";
import { IconX } from "./icons";
import { svgInfo } from "../svg/extrude";

// Drop an SVG → set its real size + thickness → a printable solid. No AI call.
export function ExtrudeModal({
  svgText,
  svgUrl,
  name,
  onCreate,
  onClose,
}: {
  svgText: string;
  svgUrl: string;
  name: string;
  onCreate: (sizeMm: number, heightMm: number) => void;
  onClose: () => void;
}) {
  const info = svgInfo(svgText);
  const [sizeMm, setSizeMm] = useState(50);
  const [heightMm, setHeightMm] = useState(3);

  const aspect = info.w > 0 && info.h > 0 ? info.h / info.w : 1;
  const longIsW = info.w >= info.h;
  const xMm = longIsW ? sizeMm : sizeMm * (info.w / (info.h || 1));
  const yMm = longIsW ? sizeMm * aspect : sizeMm;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const canCreate = info.shapeCount > 0 && sizeMm > 0 && heightMm > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="measure extrude" onClick={(e) => e.stopPropagation()}>
        <div className="measure-head">
          <span>Extrude SVG → 3D</span>
          <button className="x" aria-label="Close" onClick={onClose}><IconX /></button>
        </div>

        <div className="extrude-preview">
          <img src={svgUrl} alt={name} />
        </div>

        {info.shapeCount === 0 ? (
          <p className="fine no-line">No filled shapes found in this SVG. Give your paths a solid fill (not just a stroke/outline), then drop it again.</p>
        ) : (
          <>
            <div className="extrude-row">
              <label>Longest side
                <span className="ex-field"><input type="number" min={1} step={1} value={sizeMm} onChange={(e) => setSizeMm(+e.target.value)} /> mm</span>
              </label>
              <label>Thickness
                <span className="ex-field"><input type="number" min={0.2} step={0.2} value={heightMm} onChange={(e) => setHeightMm(+e.target.value)} /> mm</span>
              </label>
            </div>
            <p className="fine">Result ≈ {r1(xMm)} × {r1(yMm)} × {r1(heightMm)} mm · {info.shapeCount} shape{info.shapeCount === 1 ? "" : "s"}. Holes in the SVG are kept.</p>
          </>
        )}

        <div className="modal-actions">
          <button className="ghost sm" onClick={onClose}>Cancel</button>
          <button className="primary sm" disabled={!canCreate} onClick={() => onCreate(sizeMm, heightMm)}>Create 3D model</button>
        </div>
      </div>
    </div>
  );
}
