import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [tanstackStart(), react()],
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    proxy: {
      "/api/auth": "http://127.0.0.1:3080",
      "/.well-known": "http://127.0.0.1:3080",
      "/oauth2": "http://127.0.0.1:3080",
      "/health": "http://127.0.0.1:3080",
      "/docs": "http://127.0.0.1:3080",
    },
  },
});
