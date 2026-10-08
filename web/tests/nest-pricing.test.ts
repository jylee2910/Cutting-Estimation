import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE, Material, PriceSettings, rectProduct } from "../src/core/model";
import { capacityPerSheet, nestProducts } from "../src/core/nest";
import { buildQuote, chargedSheets, roundMoney } from "../src/core/pricing";

const sheet: Material = { id: "m", name: "아크릴", thickness: 3, sheetW: 1220, sheetH: 2440, pricePerSheet: 100000, cutPricePerM: 1000 };
const ns = { gap: 5, margin: 10 };

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a, g: number) =>
  a.x < b.x + b.w + g - 1e-6 && b.x < a.x + a.w + g - 1e-6 && a.y < b.y + b.h + g - 1e-6 && b.y < a.y + a.h + g - 1e-6;

describe("사각 배치", () => {
  it("판당 수량: 여백 10·간격 5 기준 4×8판(사용폭 1200×2420)", () => {
    const p = rectProduct(600, 300, { name: "판넬", qty: 1, materialId: "m" });
    // 회전 허용: 300×600 으로 3열 × 4행 = 12
    expect(capacityPerSheet(p, sheet, ns)).toBe(12);
    p.allowRotate = false;
    // 600 가로 2열은 600+5+600 = 1205 > 1200 이라 불가 → 1열 × 7행 = 7
    expect(capacityPerSheet(p, sheet, ns)).toBe(7);
  });

  it("수량만큼 판재를 늘리고, 부품끼리 간격을 지키며 판 밖으로 나가지 않는다", () => {
    const a = rectProduct(600, 300, { name: "A", qty: 30, materialId: "m" });
    const b = rectProduct(250, 250, { name: "B", qty: 25, materialId: "m" });
    const [res] = nestProducts([a, b], [sheet], ns);
    expect(res.pieceCount).toBe(55);
    const placed = res.sheets.reduce((s, sh) => s + sh.placements.length, 0);
    expect(placed).toBe(55);
    // 면적 하한: (30·600·300 + 25·250·250)/(1200·2420) ≈ 2.4 → 최소 3장
    expect(res.sheets.length).toBeGreaterThanOrEqual(3);
    expect(res.sheets.length).toBeLessThanOrEqual(4);
    for (const sh of res.sheets) {
      for (const p of sh.placements) {
        expect(p.x).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(p.x + p.w).toBeLessThanOrEqual(1210 + 1e-6);
        expect(p.y + p.h).toBeLessThanOrEqual(2430 + 1e-6);
      }
      for (let i = 0; i < sh.placements.length; i++)
        for (let j = i + 1; j < sh.placements.length; j++) expect(overlaps(sh.placements[i], sh.placements[j], 5)).toBe(false);
    }
  });

  it("판보다 큰 부품은 배치 불가로 분리한다", () => {
    const big = rectProduct(1300, 2500, { name: "큰판", qty: 1, materialId: "m" });
    const [res] = nestProducts([big], [sheet], ns);
    expect(res.sheets).toHaveLength(0);
    expect(res.oversize).toHaveLength(1);
  });
});

describe("견적", () => {
  const ps: PriceSettings = { ...DEFAULT_PRICE, setupFee: 10000, marginRate: 10, minimumCharge: 0, roundUnit: 1, perPieceFee: 0 };

  it("자재비 + 가공비 + 작업비 + 이윤 + 부가세", () => {
    const p = rectProduct(600, 300, { name: "판넬", qty: 10, materialId: "m" });
    const nests = nestProducts([p], [sheet], ns);
    expect(nests[0].sheets).toHaveLength(1);
    const q = buildQuote([p], nests, [sheet], ps);
    // 자재 100,000 + 가공 (1.8m × 10 × 1,000 = 18,000) + 작업비 10,000 = 128,000 → 이윤 10% = 140,800
    expect(q.cost).toBeCloseTo(128000, 6);
    expect(q.supply).toBe(140800);
    expect(q.vat).toBe(14080);
    expect(q.total).toBe(154880);
    expect(q.products[0].unitPrice).toBe(14080);
  });

  it("부분 청구 모드: 마지막 장은 사용 비율을 단위만큼 올림", () => {
    const p = rectProduct(600, 300, { name: "판넬", qty: 16, materialId: "m" });
    const nests = nestProducts([p], [sheet], ns);
    expect(nests[0].sheets.length).toBe(2);
    const charged = chargedSheets(nests[0], { ...ps, materialMode: "partial", partialStep: 0.25 });
    expect(charged).toBeGreaterThan(1);
    expect(charged).toBeLessThan(2);
    expect((charged * 4) % 1).toBe(0);
  });

  it("최소 작업 금액과 금액 단위 처리", () => {
    const p = rectProduct(100, 100, { name: "소품", qty: 1, materialId: "m" });
    const nests = nestProducts([p], [sheet], ns);
    const q = buildQuote([p], nests, [sheet], { ...ps, minimumCharge: 200000 });
    expect(q.supply).toBe(200000);
    expect(roundMoney(12345, 100, "floor")).toBe(12300);
    expect(roundMoney(12300, 100, "floor")).toBe(12300);
    expect(roundMoney(12301, 100, "ceil")).toBe(12400);
    expect(roundMoney(12350, 100, "round")).toBe(12400);
  });
});
