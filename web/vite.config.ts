import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// vite.config は Node が直接読むため、内部で拡張子付き import を持つ
// @clew/shared 経由では解決できない。単一の実装を共有するため相対パスで参照する
import { resolvePort } from "../packages/shared/src/port";

// server の bind と web の listen で別々の値が必要なので変数を2つに分ける。
// CLEW_SERVER_PORT は proxy 先も決めるので付け忘れると本番インスタンスに繋がる。
// CLEW_WEB_PORT は listen ポートしか変えないため省略しても実害はない
const serverPort = resolvePort("CLEW_SERVER_PORT", process.env.CLEW_SERVER_PORT, 3456);
const webPort = resolvePort("CLEW_WEB_PORT", process.env.CLEW_WEB_PORT, 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    proxy: {
      "/ws": {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
      "/api": {
        target: `http://localhost:${serverPort}`,
      },
      "/uploads": {
        target: `http://localhost:${serverPort}`,
      },
    },
  },
});
