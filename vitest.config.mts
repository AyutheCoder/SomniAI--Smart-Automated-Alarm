import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// .mts rather than .ts: the package is CommonJS, and Vitest 4's dependencies are
// ESM-only, so a .ts config gets require()d and fails with ERR_REQUIRE_ESM.
export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json, so tests import modules the
  // same way the app does.
  plugins: [tsconfigPaths()],
  // Component tests render JSX; tsconfig keeps JSX as-is for Next to compile.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    exclude: ["node_modules/**", ".next/**", "ai-brain/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts", "**/*.test.tsx"],
          exclude: ["node_modules/**", ".next/**", "ai-brain/**", "tests/api/**"],
        },
      },
      {
        // Route handlers against a throwaway in-memory MongoDB, never Atlas.
        extends: true,
        test: {
          name: "api",
          include: ["tests/api/**/*.test.ts"],
          globalSetup: ["tests/api/globalSetup.ts"],
          setupFiles: ["tests/api/setup.ts"],
          // The first run downloads a MongoDB binary; give hooks room for it.
          hookTimeout: 120_000,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
