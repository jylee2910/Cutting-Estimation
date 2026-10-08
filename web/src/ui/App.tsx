import { useMemo, useRef, useState } from "react";
import { Drawing, defaultExcluded, layersOf } from "../core/drawing";
import {
  DEFAULT_MATERIALS,
  DEFAULT_NEST,
  DEFAULT_PRICE,
  Material,
  NestSettings,
  PriceSettings,
  Product,
  QuoteInfo,
} from "../core/model";
import { capacityPerSheet, nestProducts } from "../core/nest";
import { buildQuote } from "../core/pricing";
import { ConfirmButton, isEmbedded } from "./common";
import { today, won } from "./format";
import { DrawingState, ImportTab } from "./ImportTab";
import { NestingTab } from "./NestingTab";
import { QuoteTab } from "./QuoteTab";
import { SettingsTab } from "./SettingsTab";
import { downloadFile, usePersistentList, usePersistentState } from "./storage";

type Tab = "import" | "nest" | "quote" | "settings";

const newQuoteInfo = (): QuoteInfo => ({
  number: `Q${today().replace(/-/g, "")}-${String(Math.floor(Math.random() * 900) + 100)}`,
  date: today(),
  customer: "",
  title: "",
  memo: "",
});

export default function App() {
  const [tab, setTab] = useState<Tab>("import");
  const [drawings, setDrawings] = useState<DrawingState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [products, setProducts] = usePersistentList<Product>("ce.products", []);
  const [materials, setMaterials] = usePersistentList<Material>("ce.materials", DEFAULT_MATERIALS);
  const [nestSettings, setNestSettings] = usePersistentState<NestSettings>("ce.nest", DEFAULT_NEST);
  const [priceSettings, setPriceSettings] = usePersistentState<PriceSettings>("ce.price", DEFAULT_PRICE);
  const [quoteInfo, setQuoteInfo] = usePersistentState<QuoteInfo>("ce.quoteInfo", newQuoteInfo());
  const [defMat, setDefMat] = usePersistentState<{ id: string }>("ce.defaultMaterial", { id: DEFAULT_MATERIALS[0].id });
  const defaultMaterialId = materials.some((m) => m.id === defMat.id) ? defMat.id : materials[0]?.id || "";
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");

  const nests = useMemo(() => nestProducts(products, materials, nestSettings), [products, materials, nestSettings]);
  const quote = useMemo(() => buildQuote(products, nests, materials, priceSettings), [products, nests, materials, priceSettings]);
  const capacity = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of products) {
      const mat = materials.find((x) => x.id === p.materialId);
      m.set(p.id, mat ? capacityPerSheet(p, mat, nestSettings) : null);
    }
    return m;
  }, [products, materials, nestSettings]);

  const onImported = (ds: Drawing[]) => {
    setDrawings((prev) => [
      ...prev,
      ...ds.map((d) => ({ drawing: d, excluded: [...defaultExcluded(d)], layers: layersOf(d), scale: 1 })),
    ]);
    setActiveId(ds[0].id);
  };

  const saveProject = () => {
    const data = { app: "cutting-estimation", version: 1, quoteInfo, products, materials, nestSettings, priceSettings };
    downloadFile(`작업_${quoteInfo.number || today()}.json`, JSON.stringify(data), "application/json");
  };
  const loadProject = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== "cutting-estimation" || !Array.isArray(data.products)) throw new Error("작업 파일 형식이 아닙니다.");
      setProducts(data.products);
      if (data.quoteInfo) setQuoteInfo(data.quoteInfo);
      // 작업 파일에만 있는 판재는 목록에 추가 (기존 판재 설정은 유지)
      if (Array.isArray(data.materials)) {
        setMaterials((prev) => [...prev, ...data.materials.filter((m: Material) => !prev.some((x) => x.id === m.id))]);
      }
      setTab("nest");
    } catch (e) {
      setNotice("작업 파일을 열 수 없습니다: " + (e as Error).message);
    }
  };
  const newQuote = () => {
    setProducts([]);
    setDrawings([]);
    setActiveId(null);
    setQuoteInfo(newQuoteInfo());
    setTab("import");
  };

  const sheetCount = nests.reduce((s, n) => s + n.sheets.length, 0);
  const tabs: [Tab, string][] = [
    ["import", "① 시안 · 제품 선정"],
    ["nest", "② 판재 배치"],
    ["quote", "③ 견적서"],
    ["settings", "판재 · 단가 설정"],
  ];

  return (
    <div className="app">
      <header className="topbar no-print">
        <h1>재단견적</h1>
        <nav className="tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="summary">
          <span>제품 <b>{products.length}</b>종</span>
          <span>부품 <b>{quote.totals.pieces}</b>개</span>
          <span>판재 <b>{sheetCount}</b>장</span>
          <span className="sum-total">합계 <b>₩{won(quote.total)}</b></span>
        </div>
        <div className="file-actions">
          {products.length ? (
            <ConfirmButton className="" onConfirm={newQuote} confirmText="비우고 새로 시작?" title="현재 제품 목록과 견적 정보를 비웁니다">
              새 견적
            </ConfirmButton>
          ) : (
            <button onClick={newQuote}>새 견적</button>
          )}
          {!isEmbedded && (
            <button onClick={saveProject} disabled={!products.length}>작업 저장</button>
          )}
          <button onClick={() => fileRef.current?.click()}>작업 열기</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadProject(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {notice && (
        <p className="msg error notice no-print">
          {notice} <button className="icon" onClick={() => setNotice("")}>×</button>
        </p>
      )}
      <div className="content">
        {tab === "import" && (
          <ImportTab
            drawings={drawings}
            setDrawings={setDrawings}
            onImported={onImported}
            activeId={activeId}
            setActiveId={setActiveId}
            products={products}
            setProducts={setProducts}
            materials={materials}
            defaultMaterialId={defaultMaterialId}
            setDefaultMaterialId={(id) => setDefMat({ id })}
            capacity={capacity}
          />
        )}
        {tab === "nest" && (
          <NestingTab
            products={products}
            materials={materials}
            nests={nests}
            nestSettings={nestSettings}
            setNestSettings={setNestSettings}
            capacity={capacity}
          />
        )}
        {tab === "quote" && (
          <QuoteTab
            quote={quote}
            info={quoteInfo}
            setInfo={setQuoteInfo}
            products={products}
            materials={materials}
            nests={nests}
            priceSettings={priceSettings}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            materials={materials}
            setMaterials={setMaterials}
            priceSettings={priceSettings}
            setPriceSettings={setPriceSettings}
            products={products}
          />
        )}
      </div>
    </div>
  );
}
