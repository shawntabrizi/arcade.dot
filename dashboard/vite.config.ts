import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `@polkadot-apps/chain-client` (pulled in transitively by @dotdm/cdm) uses
// top-level await, which Vite's default esbuild target (es2020) rejects.
// Bumping the optimizeDeps target to es2022 unblocks dev pre-bundling.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  build: { target: "es2022" },
});
