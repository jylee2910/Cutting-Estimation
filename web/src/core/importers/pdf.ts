// PDF (및 PDF 호환 저장된 AI) 불러오기. pdf.js의 연산자 목록에서 벡터 경로를 추출한다.
import { Contour, Drawing, DrawingText } from "../drawing";
import { IDENTITY, Matrix, Pt, apply, flattenCubic, flattenQuad, multiply } from "../geometry";

/** pdf.js 모듈 중 사용하는 부분 (브라우저/Node 빌드를 주입받기 위해 최소 형태로 정의) */
export interface PdfJsLike {
  OPS: Record<string, number>;
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean }): {
    promise: Promise<PdfDocLike>;
    destroy(): Promise<void>;
  };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}
interface PdfPageLike {
  view: number[];
  userUnit?: number;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
}

const PT_TO_MM = 25.4 / 72;
const MAX_PAGES = 20;

// pdf.js DrawOPS
const D_MOVE = 0, D_LINE = 1, D_CURVE = 2, D_QUAD = 3, D_CLOSE = 4;

export async function importPdf(data: Uint8Array, fileName: string, pdfjs: PdfJsLike): Promise<Drawing[]> {
  if (!startsWithPdf(data)) {
    if (/\.ai$/i.test(fileName)) {
      throw new Error(
        "PDF 호환 형식이 아닌 AI 파일입니다. Illustrator에서 'PDF 호환 파일 만들기'를 켜고 저장하거나, PDF/SVG/DXF로 내보내 주세요.",
      );
    }
    throw new Error("PDF 파일이 아닙니다.");
  }
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  const out: Drawing[] = [];
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      out.push(await importPage(page, pdfjs.OPS, doc.numPages > 1 ? `${fileName} (p${n})` : fileName));
    }
    if (doc.numPages > MAX_PAGES) out[0].warnings.push(`페이지가 많아 앞 ${MAX_PAGES}페이지만 불러왔습니다.`);
  } finally {
    await task.destroy();
  }
  return out;
}

function startsWithPdf(d: Uint8Array): boolean {
  // 앞 1KB 안에 %PDF- 시그니처가 있는지
  const head = String.fromCharCode(...d.subarray(0, Math.min(1024, d.length)));
  return head.includes("%PDF-");
}

async function importPage(page: PdfPageLike, OPS: Record<string, number>, name: string): Promise<Drawing> {
  const [x0, y0, x1, y1] = page.view;
  const k = PT_TO_MM * (page.userUnit || 1);
  // PDF 좌표(pt, y-up) → mm, y-down
  const base: Matrix = [k, 0, 0, -k, -x0 * k, y1 * k];
  const pageSize = { w: (x1 - x0) * k, h: (y1 - y0) * k };

  const { fnArray, argsArray } = await page.getOperatorList();
  const contours: Contour[] = [];
  const stack: { ctm: Matrix; stroke: string; fill: string }[] = [];
  let ctm: Matrix = base;
  let stroke = "#000000";
  let fill = "#000000";

  const strokeOps = new Set([OPS.stroke, OPS.closeStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill]);
  const bothOps = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ctm, stroke, fill });
        break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ ctm, stroke, fill } = s);
        break;
      }
      case OPS.transform:
        ctm = multiply(ctm, args as unknown as Matrix);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ctm, stroke, fill });
        if (Array.isArray(args[0]) && (args[0] as number[]).length === 6) ctm = multiply(ctm, args[0] as unknown as Matrix);
        break;
      case OPS.paintFormXObjectEnd: {
        const s = stack.pop();
        if (s) ({ ctm, stroke, fill } = s);
        break;
      }
      case OPS.setStrokeRGBColor:
        if (typeof args[0] === "string") stroke = args[0].toLowerCase();
        break;
      case OPS.setFillRGBColor:
        if (typeof args[0] === "string") fill = args[0].toLowerCase();
        break;
      case OPS.constructPath: {
        const paintOp = args[0] as number;
        // endPath(n) = 클리핑 경로 등 그려지지 않는 경로
        let layer: string;
        if (strokeOps.has(paintOp) || bothOps.has(paintOp)) layer = `선 ${stroke}`;
        else if (fillOps.has(paintOp)) layer = `면 ${fill}`;
        else break;
        const data = (args[1] as unknown[])?.[0];
        if (!data || typeof (data as ArrayLike<number>).length !== "number") break;
        const forceClose = paintOp === OPS.closeStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke || fillOps.has(paintOp);
        for (const sp of drawOpsToPolylines(data as ArrayLike<number>, ctm)) {
          contours.push({ pts: sp.pts, closed: sp.closed || (forceClose && sp.pts.length > 2), layer });
        }
        break;
      }
    }
  }

  const texts: DrawingText[] = [];
  try {
    const tc = await page.getTextContent();
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      if (!it.str?.trim() || !it.transform) continue;
      const p = apply(base, it.transform[4], it.transform[5]);
      texts.push({ text: it.str.trim(), x: p.x, y: p.y });
    }
  } catch {
    // 텍스트 추출 실패는 무시 (형상 인식에는 영향 없음)
  }

  const warnings: string[] = [];
  if (contours.length === 0) {
    warnings.push("PDF에서 벡터 도형을 찾지 못했습니다. 스캔/이미지 PDF는 형상을 인식할 수 없으니 규격을 직접 입력해주세요.");
  }
  return {
    id: "",
    fileName: name,
    format: "pdf",
    contours,
    texts,
    unitNote: "PDF 실제 크기(1pt = 0.3528mm) 기준. 축척 도면이면 배율을 조정하세요",
    warnings,
    pageSize,
  };
}

function drawOpsToPolylines(d: ArrayLike<number>, m: Matrix = IDENTITY): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  let cur: Pt[] | null = null;
  let start: Pt = { x: 0, y: 0 };
  let last: Pt = { x: 0, y: 0 };
  const flush = (closed: boolean) => {
    if (cur && cur.length >= 2) out.push({ pts: cur, closed });
    cur = null;
  };
  let i = 0;
  while (i < d.length) {
    const op = d[i++];
    switch (op) {
      case D_MOVE:
        flush(false);
        last = start = apply(m, d[i], d[i + 1]);
        cur = [last];
        i += 2;
        break;
      case D_LINE:
        last = apply(m, d[i], d[i + 1]);
        (cur ??= [start]).push(last);
        i += 2;
        break;
      case D_CURVE: {
        const p3 = apply(m, d[i + 4], d[i + 5]);
        flattenCubic(last, apply(m, d[i], d[i + 1]), apply(m, d[i + 2], d[i + 3]), p3, (cur ??= [last]));
        last = p3;
        i += 6;
        break;
      }
      case D_QUAD: {
        const p2 = apply(m, d[i + 2], d[i + 3]);
        flattenQuad(last, apply(m, d[i], d[i + 1]), p2, (cur ??= [last]));
        last = p2;
        i += 4;
        break;
      }
      case D_CLOSE:
        flush(true);
        last = start;
        break;
      default:
        i = d.length; // 알 수 없는 코드 → 중단
    }
  }
  flush(false);
  return out;
}
