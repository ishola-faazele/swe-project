import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored, local-only tooling/CLI artifacts — never app source, and often
    // bundled/minified single-line files that blow up lint output with bogus "line 1"
    // errors at huge column offsets if picked up.
    ".claude/**",
    ".agents/**",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
