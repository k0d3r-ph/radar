import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// Force config reload to load new env variables
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
