import { useEffect, useState } from "react";

/** localStorage에 저장되는 상태 (판재 목록·단가 설정 등 이 브라우저에 남길 값) */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...(initial as object), ...JSON.parse(raw) } as T;
    } catch {
      // 저장소 접근 불가 시 기본값 사용
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 무시
    }
  }, [key, value]);
  return [value, setValue];
}

export function usePersistentList<T>(key: string, initial: T[]): [T[], (v: T[] | ((prev: T[]) => T[])) => void] {
  const [value, setValue] = useState<T[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as T[];
      }
    } catch {
      // 무시
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 무시
    }
  }, [key, value]);
  return [value, setValue];
}

export function downloadFile(name: string, content: string | Blob, type = "application/octet-stream") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
