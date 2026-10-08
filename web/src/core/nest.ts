// 1단계 배치: 부품 외접 사각형 기준 MaxRects 배치
// 여러 정렬 순서 × 배치 규칙을 시도해 판재 장수가 가장 적은 결과를 고른다.
import { Material, NestSettings, Product, partMetrics } from "./model";

export interface Placement {
  productId: string;
  partIndex: number;
  /** 판재 좌상단 기준 위치, 배치된(회전 반영) 크기. mm */
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface SheetLayout {
  placements: Placement[];
  /** 배치된 부품 외접 사각형 면적 합 */
  usedArea: number;
}

export interface MaterialNest {
  material: Material;
  sheets: SheetLayout[];
  /** 판재보다 커서 배치하지 못한 부품 */
  oversize: { productId: string; partIndex: number; w: number; h: number }[];
  pieceCount: number;
  /** 배치 효율 (외접 사각형 면적 / 사용 판재 면적) */
  utilization: number;
}

interface Item {
  productId: string;
  partIndex: number;
  w: number;
  h: number;
  rot: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Heuristic = "bssf" | "baf" | "bl" | "blsf";

class MaxRectsBin {
  free: Rect[];
  placed: (Rect & { item: Item; rotated: boolean })[] = [];
  constructor(
    public W: number,
    public H: number,
  ) {
    this.free = [{ x: 0, y: 0, w: W, h: H }];
  }

  /** 들어갈 위치와 점수를 찾는다 (점수 낮을수록 좋음) */
  find(w: number, h: number, rot: boolean, heur: Heuristic): { r: Rect; rotated: boolean; s1: number; s2: number } | null {
    let best: { r: Rect; rotated: boolean; s1: number; s2: number } | null = null;
    const tryFit = (fw: number, fh: number, rotated: boolean) => {
      for (const f of this.free) {
        if (fw > f.w + 1e-9 || fh > f.h + 1e-9) continue;
        const lw = f.w - fw;
        const lh = f.h - fh;
        let s1: number, s2: number;
        switch (heur) {
          case "bssf":
            s1 = Math.min(lw, lh);
            s2 = Math.max(lw, lh);
            break;
          case "blsf":
            s1 = Math.max(lw, lh);
            s2 = Math.min(lw, lh);
            break;
          case "baf":
            s1 = f.w * f.h - fw * fh;
            s2 = Math.min(lw, lh);
            break;
          case "bl":
            s1 = f.y + fh;
            s2 = f.x;
            break;
        }
        if (!best || s1 < best.s1 - 1e-9 || (Math.abs(s1 - best.s1) <= 1e-9 && s2 < best.s2)) {
          best = { r: { x: f.x, y: f.y, w: fw, h: fh }, rotated, s1, s2 };
        }
      }
    };
    tryFit(w, h, false);
    if (rot && Math.abs(w - h) > 1e-9) tryFit(h, w, true);
    return best;
  }

  place(r: Rect, item: Item, rotated: boolean) {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f);
        continue;
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // 다른 사각형에 완전히 포함되는 빈 영역 제거
    this.free = next.filter(
      (a, i) =>
        a.w > 1e-9 &&
        a.h > 1e-9 &&
        !next.some(
          (b, j) =>
            i !== j &&
            a.x >= b.x - 1e-9 &&
            a.y >= b.y - 1e-9 &&
            a.x + a.w <= b.x + b.w + 1e-9 &&
            a.y + a.h <= b.y + b.h + 1e-9 &&
            // 완전히 같은 사각형은 하나만 남긴다
            (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || i > j),
        ),
    );
    this.placed.push({ ...r, item, rotated });
  }
}

const SORTS: ((a: Item, b: Item) => number)[] = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a, b) => b.h - a.h || b.w - a.w,
  (a, b) => b.w - a.w || b.h - a.h,
];
const HEURISTICS: Heuristic[] = ["bssf", "baf", "bl", "blsf"];

/** 아이템 목록을 판재에 배치 (간격 g는 아이템을 g만큼 키우고 사용 영역도 g만큼 키우는 방식으로 처리) */
function packRun(items: Item[], uw: number, uh: number, heur: Heuristic): MaxRectsBin[] {
  const bins: MaxRectsBin[] = [];
  for (const it of items) {
    let done = false;
    for (const bin of bins) {
      const f = bin.find(it.w, it.h, it.rot, heur);
      if (f) {
        bin.place(f.r, it, f.rotated);
        done = true;
        break;
      }
    }
    if (!done) {
      const bin = new MaxRectsBin(uw, uh);
      const f = bin.find(it.w, it.h, it.rot, heur);
      if (!f) continue; // 판보다 큰 부품: 호출 전에 걸러진다
      bin.place(f.r, it, f.rotated);
      bins.push(bin);
    }
  }
  return bins;
}

function binsArea(b: MaxRectsBin): number {
  return b.placed.reduce((s, p) => s + p.w * p.h, 0);
}

/** 판재 한 종류에 대해 아이템(간격 미포함 크기)을 배치 */
export function packItems(
  items: Item[],
  sheetW: number,
  sheetH: number,
  ns: NestSettings,
): { bins: MaxRectsBin[]; oversize: Item[] } {
  const g = Math.max(0, ns.gap);
  const uw = sheetW - 2 * ns.margin + g;
  const uh = sheetH - 2 * ns.margin + g;
  const fits = (it: Item) =>
    (it.w + g <= uw + 1e-9 && it.h + g <= uh + 1e-9) || (it.rot && it.h + g <= uw + 1e-9 && it.w + g <= uh + 1e-9);
  const oversize = items.filter((it) => !fits(it));
  const inflated = items.filter(fits).map((it) => ({ ...it, w: it.w + g, h: it.h + g }));
  if (inflated.length === 0) return { bins: [], oversize };

  // 아이템이 많으면 시도 횟수를 줄인다
  const combos: [number, Heuristic][] = [];
  const many = inflated.length > 4000;
  for (const si of many ? [0, 1] : SORTS.keys()) for (const h of many ? (["bssf"] as Heuristic[]) : HEURISTICS) combos.push([si, h]);

  let best: MaxRectsBin[] | null = null;
  for (const [si, h] of combos) {
    const sorted = inflated.slice().sort(SORTS[si]);
    const bins = packRun(sorted, uw, uh, h);
    if (
      !best ||
      bins.length < best.length ||
      (bins.length === best.length && binsArea(bins[bins.length - 1]) < binsArea(best[best.length - 1]))
    ) {
      best = bins;
    }
  }
  // 동일 아이템만 있을 땐 단순 격자 배치와도 비교
  const grid = gridPack(inflated, uw, uh);
  if (grid && grid.length < best!.length) best = grid;
  return { bins: best!, oversize };
}

/** 모든 아이템 크기가 같을 때의 격자 배치 (가로/세로 방향 중 많이 들어가는 쪽 + 남는 띠에 회전 배치) */
function gridPack(items: Item[], uw: number, uh: number): MaxRectsBin[] | null {
  const a = items[0];
  if (!items.every((it) => it.w === a.w && it.h === a.h && it.rot === a.rot)) return null;
  const per = gridCapacity(a.w, a.h, a.rot, uw, uh);
  if (per.count === 0) return null;
  const bins: MaxRectsBin[] = [];
  let k = 0;
  while (k < items.length) {
    const bin = new MaxRectsBin(uw, uh);
    for (const r of per.cells) {
      if (k >= items.length) break;
      bin.placed.push({ ...r, item: items[k++], rotated: r.rotated });
    }
    bins.push(bin);
  }
  return bins;
}

function gridCapacity(w: number, h: number, rot: boolean, uw: number, uh: number): { count: number; cells: (Rect & { rotated: boolean })[] } {
  const layouts: (Rect & { rotated: boolean })[][] = [];
  const build = (cw: number, ch: number, rotated: boolean) => {
    const cols = Math.floor((uw + 1e-9) / cw);
    const rows = Math.floor((uh + 1e-9) / ch);
    const cells: (Rect & { rotated: boolean })[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: c * cw, y: r * ch, w: cw, h: ch, rotated });
    // 오른쪽 남는 띠 / 아래쪽 남는 띠에 반대 방향 배치
    if (rot && cw !== ch) {
      const restW = uw - cols * cw;
      const rc = Math.floor((restW + 1e-9) / ch), rr = Math.floor((uh + 1e-9) / cw);
      const restH = uh - rows * ch;
      const bc = Math.floor((cols * cw + 1e-9) / ch), br = Math.floor((restH + 1e-9) / cw);
      if (rc * rr >= bc * br) {
        for (let r = 0; r < rr; r++) for (let c = 0; c < rc; c++) cells.push({ x: cols * cw + c * ch, y: r * cw, w: ch, h: cw, rotated: !rotated });
      } else {
        for (let r = 0; r < br; r++) for (let c = 0; c < bc; c++) cells.push({ x: c * ch, y: rows * ch + r * cw, w: ch, h: cw, rotated: !rotated });
      }
    }
    layouts.push(cells);
  };
  build(w, h, false);
  if (rot) build(h, w, true);
  const best = layouts.reduce((a, b) => (b.length > a.length ? b : a));
  return { count: best.length, cells: best };
}

/** 제품들을 판재별로 묶어 배치 */
export function nestProducts(products: Product[], materials: Material[], ns: NestSettings): MaterialNest[] {
  const out: MaterialNest[] = [];
  const g = Math.max(0, ns.gap);
  for (const m of materials) {
    const ps = products.filter((p) => p.materialId === m.id && p.qty > 0);
    if (ps.length === 0) continue;
    const items: Item[] = [];
    for (const p of ps) {
      const ms = partMetrics(p);
      for (let q = 0; q < p.qty; q++) {
        ms.forEach((pm, partIndex) => items.push({ productId: p.id, partIndex, w: pm.w, h: pm.h, rot: p.allowRotate }));
      }
    }
    const { bins, oversize } = packItems(items, m.sheetW, m.sheetH, ns);
    const sheets: SheetLayout[] = bins.map((b) => {
      const placements = b.placed.map((pl) => ({
        productId: pl.item.productId,
        partIndex: pl.item.partIndex,
        x: ns.margin + pl.x,
        y: ns.margin + pl.y,
        w: pl.w - g,
        h: pl.h - g,
        rotated: pl.rotated,
      }));
      return { placements, usedArea: placements.reduce((s, p) => s + p.w * p.h, 0) };
    });
    const sheetArea = m.sheetW * m.sheetH;
    const used = sheets.reduce((s, sh) => s + sh.usedArea, 0);
    out.push({
      material: m,
      sheets,
      oversize: oversize.map((o) => ({ productId: o.productId, partIndex: o.partIndex, w: o.w, h: o.h })),
      pieceCount: items.length - oversize.length,
      utilization: sheets.length ? used / (sheets.length * sheetArea) : 0,
    });
  }
  return out;
}

/** 단일 부품 제품이 판재 1장에 최대 몇 개 들어가는지 */
export function capacityPerSheet(p: Product, m: Material, ns: NestSettings): number | null {
  const ms = partMetrics(p);
  if (ms.length !== 1) return null;
  const { w, h } = ms[0];
  const g = Math.max(0, ns.gap);
  const uw = m.sheetW - 2 * ns.margin + g;
  const uh = m.sheetH - 2 * ns.margin + g;
  const iw = w + g, ih = h + g;
  if (iw * ih <= 0) return null;
  const upper = Math.min(5000, Math.floor((uw * uh) / (iw * ih)));
  if (upper === 0) return 0;
  const grid = gridCapacity(iw, ih, p.allowRotate, uw, uh).count;
  if (grid >= upper || upper > 1500) return grid;
  // MaxRects로 한 장에 채워보기
  let best = grid;
  for (const heur of HEURISTICS) {
    const bin = new MaxRectsBin(uw, uh);
    let n = 0;
    for (let i = 0; i < upper; i++) {
      const f = bin.find(iw, ih, p.allowRotate, heur);
      if (!f) break;
      bin.place(f.r, { productId: p.id, partIndex: 0, w: iw, h: ih, rot: p.allowRotate }, f.rotated);
      n++;
    }
    best = Math.max(best, n);
  }
  return best;
}

/** 배치가 완전히 같은 판끼리 묶는다 (화면 표시용) */
export function groupSheets(sheets: SheetLayout[]): { layout: SheetLayout; count: number; firstIndex: number }[] {
  const out: { layout: SheetLayout; count: number; firstIndex: number; key: string }[] = [];
  sheets.forEach((s, i) => {
    const key = s.placements
      .map((p) => `${p.productId}:${p.partIndex}:${Math.round(p.x)}:${Math.round(p.y)}:${p.rotated ? 1 : 0}`)
      .sort()
      .join("|");
    const last = out[out.length - 1];
    if (last && last.key === key) last.count++;
    else out.push({ layout: s, count: 1, firstIndex: i, key });
  });
  return out;
}
