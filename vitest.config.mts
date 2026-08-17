import { defineConfig } from 'vitest/config'

/**
 * UNIT test config — pure logic only. No real database, no Next.js server runtime.
 *
 * Integration tests deliberately live under a SEPARATE config
 * (`vitest.integration.config.ts`) and a separate npm script, so that a plain `npm test`
 * can never open a database connection by accident. Keep `include` scoped to `src/`.
 */
export default defineConfig({
  // Resolves the `@/*` -> `src/*` alias from tsconfig.json natively (Vite 7+), so test files
  // import exactly like app code does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/integration/**', '.next/**'],
    env: {
      // Unit tests must never reach a database. `src/lib/prisma.ts` constructs a PrismaClient
      // at import time, so a DATABASE_URL has to exist for the module to load at all — this
      // one points at a closed port so that any *actual* query fails loudly and instantly
      // instead of silently succeeding against a real database.
      DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit-tests-must-not-connect',
      DIRECT_URL: 'postgresql://unit:unit@127.0.0.1:1/unit-tests-must-not-connect',
    },
  },
})
