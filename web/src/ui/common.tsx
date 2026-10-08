import { useEffect, useState } from "react";
import type { Pt } from "../core/geometry";

/** 입력 중 빈 값/소수점 등을 허용하는 숫자 입력 */
export function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  width = 80,
  suffix,
  title,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
  suffix?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parse = (s: string) => parseFloat(s.replace(/,/g, ""));
  const inRange = (v: number) => (min == null || v >= min) && (max == null || v <= max);
  // 입력 중에는 범위 안의 값만 반영하고, 범위 밖 값은 포커스를 벗어날 때 보정한다
  const commit = (s: string) => {
    const v = parse(s);
    if (isFinite(v) && inRange(v) && v !== value) onChange(v);
  };
  const blur = () => {
    const v = parse(text);
    if (!isFinite(v)) return setText(String(value));
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (c !== value) onChange(c);
    setText(String(c));
  };
  return (
    <span className="num-input">
      <input
        type="text"
        inputMode="decimal"
        style={{ width }}
        value={text}
        title={title}
        disabled={disabled}
        data-step={step}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={blur}
        onFocus={(e) => e.target.select()}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function ptsToPath(pts: Pt[], closed: boolean): string {
  if (pts.length === 0) return "";
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  return closed ? d + "Z" : d;
}

export const PRODUCT_COLORS = [
  "#3b82f6", "#f97316", "#10b981", "#a855f7", "#ef4444",
  "#14b8a6", "#eab308", "#ec4899", "#6366f1", "#84cc16",
];

export function Section({ title, right, children, className }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={"panel " + (className || "")}>
      <header className="panel-head">
        <h3>{title}</h3>
        <div className="panel-actions">{right}</div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
