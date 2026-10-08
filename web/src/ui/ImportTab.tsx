import { useMemo, useState } from "react";
import { Drawing, Shape, detectShapes, findSizeHints, layersOf } from "../core/drawing";
import { ACCEPT, importFile } from "../core/importers";
import { Material, Product, productFromShapes, rectProduct } from "../core/model";
import { NumInput, Section } from "./common";
import { DrawingCanvas } from "./DrawingCanvas";
import { num } from "./format";
import { ProductList } from "./ProductList";

const SAMPLE_FILES = ["sample-panels.svg", "sample-parts.dxf", "sample-drawing.pdf"];

export interface DrawingState {
  drawing: Drawing;
  excluded: number[];
  layers: string[];
  scale: number;
}

interface Props {
  drawings: DrawingState[];
  setDrawings: (f: (prev: DrawingState[]) => DrawingState[]) => void;
  onImported: (ds: Drawing[]) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  products: Product[];
  setProducts: (f: (prev: Product[]) => Product[]) => void;
  materials: Material[];
  defaultMaterialId: string;
  setDefaultMaterialId: (id: string) => void;
  capacity: Map<string, number | null>;
}

export function ImportTab(props: Props) {
  const { drawings, setDrawings, activeId, setActiveId, products, setProducts, materials, defaultMaterialId } = props;
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [multiplier, setMultiplier] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [calib, setCalib] = useState(0);

  const active = drawings.find((d) => d.drawing.id === activeId) || null;
  const update = (patch: Partial<DrawingState>) =>
    setDrawings((prev) => prev.map((d) => (d.drawing.id === activeId ? { ...d, ...patch } : d)));

  const excludedSet = useMemo(() => new Set(active?.excluded || []), [active]);
  const layerSet = useMemo(() => new Set(active?.layers || []), [active]);
  const shapes: Shape[] = useMemo(
    () => (active ? detectShapes(active.drawing, { excluded: excludedSet, layers: layerSet, scale: active.scale }) : []),
    [active, excludedSet, layerSet],
  );
  const sigCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shapes) m.set(s.signature, (m.get(s.signature) || 0) + 1);
    return m;
  }, [shapes]);
  const added = useMemo(() => {
    const s = new Set<number>();
    for (const p of products) if (p.sourceRef && p.sourceRef.drawingId === activeId) p.sourceRef.shapeIndices.forEach((i) => s.add(i));
    return s;
  }, [products, activeId]);
  const hints = useMemo(() => (active ? findSizeHints(active.drawing.texts) : []), [active]);
  const allLayers = useMemo(() => (active ? layersOf(active.drawing) : []), [active]);

  const handleFiles = async (files: FileList | File[]) => {
    setBusy(true);
    const errs: string[] = [];
    const loaded: Drawing[] = [];
    for (const f of Array.from(files)) {
      try {
        loaded.push(...(await importFile(f)));
      } catch (e) {
        errs.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setErrors(errs);
    if (loaded.length) {
      props.onImported(loaded);
      setSelected(new Set());
    }
    setBusy(false);
  };

  const loadSamples = async () => {
    try {
      const files = await Promise.all(
        SAMPLE_FILES.map(async (name) => {
          const res = await fetch(`./${name}`);
          if (!res.ok) throw new Error(`${name} (${res.status})`);
          return new File([await res.blob()], name);
        }),
      );
      await handleFiles(files);
    } catch (e) {
      setErrors([`샘플을 불러오지 못했습니다: ${(e as Error).message}`]);
    }
  };

  const selectedShapes = shapes.filter((s) => selected.has(s.index));
  const fileBase = active ? active.drawing.fileName.replace(/\.[^.]+$/, "") : "";

  const addEach = () => {
    if (!active) return;
    // 같은 형상은 하나의 제품으로 묶고 수량으로 합친다
    const groups = new Map<string, Shape[]>();
    for (const s of selectedShapes) {
      const g = groups.get(s.signature) || [];
      g.push(s);
      groups.set(s.signature, g);
    }
    const base = products.length;
    const created = [...groups.values()].map((g, i) =>
      productFromShapes([g[0]], {
        name: `${fileBase} #${base + i + 1}`,
        source: active.drawing.fileName,
        qty: g.length * multiplier,
        materialId: defaultMaterialId,
        drawingId: active.drawing.id,
      }),
    );
    // 묶인 나머지 형상도 '추가됨'으로 표시
    created.forEach((p, i) => (p.sourceRef!.shapeIndices = [...groups.values()][i].map((s) => s.index)));
    setProducts((prev) => [...prev, ...created]);
    setSelected(new Set());
  };

  const addAsSet = () => {
    if (!active || selectedShapes.length === 0) return;
    const p = productFromShapes(selectedShapes, {
      name: `${fileBase} 세트`,
      source: active.drawing.fileName,
      qty: multiplier,
      materialId: defaultMaterialId,
      drawingId: active.drawing.id,
    });
    setProducts((prev) => [...prev, p]);
    setSelected(new Set());
  };

  const toggle = (index: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(index)) n.delete(index);
      else n.add(index);
      return n;
    });

  const selectSame = () => {
    const sigs = new Set(selectedShapes.map((s) => s.signature));
    setSelected(new Set(shapes.filter((s) => sigs.has(s.signature)).map((s) => s.index)));
  };

  const applyCalibration = () => {
    if (!active || selectedShapes.length !== 1 || calib <= 0) return;
    const s = selectedShapes[0];
    const raw = s.w / active.scale;
    if (raw > 0) update({ scale: calib / raw });
  };

  return (
    <div className="import-tab">
      <aside className="sidebar">
        <Section title="① 시안 불러오기">
          <label
            className={"dropzone" + (dragOver ? " over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            <input type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && handleFiles(e.target.files)} />
            <strong>{busy ? "불러오는 중…" : "파일을 끌어놓거나 클릭"}</strong>
            <span>SVG · DXF · PDF · AI(PDF 호환)</span>
          </label>
          {errors.map((e, i) => (
            <p key={i} className="msg error">{e}</p>
          ))}
          {drawings.length > 0 && (
            <ul className="file-list">
              {drawings.map((d) => (
                <li key={d.drawing.id} className={d.drawing.id === activeId ? "active" : ""}>
                  <button className="link" onClick={() => { setActiveId(d.drawing.id); setSelected(new Set()); }}>
                    {d.drawing.fileName}
                  </button>
                  <button
                    className="icon"
                    title="목록에서 제거"
                    onClick={() => {
                      setDrawings((prev) => prev.filter((x) => x.drawing.id !== d.drawing.id));
                      if (d.drawing.id === activeId) setActiveId(drawings.find((x) => x.drawing.id !== d.drawing.id)?.drawing.id ?? null);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {active && (
          <>
            <Section title="도면 단위 · 배율">
              <p className="note">{active.drawing.unitNote}</p>
              <div className="row">
                <label>배율</label>
                <NumInput value={active.scale} min={0.0001} onChange={(v) => update({ scale: v })} width={90} />
                <button onClick={() => update({ scale: 1 })} disabled={active.scale === 1}>1:1</button>
              </div>
              <div className="row">
                <label title="형상 하나를 선택하고 실제 가로 길이를 입력하면 도면 전체 배율을 맞춥니다">기준 가로</label>
                <NumInput value={calib} min={0} onChange={setCalib} width={90} suffix="mm" />
                <button onClick={applyCalibration} disabled={selectedShapes.length !== 1 || calib <= 0}>맞추기</button>
              </div>
              <p className="note">축척 도면(1:10 등)은 배율 10, 또는 형상 1개 선택 후 실제 가로 길이로 맞추세요.</p>
              {active.drawing.warnings.map((w, i) => (
                <p key={i} className="msg warn">{w}</p>
              ))}
            </Section>

            {allLayers.length > 1 && (
              <Section title="레이어 / 색상" right={<button className="small" onClick={() => update({ layers: allLayers })}>전체</button>}>
                <p className="note">절단선만 남기면 인식이 정확해집니다.</p>
                <div className="layer-list">
                  {allLayers.map((l) => (
                    <label key={l} className="check">
                      <input
                        type="checkbox"
                        checked={layerSet.has(l)}
                        onChange={(e) =>
                          update({ layers: e.target.checked ? [...active.layers, l] : active.layers.filter((x) => x !== l) })
                        }
                      />
                      <LayerSwatch layer={l} />
                      {l} <span className="muted">({active.drawing.contours.filter((c) => c.layer === l).length})</span>
                    </label>
                  ))}
                </div>
              </Section>
            )}

            {(hints.length > 0 || active.drawing.texts.length > 0) && (
              <Section title="도면 텍스트 (규격 참고)">
                {hints.map((h, i) => (
                  <div key={i} className="row hint-row">
                    <span>{h.label}</span>
                    <button
                      className="small"
                      title="이 규격으로 사각 제품 추가"
                      onClick={() =>
                        setProducts((prev) => [
                          ...prev,
                          rectProduct(h.w, h.h, { name: `${fileBase} ${h.w}×${h.h}`, qty: multiplier, materialId: defaultMaterialId }),
                        ])
                      }
                    >
                      + 사각 제품
                    </button>
                  </div>
                ))}
                <details>
                  <summary>전체 텍스트 {active.drawing.texts.length}개</summary>
                  <ul className="text-list">
                    {active.drawing.texts.slice(0, 100).map((t, i) => (
                      <li key={i}>{t.text}</li>
                    ))}
                  </ul>
                </details>
              </Section>
            )}
          </>
        )}
      </aside>

      <main className="work">
        {!active ? (
          <div className="empty">
            <h2>시안 파일을 불러오세요</h2>
            <p>벡터 시안(SVG, DXF, PDF, AI)에서 닫힌 윤곽을 찾아 제품 형상으로 인식합니다.</p>
            <p>도면 없이 규격만 있을 때는 오른쪽 <b>직접 입력</b>으로 사각 제품을 추가하세요.</p>
            <button className="primary" disabled={busy} onClick={loadSamples}>
              샘플 시안 불러오기 (SVG · DXF · PDF)
            </button>
          </div>
        ) : (
          <>
            <DrawingCanvas
              drawing={active.drawing}
              shapes={shapes}
              scale={active.scale}
              excluded={excludedSet}
              visibleLayers={layerSet}
              selected={selected}
              added={added}
              onShapeClick={(i) => toggle(i)}
              onRestoreContour={(i) => update({ excluded: active.excluded.filter((x) => x !== i) })}
            />
            <Section
              className="shape-panel"
              title={<>② 형상 선택 <span className="muted">인식 {shapes.length}개 · 선택 {selected.size}개</span></>}
              right={
                <>
                  <button className="small" onClick={() => setSelected(new Set(shapes.map((s) => s.index)))}>전체 선택</button>
                  <button className="small" onClick={() => setSelected(new Set())} disabled={!selected.size}>선택 해제</button>
                  <button className="small" onClick={selectSame} disabled={!selected.size} title="선택한 것과 같은 형상을 모두 선택">같은 형상</button>
                  <button
                    className="small"
                    disabled={!selected.size}
                    title="도면 테두리·치수선처럼 제품이 아닌 윤곽을 제외합니다"
                    onClick={() => {
                      update({ excluded: [...active.excluded, ...selected] });
                      setSelected(new Set());
                    }}
                  >
                    선택 제외
                  </button>
                  <button className="small" disabled={!active.excluded.length} onClick={() => update({ excluded: [] })}>
                    제외 복원({active.excluded.length})
                  </button>
                </>
              }
            >
              <div className="add-bar">
                <label>세트 수 ×</label>
                <NumInput value={multiplier} min={1} onChange={(v) => setMultiplier(Math.round(v))} width={56} />
                <button className="primary" disabled={!selected.size} onClick={addEach}>
                  선택 형상 → 제품 추가
                </button>
                <button disabled={selected.size < 2} onClick={addAsSet} title="여러 조각을 하나의 제품(세트)으로 묶습니다. 배치는 조각별로 합니다.">
                  하나의 세트로 추가
                </button>
                <span className="note">같은 형상은 1개 제품으로 묶고 개수를 수량으로 합칩니다.</span>
              </div>
              <div className="table-wrap">
                <table className="grid shape-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>#</th>
                      <th>가로×세로 (mm)</th>
                      <th>구멍</th>
                      <th>가공길이 (m)</th>
                      <th>면적 (㎡)</th>
                      <th>동일</th>
                      <th>레이어</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shapes.map((s, i) => (
                      <tr key={s.index} className={selected.has(s.index) ? "sel" : ""} onClick={() => toggle(s.index)}>
                        <td><input type="checkbox" readOnly checked={selected.has(s.index)} /></td>
                        <td>{i + 1}</td>
                        <td>{num(s.w)} × {num(s.h)}</td>
                        <td>{s.holes.length || ""}</td>
                        <td>{num(s.cutLength / 1000, 2)}</td>
                        <td>{num(s.area / 1e6, 3)}</td>
                        <td>{(sigCount.get(s.signature) || 0) > 1 ? `×${sigCount.get(s.signature)}` : ""}</td>
                        <td className="muted">{s.layer}</td>
                        <td>{added.has(s.index) && <span className="badge ok">추가됨</span>}</td>
                      </tr>
                    ))}
                    {shapes.length === 0 && (
                      <tr>
                        <td colSpan={9} className="muted center">
                          닫힌 윤곽이 없습니다. 레이어 필터와 제외 항목을 확인하거나, 규격을 직접 입력하세요.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </main>

      <aside className="product-side">
        <ProductList
          products={products}
          setProducts={setProducts}
          materials={materials}
          defaultMaterialId={defaultMaterialId}
          setDefaultMaterialId={props.setDefaultMaterialId}
          capacity={props.capacity}
        />
      </aside>
    </div>
  );
}

function LayerSwatch({ layer }: { layer: string }) {
  const m = /#[0-9a-f]{6}/i.exec(layer);
  if (!m) return null;
  return <span className="swatch" style={{ background: m[0] }} />;
}
