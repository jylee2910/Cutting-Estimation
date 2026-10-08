// 배치 결과 → 대략 견적
import { EXTRA_BASIS_LABEL, Material, PriceSettings, Product, materialLabel, productMetrics } from "./model";
import type { MaterialNest } from "./nest";

export interface QuoteLine {
  category: "자재비" | "가공비" | "기타";
  name: string;
  spec: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
}

export interface ProductQuote {
  productId: string;
  name: string;
  spec: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface Quote {
  lines: QuoteLine[];
  /** 원가 합계 (이윤 전) */
  cost: number;
  margin: number;
  /** 최소 작업 금액 보정액 */
  minimumAdjust: number;
  supply: number;
  vat: number;
  total: number;
  products: ProductQuote[];
  /** 제품별 (단가×수량) 합계와 공급가액의 차이 (단수 조정) */
  productAdjust: number;
  totals: { sheets: number; chargedSheets: number; pieces: number; cutLengthM: number; areaM2: number };
}

export function roundMoney(v: number, unit: number, mode: PriceSettings["roundMode"]): number {
  const u = Math.max(1, unit);
  const x = v / u;
  // 부동소수 오차로 한 단위 넘어가지 않도록 보정
  if (mode === "floor") return Math.floor(x + 1e-9) * u;
  if (mode === "ceil") return Math.ceil(x - 1e-9) * u;
  return Math.round(x) * u;
}

/** 판재별로 청구할 장수 (partial 모드에서는 마지막 장을 사용 비율만큼) */
export function chargedSheets(n: MaterialNest, ps: PriceSettings): number {
  const count = n.sheets.length;
  if (count === 0) return 0;
  if (ps.materialMode === "full") return count;
  const step = ps.partialStep > 0 && ps.partialStep <= 1 ? ps.partialStep : 1;
  const last = n.sheets[count - 1];
  const frac = last.usedArea / (n.material.sheetW * n.material.sheetH);
  return count - 1 + Math.min(1, Math.max(step, Math.ceil(frac / step - 1e-9) * step));
}

export function buildQuote(products: Product[], nests: MaterialNest[], materials: Material[], ps: PriceSettings): Quote {
  const lines: QuoteLine[] = [];
  const active = products.filter((p) => p.qty > 0 && materials.some((m) => m.id === p.materialId));
  const metrics = new Map(active.map((p) => [p.id, productMetrics(p)]));

  // 제품별 원가 배분용
  const alloc = new Map<string, number>(active.map((p) => [p.id, 0]));
  const add = (id: string, v: number) => alloc.set(id, (alloc.get(id) || 0) + v);

  let totalSheets = 0;
  let totalCharged = 0;
  let totalCutM = 0;

  for (const n of nests) {
    const m = n.material;
    const charged = chargedSheets(n, ps);
    totalSheets += n.sheets.length;
    totalCharged += charged;
    const matCost = charged * m.pricePerSheet;
    if (charged > 0) {
      lines.push({
        category: "자재비",
        name: `${m.name} ${m.thickness}T`,
        spec: `${m.sheetW}×${m.sheetH} (사용 ${n.sheets.length}장)`,
        qty: charged,
        unit: "장",
        unitPrice: m.pricePerSheet,
        amount: matCost,
      });
    }
    // 자재비는 판재 안에서 외접 사각형 면적 비율로 배분
    const group = active.filter((p) => p.materialId === m.id);
    const bboxArea = (p: Product) => p.qty * p.w * p.h;
    const sumArea = group.reduce((s, p) => s + bboxArea(p), 0) || 1;
    for (const p of group) add(p.id, (matCost * bboxArea(p)) / sumArea);

    const cutMm = group.reduce((s, p) => s + metrics.get(p.id)!.cutLength * p.qty, 0);
    const cutM = cutMm / 1000;
    totalCutM += cutM;
    if (cutM > 0 && m.cutPricePerM > 0) {
      lines.push({
        category: "가공비",
        name: `재단/가공 (${m.name} ${m.thickness}T)`,
        spec: "가공 길이",
        qty: round2(cutM),
        unit: "m",
        unitPrice: m.cutPricePerM,
        amount: cutM * m.cutPricePerM,
      });
      for (const p of group) add(p.id, (metrics.get(p.id)!.cutLength * p.qty * m.cutPricePerM) / 1000);
    }
  }

  const pieces = active.reduce((s, p) => s + metrics.get(p.id)!.pieces * p.qty, 0);
  const areaM2 = active.reduce((s, p) => s + (metrics.get(p.id)!.area * p.qty) / 1e6, 0);

  if (ps.perPieceFee > 0 && pieces > 0) {
    lines.push({ category: "가공비", name: "개당 가공비", spec: "부품 수", qty: pieces, unit: "개", unitPrice: ps.perPieceFee, amount: pieces * ps.perPieceFee });
    for (const p of active) add(p.id, metrics.get(p.id)!.pieces * p.qty * ps.perPieceFee);
  }

  // 건 단위 비용(기본 작업비, 부가 항목)은 제품별 원가 비율로 배분
  let overhead = 0;
  if (ps.setupFee > 0 && active.length > 0) {
    lines.push({ category: "기타", name: "기본 작업비", spec: "건당", qty: 1, unit: "식", unitPrice: ps.setupFee, amount: ps.setupFee });
    overhead += ps.setupFee;
  }
  for (const ex of ps.extras) {
    if (!ex.enabled || ex.unitPrice === 0 || active.length === 0) continue;
    const [qty, unit] =
      ex.basis === "fixed" ? [1, "식"] :
      ex.basis === "perPiece" ? [pieces, "개"] :
      ex.basis === "perSheet" ? [totalCharged, "장"] :
      ex.basis === "perMeter" ? [round2(totalCutM), "m"] :
      [round2(areaM2), "㎡"];
    if (qty <= 0) continue;
    const amount = qty * ex.unitPrice;
    lines.push({ category: "기타", name: ex.name, spec: EXTRA_BASIS_LABEL[ex.basis], qty, unit, unitPrice: ex.unitPrice, amount });
    overhead += amount;
  }

  const cost = lines.reduce((s, l) => s + l.amount, 0);
  const margin = (cost * ps.marginRate) / 100;
  let supply = cost + margin;
  let minimumAdjust = 0;
  if (active.length > 0 && supply < ps.minimumCharge) {
    minimumAdjust = ps.minimumCharge - supply;
    supply = ps.minimumCharge;
  }
  supply = roundMoney(supply, ps.roundUnit, ps.roundMode);
  const vat = roundMoney((supply * ps.vatRate) / 100, 1, "floor");

  // 제품별 단가 (참고): 직접 원가 + 배분된 간접비 → 이윤·최소금액 비율 반영
  const direct = [...alloc.values()].reduce((s, v) => s + v, 0);
  const products2: ProductQuote[] = active.map((p) => {
    const d = alloc.get(p.id) || 0;
    const withOverhead = d + (direct > 0 ? (overhead * d) / direct : overhead / active.length);
    const share = cost > 0 ? (withOverhead / cost) * supply : supply / active.length;
    const unitPrice = roundMoney(share / p.qty, 10, "round");
    return {
      productId: p.id,
      name: p.name,
      spec: `${fmtMm(p.w)}×${fmtMm(p.h)} / ${materialLabel(materials.find((m) => m.id === p.materialId))}`,
      qty: p.qty,
      unitPrice,
      amount: unitPrice * p.qty,
    };
  });
  const productAdjust = supply - products2.reduce((s, p) => s + p.amount, 0);

  return {
    lines,
    cost,
    margin,
    minimumAdjust,
    supply,
    vat,
    total: supply + vat,
    products: products2,
    productAdjust,
    totals: { sheets: totalSheets, chargedSheets: totalCharged, pieces, cutLengthM: totalCutM, areaM2 },
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const fmtMm = (v: number) => String(Math.round(v * 10) / 10);
