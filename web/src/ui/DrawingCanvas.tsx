import { useEffect, useMemo, useRef, useState } from "react";
import type { Drawing, Shape } from "../core/drawing";
import { BBox, bboxOf, emptyBBox } from "../core/geometry";
import { ptsToPath } from "./common";

interface Props {
  drawing: Drawing;
  shapes: Shape[];
  scale: number;
  excluded: ReadonlySet<number>;
  visibleLayers: ReadonlySet<string>;
  selected: ReadonlySet<number>;
  added: ReadonlySet<number>;
  onShapeClick: (index: number, e: React.MouseEvent) => void;
  onRestoreContour: (index: number) => void;
}

type View = { x: number; y: number; w: number; h: number };

export function DrawingCanvas({ drawing, shapes, scale, excluded, visibleLayers, selected, added, onShapeClick, onRestoreContour }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const scaled = useMemo(
    () =>
      drawing.contours.map((c) => ({
        ...c,
        d: ptsToPath(scale === 1 ? c.pts : c.pts.map((p) => ({ x: p.x * scale, y: p.y * scale })), c.closed),
      })),
    [drawing, scale],
  );

  const fitBox = useMemo((): BBox => {
    const b = emptyBBox();
    drawing.contours.forEach((c, i) => {
      if (!excluded.has(i) && visibleLayers.has(c.layer)) bboxOf(c.pts, b);
    });
    if (!isFinite(b.minX)) drawing.contours.forEach((c) => bboxOf(c.pts, b));
    if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    return { minX: b.minX * scale, minY: b.minY * scale, maxX: b.maxX * scale, maxY: b.maxY * scale };
  }, [drawing, scale, excluded, visibleLayers]);

  const fit = (): View => {
    const w = Math.max(1, fitBox.maxX - fitBox.minX);
    const h = Math.max(1, fitBox.maxY - fitBox.minY);
    const pad = Math.max(w, h) * 0.04;
    return { x: fitBox.minX - pad, y: fitBox.minY - pad, w: w + pad * 2, h: h + pad * 2 };
  };
  const [view, setView] = useState<View>(fit);
  // 도면/배율이 바뀌면 화면 맞춤
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setView(fit()), [drawing.id, scale]);

  // 휠 확대/축소 (passive: false 필요)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const k = Math.exp(e.deltaY * 0.0015);
        const s = Math.max(v.w / r.width, v.h / r.height);
        // preserveAspectRatio=xMidYMid meet 보정
        const ox = (r.width * s - v.w) / 2;
        const oy = (r.height * s - v.h) / 2;
        const mx = v.x - ox + (e.clientX - r.left) * s;
        const my = v.y - oy + (e.clientY - r.top) * s;
        return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, w: v.w * k, h: v.h * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = svgRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) el.setPointerCapture(e.pointerId);
    d.moved = true;
    const r = el.getBoundingClientRect();
    const s = Math.max(d.v.w / r.width, d.v.h / r.height);
    setView({ ...d.v, x: d.v.x - dx * s, y: d.v.y - dy * s });
  };
  const wasDrag = () => !!drag.current?.moved;
  const onPointerUp = () => {
    setTimeout(() => (drag.current = null), 0);
  };

  const unit = Math.max(view.w, view.h);
  const fontSize = unit / 55;
  const labelOf = new Map(shapes.map((s, i) => [s.index, i + 1]));

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="drawing-canvas"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* 원본 선 전체 (흐리게) */}
        <g className="raw-lines">
          {scaled.map((c, i) => {
            if (!visibleLayers.has(c.layer)) return null;
            const ex = excluded.has(i);
            return (
              <path
                key={i}
                d={c.d}
                className={ex ? "excluded" : c.closed ? "closed" : "open"}
                onClick={ex ? () => !wasDrag() && onRestoreContour(i) : undefined}
              >
                {ex && <title>제외된 선 — 클릭하면 복원</title>}
              </path>
            );
          })}
        </g>
        {/* 인식된 형상 */}
        <g className="shapes">
          {shapes.map((s) => {
            const d = [ptsToPath(s.outer, true), ...s.holes.map((h) => ptsToPath(h, true))].join(" ");
            const cls = selected.has(s.index) ? "shape selected" : added.has(s.index) ? "shape added" : "shape";
            return (
              <path
                key={s.index}
                d={d}
                fillRule="evenodd"
                className={cls}
                onClick={(e) => !wasDrag() && onShapeClick(s.index, e)}
              >
                <title>{`#${labelOf.get(s.index)}  ${s.w.toFixed(1)} × ${s.h.toFixed(1)} mm`}</title>
              </path>
            );
          })}
        </g>
        <g className="labels" style={{ fontSize }}>
          {shapes.map((s) => (
            <text key={s.index} x={s.bbox.minX} y={s.bbox.minY - fontSize * 0.3}>
              {labelOf.get(s.index)}
            </text>
          ))}
        </g>
      </svg>
      <div className="canvas-tools">
        <button onClick={() => setView(fit())} title="화면 맞춤">⤢ 맞춤</button>
        <span className="hint">휠: 확대/축소 · 드래그: 이동 · 클릭: 형상 선택</span>
      </div>
    </div>
  );
}
