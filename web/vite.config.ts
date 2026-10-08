import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // samples/ 폴더의 시험용 시안을 앱에서 바로 불러올 수 있게 정적 파일로 함께 배포
  publicDir: "../samples",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
