import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// pnpm --parallel は server と web の両方に同じ env を渡すため、
// server 側の PORT とは別名にしないと vite が同じポートを掴もうとして衝突する
const serverPort = process.env.CLEW_SERVER_PORT || "3456";
const webPort = Number(process.env.CLEW_WEB_PORT) || 5173;

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
