// DXF(ASCII) 불러오기
import DxfParser from "dxf-parser";
import type { IDxf, IEntity, IPoint } from "dxf-parser";
import { Contour, Drawing, DrawingText, joinContours } from "../drawing";
import { Matrix, Pt, apply, arcPoints, multiply } from "../geometry";

// $INSUNITS 코드 → mm
const INSUNITS: Record<number, [number, string]> = {
  1: [25.4, "inch"],
  2: [304.8, "feet"],
  4: [1, "mm"],
  5: [10, "cm"],
  6: [1000, "m"],
  8: [0.0000254, "microinch"],
  9: [0.0254, "mil"],
  10: [914.4, "yard"],
  13: [0.001, "micron"],
  14: [100, "dm"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEntity = IEntity & Record<string, any>;

export function importDxf(text: string, fileName: string): Drawing {
  let dxf: IDxf | null;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch (e) {
    throw new Error("DXF 파일을 해석할 수 없습니다. ASCII DXF로 저장해주세요. (" + (e as Error).message + ")");
  }
  if (!dxf) throw new Error("DXF 파일을 해석할 수 없습니다.");

  const warnings: string[] = [];
  const code = Number(dxf.header?.["$INSUNITS"] ?? 0);
  const unit = INSUNITS[code];
  const k = unit ? unit[0] : 1;
  const unitNote = unit ? `DXF 단위: ${unit[1]}` : "DXF 단위 미지정 → mm로 해석";

  const contours: Contour[] = [];
  const texts: DrawingText[] = [];
  const skipped = new Map<string, number>();
  const base: Matrix = [k, 0, 0, -k, 0, 0]; // y축 뒤집기 (DXF는 y-up)

  const push = (pts: Pt[], closed: boolean, m: Matrix, layer: string) => {
    if (pts.length < 2) return;
    contours.push({ pts: pts.map((p) => apply(m, p.x, p.y)), closed, layer });
  };

  const walk = (entities: AnyEntity[], m: Matrix, parentLayer: string | null, depth: number) => {
    if (depth > 20) return;
    for (const e of entities) {
      const layer = e.layer && !(parentLayer && e.layer === "0") ? String(e.layer) : parentLayer ?? "0";
      const mirror = (e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? 1) < 0;
      const ocs = (pts: Pt[]) => (mirror ? pts.map((p) => ({ x: -p.x, y: p.y })) : pts);
      switch (e.type) {
        case "LINE":
          push(e.vertices.map(xy), false, m, layer);
          break;
        case "LWPOLYLINE":
        case "POLYLINE": {
          if (e.is3dPolygonMesh || e.isPolyfaceMesh) break;
          const closed = !!e.shape;
          push(ocs(bulgePolyline(e.vertices || [], closed)), closed, m, layer);
          break;
        }
        case "CIRCLE":
          push(ocs(arcPoints(e.center.x, e.center.y, e.radius, 0, Math.PI * 2).slice(0, -1)), true, m, layer);
          break;
        case "ARC": {
          const a0 = e.startAngle;
          let a1 = e.endAngle;
          if (a1 <= a0) a1 += Math.PI * 2;
          push(ocs(arcPoints(e.center.x, e.center.y, e.radius, a0, a1)), false, m, layer);
          break;
        }
        case "ELLIPSE": {
          const pts = ellipsePoints(e.center, e.majorAxisEndPoint, e.axisRatio, e.startAngle ?? 0, e.endAngle ?? Math.PI * 2);
          const full = Math.abs((e.endAngle ?? Math.PI * 2) - (e.startAngle ?? 0) - Math.PI * 2) < 1e-6;
          push(full ? pts.slice(0, -1) : pts, full, m, layer);
          break;
        }
        case "SPLINE": {
          const pts = splinePoints(e);
          if (pts.length >= 2) push(pts, !!e.closed, m, layer);
          break;
        }
        case "INSERT": {
          const block = dxf!.blocks?.[e.name];
          if (!block?.entities) break;
          const bp = block.position || { x: 0, y: 0 };
          const sx = e.xScale ?? 1;
          const sy = e.yScale ?? 1;
          const rot = ((e.rotation ?? 0) * Math.PI) / 180;
          const cols = Math.max(1, e.columnCount ?? 1);
          const rows = Math.max(1, e.rowCount ?? 1);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const ox = c * (e.columnSpacing ?? 0);
              const oy = r * (e.rowSpacing ?? 0);
              const pos = e.position || { x: 0, y: 0 };
              const cos = Math.cos(rot), sin = Math.sin(rot);
              // 블록 좌표 → (기준점 이동) → 스케일 → 배열 오프셋 → 회전 → 삽입점
              let im: Matrix = [1, 0, 0, 1, -bp.x, -bp.y];
              im = multiply([sx, 0, 0, sy, 0, 0], im);
              im = multiply([1, 0, 0, 1, ox, oy], im);
              im = multiply([cos, sin, -sin, cos, 0, 0], im);
              im = multiply([1, 0, 0, 1, pos.x, pos.y], im);
              walk(block.entities as AnyEntity[], multiply(m, im), layer, depth + 1);
            }
          }
          break;
        }
        case "TEXT":
        case "MTEXT": {
          const p = e.startPoint || e.position;
          const str = cleanMtext(String(e.text ?? ""));
          if (p && str) {
            const q = apply(m, p.x, p.y);
            texts.push({ text: str, x: q.x, y: q.y });
          }
          break;
        }
        case "DIMENSION": {
          const val = e.text && e.text !== "<>" ? cleanMtext(String(e.text)) : e.actualMeasurement != null ? String(Math.round(e.actualMeasurement * k * 10) / 10) : "";
          const p = e.middleOfText || e.anchorPoint;
          if (val && p) {
            const q = apply(m, p.x, p.y);
            texts.push({ text: val, x: q.x, y: q.y });
          }
          break;
        }
        case "POINT":
        case "ATTDEF":
          break;
        default:
          skipped.set(e.type, (skipped.get(e.type) || 0) + 1);
      }
    }
  };

  walk((dxf.entities || []) as AnyEntity[], base, null, 0);
  if (skipped.size) {
    warnings.push("지원하지 않는 요소 제외: " + [...skipped].map(([t, n]) => `${t} ${n}개`).join(", "));
  }
  if (contours.length === 0) warnings.push("DXF에서 도형을 찾지 못했습니다.");

  return { id: "", fileName, format: "dxf", contours: joinContours(contours), texts, unitNote, warnings };
}

const xy = (p: IPoint): Pt => ({ x: p.x, y: p.y });

/** bulge(볼록도)가 있는 폴리라인 → 점 목록 */
function bulgePolyline(vs: (IPoint & { bulge?: number })[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i];
    if (i === 0) out.push(xy(a));
    const isLast = i === n - 1;
    if (isLast && !closed) break;
    const b = vs[(i + 1) % n];
    const bulge = a.bulge || 0;
    if (Math.abs(bulge) > 1e-9) {
      const theta = 4 * Math.atan(bulge);
      const dx = b.x - a.x, dy = b.y - a.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-9) {
        const r = chord / (2 * Math.sin(theta / 2));
        // 현의 중점에서 수직 방향으로 중심
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const h = r * Math.cos(theta / 2);
        const cx = mx - (dy / chord) * h;
        const cy = my + (dx / chord) * h;
        const a0 = Math.atan2(a.y - cy, a.x - cx);
        const pts = arcPoints(cx, cy, Math.abs(r), a0, a0 + theta);
        for (let j = 1; j < pts.length; j++) out.push(pts[j]);
        if (isLast) out.pop(); // 닫힌 경우 시작점 중복 제거
        continue;
      }
    }
    if (!isLast) out.push(xy(b));
  }
  return out;
}

function ellipsePoints(c: IPoint, major: IPoint, ratio: number, t0: number, t1: number): Pt[] {
  if (t1 <= t0) t1 += Math.PI * 2;
  const rMaj = Math.hypot(major.x, major.y);
  const n = Math.max(16, Math.min(360, Math.ceil(((t1 - t0) / (Math.PI * 2)) * Math.max(32, rMaj))));
  const minor = { x: -major.y * ratio, y: major.x * ratio };
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push({ x: c.x + major.x * ct + minor.x * st, y: c.y + major.y * ct + minor.y * st });
  }
  return pts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function splinePoints(e: Record<string, any>): Pt[] {
  const cps: IPoint[] = e.controlPoints || [];
  const knots: number[] = e.knotValues || [];
  const p: number = e.degreeOfSplineCurve || 3;
  if (cps.length > p && knots.length === cps.length + p + 1) {
    const t0 = knots[p];
    const t1 = knots[knots.length - p - 1];
    const n = Math.max(16, Math.min(500, cps.length * 10));
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push(deBoor(p, knots, cps, t0 + ((t1 - t0) * i) / n));
    return pts;
  }
  const fit: IPoint[] = e.fitPoints || [];
  if (fit.length >= 2) return fit.map(xy);
  return cps.map(xy);
}

function deBoor(p: number, U: number[], P: IPoint[], t: number): Pt {
  const n = P.length - 1;
  let k = p;
  if (t >= U[n + 1]) k = n;
  else while (k < n && !(t >= U[k] && t < U[k + 1])) k++;
  const d: Pt[] = [];
  for (let j = 0; j <= p; j++) d.push(xy(P[j + k - p]));
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const denom = U[i + p - r + 1] - U[i];
      const alpha = denom === 0 ? 0 : (t - U[i]) / denom;
      d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y };
    }
  }
  return d[p];
}

function cleanMtext(s: string): string {
  return s
    .replace(/\\[A-Za-z][^;\\]*;/g, "")
    .replace(/\\P/g, " ")
    .replace(/[{}]/g, "")
    .replace(/%%c/gi, "Ø")
    .trim();
}
