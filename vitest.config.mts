import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// .mts rather than .ts: the package is CommonJS, and Vitest 4's dependencies are
// ESM-only, so a .ts config gets require()d and fails with ERR_REQUIRE_ESM.
export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json, so tests import modules the
  // same way the app does.
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "ai-brain/**"],
  },
});
