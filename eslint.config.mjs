import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
});
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Build and Playwright output, generated types, and the Python service
    // (its virtualenv ships vendored JavaScript that is not ours to lint).
    ignores: [".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "ai-brain/**", "test-results/**", "playwright-report/**", "blob-report/**"],
  },
];
export default eslintConfig;