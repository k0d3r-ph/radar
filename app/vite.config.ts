import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Identifica a build atual: usa o commit da Vercel quando existe,
// senão cai para o timestamp do build (ambiente local).
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? String(Date.now());

// Gera o dist/version.json que o app consulta para saber se subiu versão nova.
function versionFilePlugin() {
  return {
    name: "gera-version-json",
    generateBundle(this: { emitFile: (f: unknown) => void }) {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId }),
      });
    },
  };
}

// https://vite.dev/config/
// Force config reload to load new env variables
export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    outDir: "dist",
  },
});
