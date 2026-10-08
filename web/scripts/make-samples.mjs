// 테스트/시연용 샘플 시안 파일 생성: node scripts/make-samples.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "samples");
mkdirSync(outDir, { recursive: true });

// ── SVG: mm 단위 판넬 시안 ─────────────────────────────
const star = (cx, cy, r1, r2, n = 5) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`);
  }
  return "M" + pts.join("L") + "Z";
};
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="820mm" height="520mm" viewBox="0 0 820 520">
  <style>.cut{fill:none;stroke:#ff0000;stroke-width:0.3}</style>
  <g id="plate" transform="translate(20,20)">
    <rect class="cut" x="0" y="0" width="600" height="300"/>
    <circle class="cut" cx="15" cy="15" r="3"/>
    <circle class="cut" cx="585" cy="15" r="3"/>
    <circle class="cut" cx="15" cy="285" r="3"/>
    <circle class="cut" cx="585" cy="285" r="3"/>
  </g>
  <circle class="cut" cx="720" cy="130" r="70"/>
  <rect class="cut" x="20" y="350" width="150" height="80" rx="10"/>
  <rect class="cut" x="200" y="350" width="150" height="80" rx="10"/>
  <path class="cut" d="${star(480, 420, 80, 35)}"/>
  <text x="20" y="500" font-size="12">판넬 600 x 300 (타공 Ø6 4개), 원형 Ø140, 라운드 150x80 2개, 별</text>
</svg>
`;
writeFileSync(join(outDir, "sample-panels.svg"), svg);

// ── DXF: 선 조각/폴리라인/블록이 섞인 도면 ───────────────
const dxf = [];
const g = (code, value) => dxf.push(String(code), String(value));
g(0, "SECTION"); g(2, "HEADER"); g(9, "$INSUNITS"); g(70, 4); g(0, "ENDSEC");
g(0, "SECTION"); g(2, "BLOCKS");
g(0, "BLOCK"); g(8, "0"); g(2, "BRACKET"); g(70, 0); g(10, 0); g(20, 0); g(30, 0);
// ㄱ자 브래킷 (LWPOLYLINE, 닫힘)
g(0, "LWPOLYLINE"); g(8, "0"); g(90, 6); g(70, 1);
for (const [x, y] of [[0, 0], [120, 0], [120, 120], [90, 120], [90, 30], [0, 30]]) { g(10, x); g(20, y); }
g(0, "CIRCLE"); g(8, "0"); g(10, 105); g(20, 15); g(30, 0); g(40, 4);
g(0, "ENDBLK"); g(8, "0");
g(0, "ENDSEC");
g(0, "SECTION"); g(2, "ENTITIES");
// 장공(슬롯) 형상: LINE 2개 + ARC 2개 → 끝점 연결로 하나의 닫힌 윤곽
g(0, "LINE"); g(8, "CUT"); g(10, 50); g(20, 0); g(30, 0); g(11, 250); g(21, 0); g(31, 0);
g(0, "ARC"); g(8, "CUT"); g(10, 250); g(20, 50); g(30, 0); g(40, 50); g(50, 270); g(51, 90);
g(0, "LINE"); g(8, "CUT"); g(10, 250); g(20, 100); g(30, 0); g(11, 50); g(21, 100); g(31, 0);
g(0, "ARC"); g(8, "CUT"); g(10, 50); g(20, 50); g(30, 0); g(40, 50); g(50, 90); g(51, 270);
// 라운드 사각 (bulge 폴리라인) 200x120, 모서리 R20
{
  const b = Math.tan(Math.PI / 8); // 90° 호
  const pts = [[340, 0, 0], [480, 0, b], [500, 20, 0], [500, 100, b], [480, 120, 0], [340, 120, b], [320, 100, 0], [320, 20, b]];
  g(0, "LWPOLYLINE"); g(8, "CUT"); g(90, pts.length); g(70, 1);
  for (const [x, y, bu] of pts) { g(10, x); g(20, y); if (bu) g(42, bu); }
}
// 도넛(링) 형상: 원 2개 → 바깥 + 구멍
g(0, "CIRCLE"); g(8, "CUT"); g(10, 620); g(20, 60); g(30, 0); g(40, 60);
g(0, "CIRCLE"); g(8, "CUT"); g(10, 620); g(20, 60); g(30, 0); g(40, 30);
// 브래킷 블록 3개 배치 (하나는 90° 회전)
for (const [x, y, r] of [[0, 200, 0], [160, 200, 0], [440, 200, 90]]) {
  g(0, "INSERT"); g(8, "CUT"); g(2, "BRACKET"); g(10, x); g(20, y); g(30, 0); if (r) g(50, r);
}
// 치수/주석 레이어 (형상 아님)
g(0, "LINE"); g(8, "DIM"); g(10, 0); g(20, -30); g(30, 0); g(11, 300); g(21, -30); g(31, 0);
g(0, "TEXT"); g(8, "DIM"); g(10, 100); g(20, -45); g(30, 0); g(40, 10); g(1, "300 x 100 SLOT");
g(0, "ENDSEC");
g(0, "EOF");
writeFileSync(join(outDir, "sample-parts.dxf"), dxf.join("\n") + "\n");

// ── PDF: 900x600mm 페이지, 테두리 + 판넬 + 원판 + 규격 텍스트 ──
const K = 72 / 25.4;
const c = 0.5523; // 원 근사 베지어 상수
const circle = (cx, cy, r) =>
  `${cx + r} ${cy} m ${cx + r} ${cy + r * c} ${cx + r * c} ${cy + r} ${cx} ${cy + r} c ` +
  `${cx - r * c} ${cy + r} ${cx - r} ${cy + r * c} ${cx - r} ${cy} c ` +
  `${cx - r} ${cy - r * c} ${cx - r * c} ${cy - r} ${cx} ${cy - r} c ` +
  `${cx + r * c} ${cy - r} ${cx + r} ${cy - r * c} ${cx + r} ${cy} c h`;
const content = [
  "q",
  `${K.toFixed(6)} 0 0 ${K.toFixed(6)} 0 0 cm`, // 이후 좌표는 mm
  "0.2 w 0 0 0 RG",
  "5 5 890 590 re S", // 도면 테두리
  "1 0 0 RG",
  "50 300 400 250 re S", // 판넬 400x250
  `${circle(70, 320, 4)} S`,
  `${circle(430, 530, 4)} S`,
  `${circle(650, 400, 75)} S`, // 원판 Ø150
  "Q",
  "BT /F1 36 Tf 150 200 Td (W400 x H250  2EA) Tj ET",
  "BT /F1 36 Tf 1700 900 Td (D150 x 150) Tj ET",
].join("\n");
const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(900 * K).toFixed(2)} ${(600 * K).toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let pdf = "%PDF-1.4\n";
const offsets = [];
objs.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(join(outDir, "sample-drawing.pdf"), pdf);

console.log("samples written to", outDir);
