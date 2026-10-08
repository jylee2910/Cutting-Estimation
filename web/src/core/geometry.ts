// 기본 기하 유틸리티. 모든 좌표는 mm 단위, y축은 아래 방향(화면 좌표계)이다.

export interface Pt {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 아핀 변환 [a, b, c, d, e, f] : x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m을 먼저 적용한 뒤 outer를 적용하는 합성 변환 (outer ∘ m) */
export function multiply(outer: Matrix, m: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  return [
    a * m[0] + c * m[1],
    b * m[0] + d * m[1],
    a * m[2] + c * m[3],
    b * m[2] + d * m[3],
    a * m[4] + c * m[5] + e,
    b * m[4] + d * m[5] + f,
  ];
}

export function apply(m: Matrix, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function bboxOf(pts: readonly Pt[], into: BBox = emptyBBox()): BBox {
  for (const p of pts) {
    if (p.x < into.minX) into.minX = p.x;
    if (p.y < into.minY) into.minY = p.y;
    if (p.x > into.maxX) into.maxX = p.x;
    if (p.y > into.maxY) into.maxY = p.y;
  }
  return into;
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxW(b: BBox): number {
  return b.maxX - b.minX;
}

export function bboxH(b: BBox): number {
  return b.maxY - b.minY;
}

export function bboxContains(outer: BBox, inner: BBox, tol = 1e-6): boolean {
  return (
    inner.minX >= outer.minX - tol &&
    inner.minY >= outer.minY - tol &&
    inner.maxX <= outer.maxX + tol &&
    inner.maxY <= outer.maxY + tol
  );
}

/** 부호 있는 면적 (shoelace). 닫힌 다각형 기준 */
export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polylineLength(pts: readonly Pt[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) len += dist(pts[pts.length - 1], pts[0]);
  return len;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 곡선 분할 시 허용 오차(mm). 견적용이므로 0.1mm 정도면 충분하다. */
const CURVE_TOL = 0.1;

export function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[]): void {
  const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / CURVE_TOL) * 0.6)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
}

export function flattenQuad(p0: Pt, p1: Pt, p2: Pt, out: Pt[]): void {
  const len = dist(p0, p1) + dist(p1, p2);
  const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / CURVE_TOL) * 0.6)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    });
  }
}

/** 원호 분할 개수: 현(chord) 오차가 CURVE_TOL 이하가 되도록 */
export function arcSegments(radius: number, sweep: number): number {
  const r = Math.abs(radius);
  if (r < 1e-9) return 1;
  const step = r <= CURVE_TOL ? Math.PI / 4 : 2 * Math.acos(Math.max(-1, 1 - CURVE_TOL / r));
  return Math.max(2, Math.min(360, Math.ceil(Math.abs(sweep) / Math.min(step, Math.PI / 18))));
}

/** 중심/반지름/시작각/끝각(rad, 반시계 기준)으로 원호 점 생성. 시작점 포함.
 *  치수가 정확히 나오도록 0°/90°/180°/270° 극점은 항상 포함한다. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const sweep = a1 - a0;
  const n = arcSegments(r, sweep);
  const angles: number[] = [];
  for (let i = 0; i <= n; i++) angles.push(a0 + (sweep * i) / n);
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  for (let q = Math.ceil(lo / (Math.PI / 2)); q * (Math.PI / 2) < hi; q++) {
    const a = q * (Math.PI / 2);
    if (a > lo) angles.push(a);
  }
  angles.sort((x, y) => (sweep >= 0 ? x - y : y - x));
  const pts: Pt[] = [];
  for (const a of angles) {
    const p = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) pts.push(p);
  }
  return pts;
}

/** 연속된 중복점 제거 */
export function dedupe(pts: Pt[], tol = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > tol || Math.abs(last.y - p.y) > tol) out.push(p);
  }
  return out;
}

export function translatePts(pts: readonly Pt[], dx: number, dy: number): Pt[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function round(v: number, digits = 1): number {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}
