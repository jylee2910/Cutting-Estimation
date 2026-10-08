// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultExcluded, detectShapes, findSizeHints, joinContours } from "../src/core/drawing";
import { importDxf } from "../src/core/importers/dxf";
import { importPdf, PdfJsLike } from "../src/core/importers/pdf";
import { importSvg } from "../src/core/importers/svg";

const sample = (name: string) => join(__dirname, "..", "..", "samples", name);
const r1 = (v: number) => Math.round(v * 10) / 10;

describe("SVG", () => {
  const d = importSvg(readFileSync(sample("sample-panels.svg"), "utf8"), "sample-panels.svg");
  d.contours = joinContours(d.contours);
  const shapes = detectShapes(d);

  it("mm 단위 SVG를 실제 크기로 읽는다", () => {
    expect(shapes).toHaveLength(5);
    const plate = shapes.find((s) => r1(s.w) === 600)!;
    expect(r1(plate.h)).toBe(300);
    expect(plate.holes).toHaveLength(4);
    // 둘레 1800 + 구멍 4 × 2π·3
    expect(plate.cutLength).toBeCloseTo(1800 + 4 * 2 * Math.PI * 3, 0);
  });

  it("같은 형상은 같은 서명을 가진다", () => {
    const rounded = shapes.filter((s) => r1(s.w) === 150);
    expect(rounded).toHaveLength(2);
    expect(rounded[0].signature).toBe(rounded[1].signature);
  });

  it("텍스트에서 규격 후보를 찾는다", () => {
    expect(findSizeHints(d.texts).map((h) => [h.w, h.h])).toContainEqual([600, 300]);
  });
});

describe("DXF", () => {
  const d = importDxf(readFileSync(sample("sample-parts.dxf"), "utf8"), "sample-parts.dxf");

  it("레이어를 구분하고, 선 조각을 이어 닫힌 윤곽으로 만든다", () => {
    const shapes = detectShapes(d, { layers: new Set(["CUT"]) });
    const sizes = shapes.map((s) => `${r1(s.w)}x${r1(s.h)}`).sort();
    expect(sizes).toEqual(["120x120", "120x120", "120x120", "120x120", "180x120", "300x100"].sort());
  });

  it("블록 삽입(회전 포함)은 같은 형상으로, 크기만 같은 링은 다른 형상으로 판별한다", () => {
    const shapes = detectShapes(d, { layers: new Set(["CUT"]) });
    const sq = shapes.filter((s) => r1(s.w) === 120 && r1(s.h) === 120);
    const counts = new Map<string, number>();
    for (const s of sq) counts.set(s.signature, (counts.get(s.signature) || 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 3]);
  });
});

describe("PDF", () => {
  it("벡터 경로와 텍스트를 mm로 읽고 페이지 테두리는 기본 제외한다", async () => {
    const data = new Uint8Array(readFileSync(sample("sample-drawing.pdf")));
    const [d] = await importPdf(data, "sample-drawing.pdf", pdfjs as unknown as PdfJsLike);
    const ex = defaultExcluded(d);
    expect(ex.size).toBe(1);
    const shapes = detectShapes(d, { excluded: ex });
    const sizes = shapes.map((s) => `${Math.round(s.w)}x${Math.round(s.h)}`).sort();
    expect(sizes).toEqual(["150x150", "400x250"]);
    expect(shapes.find((s) => Math.round(s.w) === 400)!.holes).toHaveLength(2);
    expect(findSizeHints(d.texts).map((h) => [h.w, h.h])).toContainEqual([400, 250]);
  });
});
