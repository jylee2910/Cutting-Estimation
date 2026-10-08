export const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
export const num = (v: number, digits = 1) =>
  (Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)).toLocaleString("ko-KR", { maximumFractionDigits: digits });
export const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
