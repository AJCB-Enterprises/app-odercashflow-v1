import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// All frontend API calls go to /api/*; in dev, Vite strips the prefix and
// forwards to the backend on :4000. In production, mirror this at your
// reverse proxy (nginx: location /api/ { proxy_pass http://backend/; }).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
