import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const backendTarget = env.GATEWAY_DEV_PROXY_TARGET || "http://localhost:3000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
        "/auth": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/.well-known": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/pki": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/docs": {
          target: backendTarget,
          changeOrigin: true,
        },
        "/health": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
