import { DEFAULT_MATERIALS, DEFAULT_PRICE, EXTRA_BASIS_LABEL, ExtraBasis, Material, PriceSettings, Product, uid } from "../core/model";
import { ConfirmButton, NumInput, Section } from "./common";

interface Props {
  materials: Material[];
  setMaterials: (f: (prev: Material[]) => Material[]) => void;
  priceSettings: PriceSettings;
  setPriceSettings: (p: PriceSettings) => void;
  products: Product[];
}

export function SettingsTab({ materials, setMaterials, priceSettings: ps, setPriceSettings, products }: Props) {
  const patchMat = (id: string, patch: Partial<Material>) => setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const set = (patch: Partial<PriceSettings>) => setPriceSettings({ ...ps, ...patch });
  const used = new Set(products.map((p) => p.materialId));

  return (
    <div className="settings-tab">
      <Section
        title="판재 등록"
        right={
          <>
            <button
              className="small"
              onClick={() =>
                setMaterials((prev) => [
                  ...prev,
                  { id: uid("m"), name: "새 판재", thickness: 3, sheetW: 1220, sheetH: 2440, pricePerSheet: 0, cutPricePerM: 0 },
                ])
              }
            >
              + 판재 추가
            </button>
            <ConfirmButton
              title="직접 추가한 판재는 사라집니다"
              onConfirm={() => setMaterials(() => DEFAULT_MATERIALS)}
              confirmText="한 번 더 누르면 복원"
            >
              기본값 복원
            </ConfirmButton>
          </>
        }
      >
        <p className="note">기본 단가는 예시입니다. 실제 매입가·가공 단가로 수정하세요. 설정은 이 브라우저에 저장됩니다.</p>
        <div className="table-wrap">
          <table className="grid edit">
            <thead>
              <tr>
                <th>판재명</th>
                <th>두께 (T)</th>
                <th>가로 (mm)</th>
                <th>세로 (mm)</th>
                <th>장당 단가 (원)</th>
                <th>가공 단가 (원/m)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td><input value={m.name} onChange={(e) => patchMat(m.id, { name: e.target.value })} /></td>
                  <td><NumInput value={m.thickness} min={0} onChange={(v) => patchMat(m.id, { thickness: v })} width={50} /></td>
                  <td><NumInput value={m.sheetW} min={1} onChange={(v) => patchMat(m.id, { sheetW: v })} width={64} /></td>
                  <td><NumInput value={m.sheetH} min={1} onChange={(v) => patchMat(m.id, { sheetH: v })} width={64} /></td>
                  <td><NumInput value={m.pricePerSheet} min={0} onChange={(v) => patchMat(m.id, { pricePerSheet: v })} width={90} /></td>
                  <td><NumInput value={m.cutPricePerM} min={0} onChange={(v) => patchMat(m.id, { cutPricePerM: v })} width={70} /></td>
                  <td className="nowrap">
                    <button className="small" onClick={() => setMaterials((prev) => [...prev, { ...m, id: uid("m"), name: m.name + " (복사)" }])}>복제</button>
                    <button
                      className="small"
                      disabled={used.has(m.id)}
                      title={used.has(m.id) ? "제품에서 사용 중인 판재는 삭제할 수 없습니다" : "삭제"}
                      onClick={() => setMaterials((prev) => prev.filter((x) => x.id !== m.id))}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="단가 설정" right={<button className="small" onClick={() => setPriceSettings({ ...DEFAULT_PRICE, extras: ps.extras })}>기본값</button>}>
        <div className="form-grid">
          <label>자재비 계산</label>
          <div className="row wrap">
            <label className="check">
              <input type="radio" checked={ps.materialMode === "full"} onChange={() => set({ materialMode: "full" })} />
              사용 판재 전체 장수
            </label>
            <label className="check">
              <input type="radio" checked={ps.materialMode === "partial"} onChange={() => set({ materialMode: "partial" })} />
              마지막 장은 사용 비율만큼
            </label>
            {ps.materialMode === "partial" && (
              <select value={ps.partialStep} onChange={(e) => set({ partialStep: parseFloat(e.target.value) })}>
                <option value={0.25}>1/4장 단위 올림</option>
                <option value={0.5}>1/2장 단위 올림</option>
                <option value={0.1}>10% 단위 올림</option>
              </select>
            )}
          </div>
          <label>기본 작업비</label>
          <NumInput value={ps.setupFee} min={0} onChange={(v) => set({ setupFee: v })} width={90} suffix="원 / 건" />
          <label>개당 가공비</label>
          <NumInput value={ps.perPieceFee} min={0} onChange={(v) => set({ perPieceFee: v })} width={90} suffix="원 / 부품" />
          <label>이윤·관리비</label>
          <NumInput value={ps.marginRate} min={0} onChange={(v) => set({ marginRate: v })} width={60} suffix="%" />
          <label>최소 작업 금액</label>
          <NumInput value={ps.minimumCharge} min={0} onChange={(v) => set({ minimumCharge: v })} width={90} suffix="원 (공급가 기준)" />
          <label>부가세</label>
          <NumInput value={ps.vatRate} min={0} onChange={(v) => set({ vatRate: v })} width={60} suffix="%" />
          <label>금액 단위</label>
          <div className="row">
            <select value={ps.roundUnit} onChange={(e) => set({ roundUnit: parseInt(e.target.value) })}>
              {[1, 10, 100, 1000, 10000].map((u) => (
                <option key={u} value={u}>{u.toLocaleString()}원</option>
              ))}
            </select>
            <select value={ps.roundMode} onChange={(e) => set({ roundMode: e.target.value as PriceSettings["roundMode"] })}>
              <option value="round">반올림</option>
              <option value="floor">절사</option>
              <option value="ceil">올림</option>
            </select>
          </div>
        </div>
        <p className="note">재단·가공비는 판재별 '가공 단가(원/m)' × 가공 길이(외곽 + 구멍 + 내부선)로 계산합니다.</p>
      </Section>

      <Section
        title="추가 비용 항목"
        right={
          <button
            className="small"
            onClick={() => set({ extras: [...ps.extras, { id: uid("x"), name: "새 항목", basis: "fixed", unitPrice: 0, enabled: true }] })}
          >
            + 항목 추가
          </button>
        }
      >
        <p className="note">예: 시트 부착(㎡당), 모서리 연마(m당), 포장·운송(건당), 양면테이프(개당) 등</p>
        {ps.extras.length === 0 ? (
          <p className="muted">추가 항목이 없습니다.</p>
        ) : (
          <table className="grid edit">
            <thead>
              <tr>
                <th>사용</th>
                <th>항목명</th>
                <th>기준</th>
                <th>단가 (원)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ps.extras.map((x) => {
                const patch = (p: Partial<typeof x>) => set({ extras: ps.extras.map((e) => (e.id === x.id ? { ...e, ...p } : e)) });
                return (
                  <tr key={x.id}>
                    <td className="center"><input type="checkbox" checked={x.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /></td>
                    <td><input value={x.name} onChange={(e) => patch({ name: e.target.value })} /></td>
                    <td>
                      <select value={x.basis} onChange={(e) => patch({ basis: e.target.value as ExtraBasis })}>
                        {(Object.keys(EXTRA_BASIS_LABEL) as ExtraBasis[]).map((b) => (
                          <option key={b} value={b}>{EXTRA_BASIS_LABEL[b]}</option>
                        ))}
                      </select>
                    </td>
                    <td><NumInput value={x.unitPrice} min={0} onChange={(v) => patch({ unitPrice: v })} width={90} /></td>
                    <td><button className="small" onClick={() => set({ extras: ps.extras.filter((e) => e.id !== x.id) })}>삭제</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
