// SVG 불러오기. 브라우저 DOMParser를 사용한다.
import svgpath from "svgpath";
import { Contour, Drawing, DrawingText } from "../drawing";
import { IDENTITY, Matrix, Pt, apply, arcPoints, flattenCubic, flattenQuad, multiply } from "../geometry";

const MM_PER: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
};

const SKIP_TAGS = new Set([
  "defs", "clippath", "mask", "symbol", "marker", "pattern", "lineargradient", "radialgradient",
  "style", "title", "desc", "metadata", "script", "filter", "image", "foreignobject",
]);

interface Style {
  fill: string;
  stroke: string;
  hidden: boolean;
}

export function importSvg(text: string, fileName: string): Drawing {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) {
    throw new Error("SVG 파일을 해석할 수 없습니다.");
  }
  const warnings: string[] = [];
  const isIllustrator = /Adobe Illustrator/i.test(text.slice(0, 2000));

  // ── 단위 해석 ───────────────────────────────
  const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every((v) => isFinite(v)) && vb[2] > 0 && vb[3] > 0;
  const wAttr = parseLength(root.getAttribute("width"));
  const defaultPx = isIllustrator ? MM_PER.pt : MM_PER.px; // 일러스트레이터 SVG는 1px = 1pt(72dpi)
  let k: number; // 사용자 단위 → mm
  let unitNote: string;
  if (wAttr && wAttr.unit !== "px" && wAttr.unit !== "" && hasVb) {
    k = (wAttr.value * MM_PER[wAttr.unit]) / vb[2];
    unitNote = `SVG 크기 ${wAttr.value}${wAttr.unit} / viewBox ${vb[2]} 기준`;
  } else if (wAttr && wAttr.unit !== "px" && wAttr.unit !== "") {
    k = MM_PER[wAttr.unit];
    unitNote = `SVG 단위 ${wAttr.unit}`;
  } else {
    const pxPerUnit = wAttr && hasVb ? wAttr.value / vb[2] : 1;
    k = pxPerUnit * defaultPx;
    unitNote = isIllustrator
      ? "단위 없음 → 일러스트레이터 기준 1px = 1pt(0.3528mm)로 해석"
      : "단위 없음 → 1px = 96dpi(0.2646mm)로 해석. 크기가 다르면 배율을 조정하세요";
  }
  let base: Matrix = [k, 0, 0, k, 0, 0];
  if (hasVb) base = multiply(base, [1, 0, 0, 1, -vb[0], -vb[1]]);

  // ── 클래스 스타일 (<style>) ─────────────────
  const classStyles = new Map<string, Record<string, string>>();
  for (const st of Array.from(doc.getElementsByTagName("style"))) {
    const css = st.textContent || "";
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl = parseDecl(m[2]);
      for (const sel of m[1].split(",")) {
        const s = sel.trim();
        if (s.startsWith(".")) {
          const name = s.slice(1);
          classStyles.set(name, { ...(classStyles.get(name) || {}), ...decl });
        }
      }
    }
  }

  const byId = new Map<string, Element>();
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    const id = el.getAttribute("id");
    if (id) byId.set(id, el);
  }

  const contours: Contour[] = [];
  const texts: DrawingText[] = [];

  const styleOf = (el: Element, parent: Style): Style => {
    const props: Record<string, string> = {};
    for (const cls of (el.getAttribute("class") || "").split(/\s+/)) {
      const cs = classStyles.get(cls);
      if (cs) Object.assign(props, cs);
    }
    for (const name of ["fill", "stroke", "display", "visibility"]) {
      const v = el.getAttribute(name);
      if (v != null) props[name] = v;
    }
    Object.assign(props, parseDecl(el.getAttribute("style") || ""));
    return {
      fill: props.fill != null ? normColor(props.fill) : parent.fill,
      stroke: props.stroke != null ? normColor(props.stroke) : parent.stroke,
      hidden: parent.hidden || props.display === "none" || props.visibility === "hidden",
    };
  };

  const layerOf = (s: Style) =>
    s.stroke !== "none" ? `선 ${s.stroke}` : s.fill !== "none" ? `면 ${s.fill}` : "기타";

  const emit = (subpaths: { pts: Pt[]; closed: boolean }[], s: Style) => {
    const layer = layerOf(s);
    for (const sp of subpaths) if (sp.pts.length >= 2) contours.push({ pts: sp.pts, closed: sp.closed, layer });
  };

  const walk = (el: Element, m: Matrix, parent: Style, depth: number) => {
    if (depth > 50) return;
    const tag = el.nodeName.toLowerCase().replace(/^svg:/, "");
    if (SKIP_TAGS.has(tag)) return;
    const s = styleOf(el, parent);
    if (s.hidden) return;
    const t = el.getAttribute("transform");
    let mm = t ? multiply(m, parseTransform(t)) : m;
    const num = (n: string, d = 0) => {
      const v = parseFloat(el.getAttribute(n) || "");
      return isFinite(v) ? v : d;
    };

    switch (tag) {
      case "svg":
      case "g":
      case "a":
      case "switch":
        if (tag === "svg" && el !== root) mm = multiply(mm, [1, 0, 0, 1, num("x"), num("y")]);
        for (const ch of Array.from(el.children)) walk(ch, mm, s, depth + 1);
        return;
      case "use": {
        const href = el.getAttribute("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
        const ref = byId.get(href.replace(/^#/, ""));
        if (!ref) return;
        const um = multiply(mm, [1, 0, 0, 1, num("x"), num("y")]);
        if (ref.nodeName.toLowerCase() === "symbol") {
          for (const ch of Array.from(ref.children)) walk(ch, um, s, depth + 1);
        } else {
          walk(ref, um, s, depth + 1);
        }
        return;
      }
      case "path":
        emit(pathToPolylines(el.getAttribute("d") || "", mm), s);
        return;
      case "rect": {
        const x = num("x"), y = num("y"), w = num("width"), h = num("height");
        if (w <= 0 || h <= 0) return;
        let rx = num("rx", NaN), ry = num("ry", NaN);
        if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry;
        if (isNaN(ry)) ry = rx;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        const d =
          rx > 0 || ry > 0
            ? `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
            : `M${x},${y}H${x + w}V${y + h}H${x}Z`;
        emit(pathToPolylines(d, mm), s);
        return;
      }
      case "circle":
      case "ellipse": {
        const cx = num("cx"), cy = num("cy");
        const rx = tag === "circle" ? num("r") : num("rx");
        const ry = tag === "circle" ? num("r") : num("ry");
        if (rx <= 0 || ry <= 0) return;
        const unit = arcPoints(0, 0, Math.max(rx, ry), 0, Math.PI * 2).slice(0, -1);
        const pts = unit.map((p) => {
          const k2 = Math.max(rx, ry);
          return apply(mm, cx + (p.x / k2) * rx, cy + (p.y / k2) * ry);
        });
        emit([{ pts, closed: true }], s);
        return;
      }
      case "line":
        emit([{ pts: [apply(mm, num("x1"), num("y1")), apply(mm, num("x2"), num("y2"))], closed: false }], s);
        return;
      case "polyline":
      case "polygon": {
        const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number).filter((v) => isFinite(v));
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push(apply(mm, nums[i], nums[i + 1]));
        emit([{ pts, closed: tag === "polygon" }], s);
        return;
      }
      case "text": {
        const str = (el.textContent || "").trim();
        if (str) {
          const p = apply(mm, num("x"), num("y"));
          texts.push({ text: str, x: p.x, y: p.y });
        }
        return;
      }
      default:
        // 알 수 없는 태그 안에도 도형이 있을 수 있다
        for (const ch of Array.from(el.children)) walk(ch, mm, s, depth + 1);
    }
  };

  walk(root, base, { fill: "#000000", stroke: "none", hidden: false }, 0);
  if (contours.length === 0) warnings.push("SVG에서 도형을 찾지 못했습니다. 글자는 윤곽선 만들기(Create Outlines) 후 저장해주세요.");

  return { id: "", fileName, format: "svg", contours, texts, unitNote, warnings };
}

/** SVG path d → 평탄화한 폴리라인 목록 (변환 행렬 적용 후) */
export function pathToPolylines(d: string, m: Matrix = IDENTITY): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  if (!d.trim()) return out;
  let cur: Pt[] | null = null;
  let start: Pt = { x: 0, y: 0 };
  let last: Pt = { x: 0, y: 0 };
  const flush = (closed: boolean) => {
    if (cur && cur.length >= 2) out.push({ pts: cur, closed });
    cur = null;
  };
  svgpath(d)
    .abs()
    .unshort()
    .unarc()
    .matrix(m as unknown as number[])
    .iterate((seg) => {
      const cmd = seg[0];
      switch (cmd) {
        case "M":
          flush(false);
          last = start = { x: seg[1], y: seg[2] };
          cur = [last];
          break;
        case "L":
        case "H":
        case "V": {
          const p =
            cmd === "L" ? { x: seg[1], y: seg[2] } : cmd === "H" ? { x: seg[1], y: last.y } : { x: last.x, y: seg[1] };
          (cur ??= [last]).push(p);
          last = p;
          break;
        }
        case "C": {
          const p3 = { x: seg[5], y: seg[6] };
          flattenCubic(last, { x: seg[1], y: seg[2] }, { x: seg[3], y: seg[4] }, p3, (cur ??= [last]));
          last = p3;
          break;
        }
        case "Q": {
          const p2 = { x: seg[3], y: seg[4] };
          flattenQuad(last, { x: seg[1], y: seg[2] }, p2, (cur ??= [last]));
          last = p2;
          break;
        }
        case "Z":
        case "z":
          flush(true);
          last = start;
          break;
      }
    });
  flush(false);
  return out;
}

function parseLength(v: string | null): { value: number; unit: string } | null {
  if (!v) return null;
  const m = /^\s*([0-9.eE+-]+)\s*([a-z%]*)\s*$/.exec(v);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (!isFinite(value) || value <= 0 || (unit !== "" && !(unit in MM_PER))) return null;
  return { value, unit };
}

function parseDecl(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function normColor(c: string): string {
  const v = c.trim().toLowerCase();
  if (v === "" || v === "none" || v === "transparent") return "none";
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v.slice(1).split("").map((ch) => ch + ch).join("");
  const rgb = /^rgb\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec(v);
  if (rgb) return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("");
  return v;
}

export function parseTransform(t: string): Matrix {
  let m: Matrix = IDENTITY;
  for (const [, fn, argStr] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = argStr.trim().split(/[\s,]+/).map(Number);
    let n: Matrix = IDENTITY;
    switch (fn) {
      case "matrix":
        if (a.length === 6) n = a as Matrix;
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
        break;
      case "scale":
        n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
        break;
      case "rotate": {
        const r = ((a[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(r), sin = Math.sin(r);
        n = [cos, sin, -sin, cos, 0, 0];
        if (a.length === 3) n = multiply(multiply([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case "skewX":
        n = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        n = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, n);
  }
  return m;
}
