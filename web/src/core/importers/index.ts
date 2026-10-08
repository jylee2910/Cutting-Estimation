// 파일 확장자에 따라 알맞은 불러오기 모듈을 고른다 (브라우저용)
import { Drawing, joinContours } from "../drawing";
import { importDxf } from "./dxf";
import type { PdfJsLike } from "./pdf";
import { importPdf } from "./pdf";
import { importSvg } from "./svg";

export const ACCEPT = ".svg,.dxf,.pdf,.ai";

let pdfjsPromise: Promise<PdfJsLike> | null = null;
function loadPdfJs(): Promise<PdfJsLike> {
  pdfjsPromise ??= (async () => {
    // 사무실 PC의 구형 브라우저도 지원하도록 legacy 빌드를 쓴다
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfJsLike;
  })();
  return pdfjsPromise;
}

let seq = 0;
const newId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function importFile(file: File): Promise<Drawing[]> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  let drawings: Drawing[];
  switch (ext) {
    case "svg":
      drawings = [importSvg(await file.text(), file.name)];
      break;
    case "dxf":
      drawings = [importDxf(await readText(file), file.name)];
      break;
    case "pdf":
    case "ai":
      drawings = await importPdf(new Uint8Array(await file.arrayBuffer()), file.name, await loadPdfJs());
      break;
    case "eps":
      throw new Error("EPS는 아직 지원하지 않습니다. Illustrator 등에서 PDF, SVG 또는 DXF로 저장해 불러와 주세요.");
    case "dwg":
      throw new Error("DWG는 지원하지 않습니다. CAD에서 DXF로 저장해 불러와 주세요.");
    default:
      throw new Error(`지원하지 않는 파일 형식입니다: .${ext} (지원: SVG, DXF, PDF, AI)`);
  }
  return drawings.map((d) => ({ ...d, id: newId(), contours: d.format === "dxf" ? d.contours : joinContours(d.contours) }));
}

/** DXF는 오래된 파일이 CP949(EUC-KR)인 경우가 있어 UTF-8 실패 시 재시도한다 */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(buf);
    } catch {
      return new TextDecoder("utf-8").decode(buf);
    }
  }
}
