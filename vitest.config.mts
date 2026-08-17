import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import 'dotenv/config'

/**
 * UNIT test config — pure logic + mocked Server Actions, no real database, no Next.js server
 * runtime. Integration tests deliberately live under a SEPARATE config
 * (`vitest.integration.config.mts`) and a separate npm script, so that a plain `npm test` can
 * never open a database connection by accident.
 */

// Shared with every project below: `@/*` mirrors tsconfig's path alias, and `next/cache` is
// aliased to a stub — see test/mocks/next-cache.ts for why.
const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  'next/cache': path.resolve(import.meta.dirname, 'test/mocks/next-cache.ts'),
}

export default defineConfig({
  test: {
    projects: [
      // Node layer: pure logic and Server Action unit tests. No DOM needed, and keeping these
      // off jsdom avoids any chance of a browser-shaped global confusing the Prisma/pg driver.
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['node_modules/**', 'tests/integration/**', '.next/**'],
          env: {
            // Unit tests must never reach a database. `src/lib/prisma.ts` constructs a
            // PrismaClient at import time, so a DATABASE_URL has to exist for the module to
            // load at all — this one points at a closed port so that any *actual* query fails
            // loudly and instantly instead of silently succeeding against a real database.
            DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit-tests-must-not-connect',
            DIRECT_URL: 'postgresql://unit:unit@127.0.0.1:1/unit-tests-must-not-connect',
          },
        },
      },
      // Component layer: React Testing Library over jsdom.
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
})
