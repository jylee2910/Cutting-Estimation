import { useState } from "react";
import { Material, Product, materialLabel, productMetrics, productScale, rectProduct, scalePts } from "../core/model";
import { ConfirmButton, NumInput, PRODUCT_COLORS, Section, ptsToPath } from "./common";
import { num } from "./format";

interface Props {
  products: Product[];
  setProducts: (f: (prev: Product[]) => Product[]) => void;
  materials: Material[];
  defaultMaterialId: string;
  setDefaultMaterialId: (id: string) => void;
  capacity: Map<string, number | null>;
}

export function ProductList({ products, setProducts, materials, defaultMaterialId, setDefaultMaterialId, capacity }: Props) {
  const [mw, setMw] = useState(600);
  const [mh, setMh] = useState(300);
  const [mq, setMq] = useState(1);

  const patch = (id: string, f: (p: Product) => Partial<Product>) =>
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...f(p) } : p)));

  const setW = (p: Product, w: number) =>
    patch(p.id, () => (p.lockRatio && p.baseW > 0 ? { w, h: round1((w * p.baseH) / p.baseW) } : { w }));
  const setH = (p: Product, h: number) =>
    patch(p.id, () => (p.lockRatio && p.baseH > 0 ? { h, w: round1((h * p.baseW) / p.baseH) } : { h }));

  return (
    <Section
      className="product-panel"
      title={<>③ 제품 목록 <span className="muted">{products.length}종</span></>}
      right={
        products.length > 0 && (
          <ConfirmButton onConfirm={() => setProducts(() => [])} confirmText="한 번 더 누르면 모두 삭제">
            모두 삭제
          </ConfirmButton>
        )
      }
    >
      <div className="row default-mat">
        <label>새 제품 기본 판재</label>
        <select value={defaultMaterialId} onChange={(e) => setDefaultMaterialId(e.target.value)}>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{materialLabel(m)}</option>
          ))}
        </select>
      </div>

      <details className="manual-add">
        <summary>직접 입력 (사각 제품)</summary>
        <div className="row">
          <NumInput value={mw} min={1} onChange={setMw} width={64} />
          <span>×</span>
          <NumInput value={mh} min={1} onChange={setMh} width={64} suffix="mm" />
          <label>수량</label>
          <NumInput value={mq} min={1} onChange={(v) => setMq(Math.round(v))} width={50} />
          <button
            className="primary small"
            onClick={() =>
              setProducts((prev) => [...prev, rectProduct(mw, mh, { name: `사각 ${mw}×${mh}`, qty: mq, materialId: defaultMaterialId })])
            }
          >
            추가
          </button>
        </div>
      </details>

      {products.length === 0 && <p className="muted center pad">도면에서 형상을 선택해 제품으로 추가하세요.</p>}

      <div className="product-cards">
        {products.map((p, i) => {
          const m = productMetrics(p);
          const cap = capacity.get(p.id);
          const mat = materials.find((x) => x.id === p.materialId);
          return (
            <div key={p.id} className="product-card">
              <div className="pc-head">
                <Thumb product={p} color={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} />
                <div className="pc-title">
                  <input className="name" value={p.name} onChange={(e) => patch(p.id, () => ({ name: e.target.value }))} />
                  <span className="muted small-text">{p.source}{p.parts.length > 1 ? ` · 조각 ${p.parts.length}개` : ""}</span>
                </div>
                <button className="icon" title="삭제" onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}>×</button>
              </div>
              <div className="pc-grid">
                <label>크기</label>
                <div className="row tight">
                  <NumInput value={p.w} min={0.1} onChange={(v) => setW(p, v)} width={62} />
                  <span>×</span>
                  <NumInput value={p.h} min={0.1} onChange={(v) => setH(p, v)} width={62} suffix="mm" />
                  <label className="check" title="가로·세로 비율 고정">
                    <input type="checkbox" checked={p.lockRatio} onChange={(e) => patch(p.id, () => ({ lockRatio: e.target.checked }))} />
                    비율
                  </label>
                </div>
                <label>수량</label>
                <div className="row tight">
                  <NumInput value={p.qty} min={0} onChange={(v) => patch(p.id, () => ({ qty: Math.round(v) }))} width={62} suffix="개" />
                  <label className="check" title="배치 시 90° 회전 허용 (결 방향이 있는 소재는 해제)">
                    <input type="checkbox" checked={p.allowRotate} onChange={(e) => patch(p.id, () => ({ allowRotate: e.target.checked }))} />
                    회전 허용
                  </label>
                </div>
                <label>판재</label>
                <select value={p.materialId} onChange={(e) => patch(p.id, () => ({ materialId: e.target.value }))}>
                  {!mat && <option value={p.materialId}>(삭제된 판재)</option>}
                  {materials.map((x) => (
                    <option key={x.id} value={x.id}>{materialLabel(x)}</option>
                  ))}
                </select>
              </div>
              <div className="pc-stats">
                <span>가공 {num(m.cutLength / 1000, 2)} m/개</span>
                <span>면적 {num(m.area / 1e6, 3)} ㎡/개</span>
                <span className={cap === 0 ? "bad" : ""}>
                  판당 최대 {cap == null ? "–" : cap === 0 ? "불가(판보다 큼)" : `${cap}개`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function Thumb({ product, color, size = 44 }: { product: Product; color: string; size?: number }) {
  const { sx, sy } = productScale(product);
  const w = Math.max(product.w, 1);
  const h = Math.max(product.h, 1);
  const d = product.parts
    .map((pt) => [ptsToPath(scalePts(pt.outer, sx, sy), true), ...pt.holes.map((x) => ptsToPath(scalePts(x, sx, sy), true))].join(" "))
    .join(" ");
  const pad = Math.max(w, h) * 0.06;
  return (
    <svg className="thumb" width={size} height={size} viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}>
      <path d={d} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" fillRule="evenodd" />
    </svg>
  );
}
