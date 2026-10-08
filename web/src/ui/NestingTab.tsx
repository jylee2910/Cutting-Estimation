import { useMemo } from "react";
import { Material, NestSettings, Product, materialLabel, partMetrics, productScale, scalePts } from "../core/model";
import { MaterialNest, SheetLayout, groupSheets } from "../core/nest";
import { NumInput, PRODUCT_COLORS, Section, ptsToPath } from "./common";
import { num, pct } from "./format";

interface Props {
  products: Product[];
  materials: Material[];
  nests: MaterialNest[];
  nestSettings: NestSettings;
  setNestSettings: (s: NestSettings) => void;
  capacity: Map<string, number | null>;
}

export function NestingTab({ products, materials, nests, nestSettings, setNestSettings, capacity }: Props) {
  const colorOf = useMemo(() => new Map(products.map((p, i) => [p.id, PRODUCT_COLORS[i % PRODUCT_COLORS.length]])), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const missingMat = products.filter((p) => p.qty > 0 && !materials.some((m) => m.id === p.materialId));

  return (
    <div className="nest-tab">
      <Section
        title="배치 설정"
        right={<span className="note">1단계: 부품 외접 사각형 기준 배치 (실제 윤곽 배치는 2단계 예정)</span>}
      >
        <div className="row wrap">
          <label>부품 간격</label>
          <NumInput value={nestSettings.gap} min={0} onChange={(v) => setNestSettings({ ...nestSettings, gap: v })} width={60} suffix="mm" />
          <span className="note">레이저 2~3, CNC 공구경+여유 5~8</span>
          <label>판재 여백</label>
          <NumInput value={nestSettings.margin} min={0} onChange={(v) => setNestSettings({ ...nestSettings, margin: v })} width={60} suffix="mm" />
        </div>
      </Section>

      {products.length === 0 && <p className="empty">제품을 먼저 추가하세요.</p>}
      {missingMat.length > 0 && <p className="msg warn">판재가 지정되지 않은 제품: {missingMat.map((p) => p.name).join(", ")}</p>}

      {products.length > 0 && (
        <Section title="제품별 소요">
          <table className="grid">
            <thead>
              <tr>
                <th></th>
                <th>제품</th>
                <th>크기 (mm)</th>
                <th className="num">수량</th>
                <th>판재</th>
                <th className="num">판당 최대</th>
                <th className="num">단독 배치 시 장수</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const cap = capacity.get(p.id);
                return (
                  <tr key={p.id}>
                    <td><span className="swatch" style={{ background: colorOf.get(p.id) }} /></td>
                    <td>{p.name}</td>
                    <td>{num(p.w)} × {num(p.h)}</td>
                    <td className="num">{p.qty}</td>
                    <td>{materialLabel(materials.find((m) => m.id === p.materialId))}</td>
                    <td className="num">{cap == null ? "–" : cap === 0 ? <span className="bad">판보다 큼</span> : `${cap}개`}</td>
                    <td className="num">{cap ? `${Math.ceil(p.qty / cap)}장` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">판재가 같은 제품은 함께 배치되므로, 합산 장수는 아래 배치 결과를 기준으로 합니다.</p>
        </Section>
      )}

      {nests.map((n) => (
        <Section
          key={n.material.id}
          title={
            <>
              {materialLabel(n.material)} — <b>{n.sheets.length}장</b>{" "}
              <span className="muted">부품 {n.pieceCount}개 · 효율 {pct(n.utilization)}</span>
            </>
          }
        >
          {n.oversize.length > 0 && (
            <p className="msg error">
              판재보다 커서 배치할 수 없는 부품 {n.oversize.length}개:{" "}
              {[...new Set(n.oversize.map((o) => byId.get(o.productId)?.name))].join(", ")} — 분할 제작하거나 더 큰 판재를 지정하세요.
            </p>
          )}
          <div className="sheets">
            {groupSheets(n.sheets).map((g) => (
              <figure key={g.firstIndex} className="sheet-fig">
                <SheetView sheet={g.layout} material={n.material} byId={byId} colorOf={colorOf} />
                <figcaption>
                  {g.count > 1 ? `${g.firstIndex + 1}~${g.firstIndex + g.count}번 판 (×${g.count})` : `${g.firstIndex + 1}번 판`} ·{" "}
                  {g.layout.placements.length}개 · {pct(g.layout.usedArea / (n.material.sheetW * n.material.sheetH))}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

export function SheetView({
  sheet,
  material,
  byId,
  colorOf,
  width = 220,
}: {
  sheet: SheetLayout;
  material: Material;
  byId: Map<string, Product>;
  colorOf: Map<string, string>;
  width?: number;
}) {
  const W = material.sheetW;
  const H = material.sheetH;
  const metricsCache = new Map<string, ReturnType<typeof partMetrics>>();
  const metricsOf = (p: Product) => {
    let m = metricsCache.get(p.id);
    if (!m) metricsCache.set(p.id, (m = partMetrics(p)));
    return m;
  };
  return (
    <svg className="sheet" viewBox={`${-W * 0.01} ${-H * 0.01} ${W * 1.02} ${H * 1.02}`} width={width} height={(width * H) / W}>
      <rect x={0} y={0} width={W} height={H} className="sheet-bg" />
      {sheet.placements.map((pl, i) => {
        const p = byId.get(pl.productId);
        if (!p) return null;
        const part = p.parts[pl.partIndex];
        const pm = metricsOf(p)[pl.partIndex];
        const { sx, sy } = productScale(p);
        // 부품을 원점으로 옮긴 뒤, 회전 시 90° 돌려서 배치 위치로 이동
        const tf = pl.rotated
          ? `translate(${pl.x + pm.h} ${pl.y}) rotate(90) translate(${-pm.x} ${-pm.y})`
          : `translate(${pl.x} ${pl.y}) translate(${-pm.x} ${-pm.y})`;
        const d = [ptsToPath(scalePts(part.outer, sx, sy), true), ...part.holes.map((h) => ptsToPath(scalePts(h, sx, sy), true))].join(" ");
        const color = colorOf.get(p.id) || "#888";
        return (
          <g key={i}>
            <rect x={pl.x} y={pl.y} width={pl.w} height={pl.h} className="pl-box" />
            <path d={d} transform={tf} fill={color} fillOpacity={0.45} stroke={color} fillRule="evenodd" vectorEffect="non-scaling-stroke">
              <title>{`${p.name} ${num(pl.w)}×${num(pl.h)}${pl.rotated ? " (회전)" : ""}`}</title>
            </path>
          </g>
        );
      })}
    </svg>
  );
}
