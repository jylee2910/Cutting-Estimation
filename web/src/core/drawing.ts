// 불러온 도면의 공통 모델과 "형상(=재단 부품)" 인식 로직
import {
  BBox,
  Pt,
  bboxContains,
  bboxH,
  bboxOf,
  bboxW,
  dedupe,
  dist,
  pointInPolygon,
  polylineLength,
  signedArea,
} from "./geometry";

export type DrawingFormat = "svg" | "dxf" | "pdf";

/** 도면 안의 선 하나 (mm, y-down) */
export interface Contour {
  pts: Pt[];
  closed: boolean;
  /** DXF 레이어명 또는 선/면 색상. 절단선만 골라내는 필터에 쓴다. */
  layer: string;
}

export interface DrawingText {
  text: string;
  x: number;
  y: number;
}

export interface Drawing {
  id: string;
  fileName: string;
  format: DrawingFormat;
  contours: Contour[];
  texts: DrawingText[];
  /** 단위 해석 방법 설명 (사용자에게 표시) */
  unitNote: string;
  warnings: string[];
  /** PDF 페이지 크기 등, 테두리 자동 제외에 사용 (mm) */
  pageSize?: { w: number; h: number };
}

/** 인식된 부품 하나: 바깥 윤곽 + 안쪽 구멍 + 안쪽 열린 선 */
export interface Shape {
  /** 도면 내 바깥 윤곽 contour 인덱스 (식별자로 사용) */
  index: number;
  outer: Pt[];
  holes: Pt[][];
  opens: Pt[][];
  layer: string;
  bbox: BBox;
  w: number;
  h: number;
  /** 실제 면적 (바깥 - 구멍), mm² */
  area: number;
  /** 총 가공 길이 (바깥+구멍+내부선), mm */
  cutLength: number;
  /** 동일 형상 판별 키 */
  signature: string;
}

const JOIN_TOL = 0.05; // mm, 끝점 연결 허용 오차

/**
 * 끊어진 선(DXF의 LINE/ARC 조각 등)을 끝점 기준으로 이어 붙인다.
 * 같은 레이어끼리만 잇는다. 시작점과 끝점이 만나면 닫힌 윤곽으로 바꾼다.
 */
export function joinContours(contours: Contour[], tol = JOIN_TOL): Contour[] {
  const result: Contour[] = [];
  const open: Contour[] = [];
  for (const c of contours) {
    const pts = dedupe(c.pts);
    if (pts.length < 2) continue;
    if (c.closed) {
      result.push({ ...c, pts });
    } else if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= tol) {
      result.push({ ...c, pts: pts.slice(0, -1), closed: true });
    } else {
      open.push({ ...c, pts });
    }
  }

  // 끝점 공간 해시
  const cell = Math.max(tol * 4, 0.5);
  const key = (p: Pt) => `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
  const buckets = new Map<string, number[]>();
  const addEnd = (i: number, p: Pt) => {
    const k = key(p);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(i);
  };
  open.forEach((c, i) => {
    addEnd(i, c.pts[0]);
    addEnd(i, c.pts[c.pts.length - 1]);
  });
  const used = new Array<boolean>(open.length).fill(false);

  const findNeighbor = (p: Pt, layer: string): { i: number; atStart: boolean } | null => {
    const cx = Math.round(p.x / cell);
    const cy = Math.round(p.y / cell);
    let best: { i: number; atStart: boolean; d: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = buckets.get(`${cx + dx},${cy + dy}`);
        if (!b) continue;
        for (const i of b) {
          if (used[i] || open[i].layer !== layer) continue;
          const pts = open[i].pts;
          const ds = dist(p, pts[0]);
          const de = dist(p, pts[pts.length - 1]);
          if (ds <= tol && (!best || ds < best.d)) best = { i, atStart: true, d: ds };
          if (de <= tol && (!best || de < best.d)) best = { i, atStart: false, d: de };
        }
      }
    }
    return best;
  };

  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const layer = open[i].layer;
    let chain = open[i].pts.slice();
    // 뒤쪽으로 확장
    for (;;) {
      const n = findNeighbor(chain[chain.length - 1], layer);
      if (!n) break;
      used[n.i] = true;
      const pts = n.atStart ? open[n.i].pts : open[n.i].pts.slice().reverse();
      chain = chain.concat(pts.slice(1));
    }
    // 앞쪽으로 확장
    for (;;) {
      const n = findNeighbor(chain[0], layer);
      if (!n) break;
      used[n.i] = true;
      const pts = n.atStart ? open[n.i].pts.slice().reverse() : open[n.i].pts;
      chain = pts.slice(0, -1).concat(chain);
    }
    if (chain.length > 2 && dist(chain[0], chain[chain.length - 1]) <= tol) {
      result.push({ pts: chain.slice(0, -1), closed: true, layer });
    } else {
      result.push({ pts: chain, closed: false, layer });
    }
  }
  return result;
}

export interface DetectOptions {
  /** 제외할 contour 인덱스 (도면 테두리, 치수선 등) */
  excluded?: ReadonlySet<number>;
  /** 표시할(사용할) 레이어. 없으면 전체 */
  layers?: ReadonlySet<string>;
  /** 도면 배율 (도면 1단위 → 실제 mm). 1:10 도면이면 10 */
  scale?: number;
}

const MIN_AREA = 1; // mm², 이보다 작은 닫힌 윤곽은 잡음으로 본다

/**
 * 닫힌 윤곽의 포함 관계로 부품을 인식한다.
 * 깊이 0, 2, 4…(짝수)는 부품의 바깥 윤곽, 홀수 깊이는 바로 위 부품의 구멍이다.
 * 열린 선은 그것을 감싸는 부품의 내부 가공선으로 붙인다.
 */
export function detectShapes(drawing: Drawing, opts: DetectOptions = {}): Shape[] {
  const scale = opts.scale ?? 1;
  const items = drawing.contours
    .map((c, index) => ({ c, index }))
    .filter(({ c, index }) => !opts.excluded?.has(index) && (!opts.layers || opts.layers.has(c.layer)));

  type Node = {
    index: number;
    pts: Pt[];
    bbox: BBox;
    area: number;
    layer: string;
    parent: number; // nodes 배열 인덱스, -1 = 최상위
    depth: number;
  };
  const scalePts = (pts: Pt[]) => (scale === 1 ? pts : pts.map((p) => ({ x: p.x * scale, y: p.y * scale })));

  const nodes: Node[] = [];
  const opens: { pts: Pt[]; layer: string }[] = [];
  // 같은 윤곽이 겹쳐 그려진 경우(면+선 중복 등) 하나만 쓴다
  const seen = new Set<string>();
  for (const { c, index } of items) {
    const pts = scalePts(c.pts);
    if (c.closed && pts.length >= 3) {
      const area = Math.abs(signedArea(pts));
      if (area < MIN_AREA) continue;
      const bbox = bboxOf(pts);
      const dupKey = [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((v) => Math.round(v * 10)).join(",") + "|" + area.toPrecision(3);
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      nodes.push({ index, pts, bbox, area, layer: c.layer, parent: -1, depth: 0 });
    } else {
      opens.push({ pts, layer: c.layer });
    }
  }

  // 큰 것부터 정렬 → 각 노드의 부모는 자신을 포함하는 가장 작은 노드
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[b].area - nodes[a].area);
  const contains = (outer: Node, inner: Node) =>
    outer.area > inner.area &&
    bboxContains(outer.bbox, inner.bbox, 0.01) &&
    insideSample(inner.pts, outer.pts);
  for (let oi = 0; oi < order.length; oi++) {
    const ni = order[oi];
    const node = nodes[ni];
    // 자신보다 큰 노드 중 포함하는 가장 작은 것: 역순 탐색
    for (let oj = oi - 1; oj >= 0; oj--) {
      const cand = nodes[order[oj]];
      if (contains(cand, node)) {
        node.parent = order[oj];
        node.depth = cand.depth + 1;
        break;
      }
    }
  }

  const shapes = new Map<number, Shape>(); // nodes 인덱스 → Shape
  for (const ni of order) {
    const n = nodes[ni];
    if (n.depth % 2 === 0) {
      shapes.set(ni, {
        index: n.index,
        outer: n.pts,
        holes: [],
        opens: [],
        layer: n.layer,
        bbox: n.bbox,
        w: bboxW(n.bbox),
        h: bboxH(n.bbox),
        area: n.area,
        cutLength: polylineLength(n.pts, true),
        signature: "",
      });
    } else {
      const s = shapes.get(n.parent);
      if (s) {
        s.holes.push(n.pts);
        s.area -= n.area;
        s.cutLength += polylineLength(n.pts, true);
      }
    }
  }

  // 열린 선 → 감싸는 가장 안쪽 부품에 귀속
  const shapeList = [...shapes.values()];
  const byAreaAsc = shapeList.slice().sort((a, b) => a.area - b.area);
  for (const o of opens) {
    const ob = bboxOf(o.pts);
    const owner = byAreaAsc.find((s) => bboxContains(s.bbox, ob, 0.01) && pointInPolygon(o.pts[0], s.outer));
    if (owner) {
      owner.opens.push(o.pts);
      owner.cutLength += polylineLength(o.pts, false);
    }
  }

  for (const s of shapeList) s.signature = shapeSignature(s);
  // 도면상 위→아래, 왼→오 순서로 정렬
  return shapeList.sort((a, b) => a.bbox.minY - b.bbox.minY || a.bbox.minX - b.bbox.minX);
}

/** 안쪽 윤곽의 몇몇 점이 바깥 윤곽 안에 있는지 (경계에 걸친 점 오판 방지용 다수결) */
function insideSample(inner: Pt[], outer: Pt[]): boolean {
  const n = inner.length;
  const samples = Math.min(n, 5);
  let yes = 0;
  for (let k = 0; k < samples; k++) {
    if (pointInPolygon(inner[Math.floor((k * n) / samples)], outer)) yes++;
  }
  return yes * 2 > samples;
}

/** 회전(90°)을 무시한 동일 형상 판별 키 */
export function shapeSignature(s: Pick<Shape, "w" | "h" | "area" | "holes" | "cutLength">): string {
  const a = Math.min(s.w, s.h);
  const b = Math.max(s.w, s.h);
  const q = (v: number) => Math.round(v * 2) / 2; // 치수는 0.5mm 단위
  const sig3 = (v: number) => (v > 0 ? Number(v.toPrecision(3)) : 0); // 면적·길이는 유효숫자 3자리
  return [q(a), q(b), sig3(s.area), s.holes.length, sig3(s.cutLength)].join("|");
}

/** 페이지 크기와 거의 같은 사각 윤곽(도면 테두리)을 찾아 기본 제외 대상으로 돌려준다 */
export function defaultExcluded(drawing: Drawing): Set<number> {
  const ex = new Set<number>();
  if (!drawing.pageSize) return ex;
  const { w, h } = drawing.pageSize;
  drawing.contours.forEach((c, i) => {
    if (!c.closed) return;
    const b = bboxOf(c.pts);
    if (bboxW(b) >= w * 0.9 && bboxH(b) >= h * 0.9) ex.add(i);
  });
  return ex;
}

export function drawingBBox(drawing: Drawing): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const c of drawing.contours) bboxOf(c.pts, b);
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return b;
}

export function layersOf(drawing: Drawing): string[] {
  return [...new Set(drawing.contours.map((c) => c.layer))];
}

/** 텍스트에서 규격(가로×세로) 후보를 찾는다. 예: "1200x600", "W 900 × H 450" */
export function findSizeHints(texts: DrawingText[]): { label: string; w: number; h: number }[] {
  const joined = texts.map((t) => t.text).join("  ");
  const re = /(?:W\s*)?(\d{2,5}(?:\.\d+)?)\s*(?:mm)?\s*[x×X*]\s*(?:H\s*)?(\d{2,5}(?:\.\d+)?)/g;
  const out: { label: string; w: number; h: number }[] = [];
  const seen = new Set<string>();
  for (const m of joined.matchAll(re)) {
    const w = parseFloat(m[1]);
    const h = parseFloat(m[2]);
    const k = `${w}x${h}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label: m[0].trim(), w, h });
  }
  return out;
}
