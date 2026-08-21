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
    // Serwist-generated service worker (src/app/sw.ts -> public/sw.js) — gitignored, rebuilt on
    // every `next build`, a minified single-line file that blows up lint output with bogus
    // "line 1" errors at huge column offsets when picked up. Same bug class as 6cab9f5.
    "public/sw.js",
  ]),
]);

export default eslintConfig;
