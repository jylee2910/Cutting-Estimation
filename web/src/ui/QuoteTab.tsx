import { useMemo, useState } from "react";
import { Material, PriceSettings, Product, QuoteInfo, materialLabel } from "../core/model";
import { MaterialNest, groupSheets } from "../core/nest";
import type { Quote } from "../core/pricing";
import { PRODUCT_COLORS, Section, copyText, isEmbedded } from "./common";
import { num, pct, won } from "./format";
import { SheetView } from "./NestingTab";
import { downloadFile } from "./storage";

interface Props {
  quote: Quote;
  info: QuoteInfo;
  setInfo: (i: QuoteInfo) => void;
  products: Product[];
  materials: Material[];
  nests: MaterialNest[];
  priceSettings: PriceSettings;
}

export function QuoteTab({ quote, info, setInfo, products, materials, nests, priceSettings }: Props) {
  const colorOf = useMemo(() => new Map(products.map((p, i) => [p.id, PRODUCT_COLORS[i % PRODUCT_COLORS.length]])), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const field = (k: keyof QuoteInfo, label: string, wide = false) => (
    <label className={"field" + (wide ? " wide" : "")}>
      <span>{label}</span>
      <input value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
    </label>
  );

  const [copied, setCopied] = useState("");
  const buildRows = () => {
    const rows: (string | number)[][] = [
      ["견적번호", info.number],
      ["일자", info.date],
      ["고객", info.customer],
      ["건명", info.title],
      [],
      ["[제품별 견적]"],
      ["품명", "규격", "수량", "단가", "금액"],
      ...quote.products.map((p) => [p.name, p.spec, p.qty, p.unitPrice, p.amount]),
      ...(quote.productAdjust !== 0 ? [["단수 조정", "", "", "", quote.productAdjust]] : []),
      [],
      ["[산출 내역]"],
      ["구분", "항목", "규격", "수량", "단위", "단가", "금액"],
      ...quote.lines.map((l) => [l.category, l.name, l.spec, l.qty, l.unit, l.unitPrice, Math.round(l.amount)]),
      ["", "원가 합계", "", "", "", "", Math.round(quote.cost)],
      ["", `이윤·관리비 ${priceSettings.marginRate}%`, "", "", "", "", Math.round(quote.margin)],
      ...(quote.minimumAdjust > 0 ? [["", "최소 작업 금액 보정", "", "", "", "", Math.round(quote.minimumAdjust)]] : []),
      ["", "공급가액", "", "", "", "", quote.supply],
      ["", `부가세 ${priceSettings.vatRate}%`, "", "", "", "", quote.vat],
      ["", "합계", "", "", "", "", quote.total],
      [],
      ["메모", info.memo],
    ];
    return rows;
  };
  const exportCsv = () => {
    const csv = buildRows().map((r) => r.map(csvCell).join(",")).join("\r\n");
    // 엑셀에서 한글이 깨지지 않도록 BOM 추가
    downloadFile(`견적_${info.number || info.date}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
  };
  const copyForExcel = async () => {
    // 탭으로 구분한 텍스트는 엑셀에 붙여넣으면 칸이 그대로 나뉜다
    const tsv = buildRows().map((r) => r.map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
    const ok = await copyText(tsv);
    setCopied(ok ? "복사했습니다. 엑셀 시트에 붙여넣으세요." : "이 브라우저에서는 복사가 막혀 있습니다.");
    setTimeout(() => setCopied(""), 4000);
  };

  return (
    <div className="quote-tab">
      <div className="quote-actions no-print">
        {!isEmbedded && <button className="primary" onClick={() => window.print()}>인쇄 / PDF 저장</button>}
        {!isEmbedded && <button onClick={exportCsv}>엑셀(CSV) 내보내기</button>}
        <button className={isEmbedded ? "primary" : ""} onClick={copyForExcel}>엑셀용 복사</button>
        <span className="note">
          {copied ||
            (isEmbedded
              ? "링크 버전에서는 인쇄와 파일 저장이 막혀 있어 복사만 됩니다."
              : "제품 단가는 자재·가공비를 제품별로 배분한 참고값입니다.")}
        </span>
      </div>

      <div className="print-area">
        <div className="quote-head">
          <h2>견 적 서</h2>
          <div className="quote-fields">
            {field("number", "견적번호")}
            {field("date", "일자")}
            {field("customer", "고객명")}
            {field("title", "건명", true)}
          </div>
        </div>

        <div className="total-box">
          <div>
            <span>합계 (부가세 포함)</span>
            <strong>₩ {won(quote.total)}</strong>
          </div>
          <div className="muted">
            공급가 {won(quote.supply)} + 부가세 {won(quote.vat)}
          </div>
        </div>

        <Section title="제품별 견적">
          <table className="grid quote">
            <thead>
              <tr>
                <th>No</th>
                <th>품명</th>
                <th>규격</th>
                <th className="num">수량</th>
                <th className="num">단가</th>
                <th className="num">금액</th>
              </tr>
            </thead>
            <tbody>
              {quote.products.map((p, i) => (
                <tr key={p.productId}>
                  <td className="center">{i + 1}</td>
                  <td>{p.name}</td>
                  <td>{p.spec}</td>
                  <td className="num">{p.qty}</td>
                  <td className="num">{won(p.unitPrice)}</td>
                  <td className="num">{won(p.amount)}</td>
                </tr>
              ))}
              {quote.products.length === 0 && (
                <tr><td colSpan={6} className="muted center">제품이 없습니다.</td></tr>
              )}
            </tbody>
            <tfoot>
              {quote.productAdjust !== 0 && quote.products.length > 0 && (
                <tr>
                  <td colSpan={5} className="right">단수 조정</td>
                  <td className="num">{won(quote.productAdjust)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={5} className="right">공급가액</td>
                <td className="num">{won(quote.supply)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>

        <Section title="산출 내역">
          <table className="grid quote">
            <thead>
              <tr>
                <th>구분</th>
                <th>항목</th>
                <th>규격</th>
                <th className="num">수량</th>
                <th className="num">단가</th>
                <th className="num">금액</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.category}</td>
                  <td>{l.name}</td>
                  <td>{l.spec}</td>
                  <td className="num">{num(l.qty, 2)} {l.unit}</td>
                  <td className="num">{won(l.unitPrice)}</td>
                  <td className="num">{won(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="right">원가 합계</td><td className="num">{won(quote.cost)}</td></tr>
              <tr><td colSpan={5} className="right">이윤·관리비 ({priceSettings.marginRate}%)</td><td className="num">{won(quote.margin)}</td></tr>
              {quote.minimumAdjust > 0 && (
                <tr><td colSpan={5} className="right">최소 작업 금액 보정 ({won(priceSettings.minimumCharge)}원)</td><td className="num">{won(quote.minimumAdjust)}</td></tr>
              )}
              <tr><td colSpan={5} className="right">공급가액 ({priceSettings.roundUnit}원 단위 {roundLabel(priceSettings.roundMode)})</td><td className="num">{won(quote.supply)}</td></tr>
              <tr><td colSpan={5} className="right">부가세 ({priceSettings.vatRate}%)</td><td className="num">{won(quote.vat)}</td></tr>
              <tr className="grand"><td colSpan={5} className="right">합계</td><td className="num">{won(quote.total)}</td></tr>
            </tfoot>
          </table>
          <p className="note">
            판재 {quote.totals.sheets}장 사용
            {quote.totals.chargedSheets !== quote.totals.sheets ? ` (청구 ${num(quote.totals.chargedSheets, 2)}장)` : ""} · 부품 {quote.totals.pieces}개 · 가공 길이{" "}
            {num(quote.totals.cutLengthM, 2)} m · 제품 면적 {num(quote.totals.areaM2, 2)} ㎡
          </p>
        </Section>

        {nests.length > 0 && (
          <Section title="판재 배치 요약" className="print-break">
            {nests.map((n) => (
              <div key={n.material.id} className="nest-summary">
                <h4>
                  {materialLabel(n.material)} — {n.sheets.length}장 (효율 {pct(n.utilization)})
                </h4>
                <div className="sheets small">
                  {groupSheets(n.sheets).slice(0, 8).map((g) => (
                    <figure key={g.firstIndex} className="sheet-fig">
                      <SheetView sheet={g.layout} material={n.material} byId={byId} colorOf={colorOf} width={110} />
                      <figcaption>{g.count > 1 ? `×${g.count}` : `${g.firstIndex + 1}번`}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}

        <label className="field wide memo">
          <span>메모 / 특기사항</span>
          <textarea rows={3} value={info.memo} onChange={(e) => setInfo({ ...info, memo: e.target.value })} />
        </label>
        <p className="note">※ 본 견적은 시안 기준 대략 견적이며, 최종 도면·수량 확정 시 변동될 수 있습니다.</p>
      </div>
      {materials.length === 0 && <p className="msg warn">등록된 판재가 없습니다. 설정에서 판재를 추가하세요.</p>}
    </div>
  );
}

const roundLabel = (m: PriceSettings["roundMode"]) => (m === "floor" ? "절사" : m === "ceil" ? "올림" : "반올림");

function csvCell(v: string | number | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
