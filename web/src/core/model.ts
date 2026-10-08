// 제품·판재·단가 설정 데이터 구조
import { Pt, bboxOf, emptyBBox, polylineLength, signedArea } from "./geometry";
import type { Shape } from "./drawing";

/** 제품을 이루는 부품 하나 (서로 떨어진 조각). 좌표는 제품 기준 원점(0,0) mm */
export interface Part {
  outer: Pt[];
  holes: Pt[][];
  opens: Pt[][];
}

export interface Product {
  id: string;
  name: string;
  /** 출처: 파일명 또는 "직접 입력" */
  source: string;
  /** 도면 형상에서 만든 경우 원본 위치 (도면 화면에서 '추가됨' 표시용) */
  sourceRef?: { drawingId: string; shapeIndices: number[] };
  parts: Part[];
  /** 원본(도면) 크기 */
  baseW: number;
  baseH: number;
  /** 제작 크기 (사용자 수정 가능) */
  w: number;
  h: number;
  qty: number;
  materialId: string;
  allowRotate: boolean;
  lockRatio: boolean;
}

export interface Material {
  id: string;
  name: string;
  thickness: number; // mm
  sheetW: number; // mm
  sheetH: number; // mm
  pricePerSheet: number; // 원/장
  cutPricePerM: number; // 원/m (재단·레이저·CNC 가공 길이당)
}

export interface NestSettings {
  /** 부품 간 간격 (공구경/레이저 커프 포함), mm */
  gap: number;
  /** 판재 가장자리 여백, mm */
  margin: number;
}

export type ExtraBasis = "fixed" | "perPiece" | "perSheet" | "perMeter" | "perM2";

export interface ExtraCharge {
  id: string;
  name: string;
  basis: ExtraBasis;
  unitPrice: number;
  enabled: boolean;
}

export interface PriceSettings {
  /** full: 사용한 판재 장수 전체 청구, partial: 마지막 장은 사용 비율만큼 청구 */
  materialMode: "full" | "partial";
  /** partial 모드에서 마지막 장 청구 단위 (0.25 = 1/4장 단위 올림) */
  partialStep: number;
  setupFee: number; // 기본 작업비 (건당)
  perPieceFee: number; // 개당 가공비
  extras: ExtraCharge[];
  marginRate: number; // 이윤/관리비 %
  vatRate: number; // 부가세 %
  roundUnit: number; // 원 단위 (10, 100, 1000)
  roundMode: "round" | "floor" | "ceil";
  minimumCharge: number; // 최소 작업 금액 (공급가 기준)
}

export interface QuoteInfo {
  number: string;
  date: string;
  customer: string;
  title: string;
  memo: string;
}

export const EXTRA_BASIS_LABEL: Record<ExtraBasis, string> = {
  fixed: "건당",
  perPiece: "개당",
  perSheet: "판재 장당",
  perMeter: "가공 m당",
  perM2: "제품 ㎡당",
};

let seq = 0;
export const uid = (p = "id") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** 인식된 형상 목록 → 하나의 제품 (원점 정규화) */
export function productFromShapes(
  shapes: Shape[],
  init: Pick<Product, "name" | "source" | "qty" | "materialId"> & { drawingId?: string },
): Product {
  const bb = emptyBBox();
  for (const s of shapes) bboxOf(s.outer, bb);
  const shift = (pts: Pt[]) => pts.map((p) => ({ x: p.x - bb.minX, y: p.y - bb.minY }));
  const parts: Part[] = shapes.map((s) => ({ outer: shift(s.outer), holes: s.holes.map(shift), opens: s.opens.map(shift) }));
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  return {
    id: uid("p"),
    name: init.name,
    source: init.source,
    sourceRef: init.drawingId ? { drawingId: init.drawingId, shapeIndices: shapes.map((s) => s.index) } : undefined,
    parts,
    baseW: w,
    baseH: h,
    w: round1(w),
    h: round1(h),
    qty: init.qty,
    materialId: init.materialId,
    allowRotate: true,
    lockRatio: true,
  };
}

/** 직접 입력하는 사각 제품 */
export function rectProduct(w: number, h: number, init: Pick<Product, "name" | "qty" | "materialId">): Product {
  return {
    id: uid("p"),
    name: init.name,
    source: "직접 입력",
    parts: [{ outer: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], holes: [], opens: [] }],
    baseW: w,
    baseH: h,
    w,
    h,
    qty: init.qty,
    materialId: init.materialId,
    allowRotate: true,
    lockRatio: false,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function productScale(p: Product): { sx: number; sy: number } {
  return { sx: p.baseW > 0 ? p.w / p.baseW : 1, sy: p.baseH > 0 ? p.h / p.baseH : 1 };
}

export function scalePts(pts: Pt[], sx: number, sy: number): Pt[] {
  return sx === 1 && sy === 1 ? pts : pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

export interface PartMetrics {
  /** 부품 외접 사각형 (제작 크기 기준) */
  w: number;
  h: number;
  x: number;
  y: number;
  area: number;
  cutLength: number;
}

/** 제작 크기로 환산한 부품별 치수/면적/가공길이 */
export function partMetrics(p: Product): PartMetrics[] {
  const { sx, sy } = productScale(p);
  return p.parts.map((part) => {
    const outer = scalePts(part.outer, sx, sy);
    const b = bboxOf(outer);
    let area = Math.abs(signedArea(outer));
    let cut = polylineLength(outer, true);
    for (const hole of part.holes) {
      const hp = scalePts(hole, sx, sy);
      area -= Math.abs(signedArea(hp));
      cut += polylineLength(hp, true);
    }
    for (const o of part.opens) cut += polylineLength(scalePts(o, sx, sy), false);
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY, area, cutLength: cut };
  });
}

export function productMetrics(p: Product): { pieces: number; area: number; cutLength: number } {
  const ms = partMetrics(p);
  return {
    pieces: ms.length,
    area: ms.reduce((s, m) => s + m.area, 0),
    cutLength: ms.reduce((s, m) => s + m.cutLength, 0),
  };
}

// ── 기본값 ─────────────────────────────────────────
export const DEFAULT_MATERIALS: Material[] = [
  { id: "m-acr3", name: "아크릴 투명", thickness: 3, sheetW: 1220, sheetH: 2440, pricePerSheet: 95000, cutPricePerM: 1500 },
  { id: "m-acr5", name: "아크릴 투명", thickness: 5, sheetW: 1220, sheetH: 2440, pricePerSheet: 155000, cutPricePerM: 2000 },
  { id: "m-acr10", name: "아크릴 투명", thickness: 10, sheetW: 1220, sheetH: 2440, pricePerSheet: 320000, cutPricePerM: 4000 },
  { id: "m-acrw3", name: "아크릴 유백", thickness: 3, sheetW: 1220, sheetH: 2440, pricePerSheet: 100000, cutPricePerM: 1500 },
  { id: "m-acr3s", name: "아크릴 투명(3×6)", thickness: 3, sheetW: 915, sheetH: 1830, pricePerSheet: 55000, cutPricePerM: 1500 },
  { id: "m-fmx5", name: "포맥스", thickness: 5, sheetW: 1220, sheetH: 2440, pricePerSheet: 35000, cutPricePerM: 1000 },
  { id: "m-fmx10", name: "포맥스", thickness: 10, sheetW: 1220, sheetH: 2440, pricePerSheet: 65000, cutPricePerM: 1500 },
  { id: "m-alu3", name: "알루미늄 복합판", thickness: 3, sheetW: 1220, sheetH: 2440, pricePerSheet: 60000, cutPricePerM: 2000 },
];

export const DEFAULT_NEST: NestSettings = { gap: 5, margin: 10 };

export const DEFAULT_PRICE: PriceSettings = {
  materialMode: "full",
  partialStep: 0.5,
  setupFee: 20000,
  perPieceFee: 0,
  extras: [],
  marginRate: 20,
  vatRate: 10,
  roundUnit: 100,
  roundMode: "round",
  minimumCharge: 30000,
};

export function materialLabel(m: Material | undefined): string {
  if (!m) return "(판재 없음)";
  return `${m.name} ${m.thickness}T ${m.sheetW}×${m.sheetH}`;
}
