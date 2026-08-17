// Never point this at the default `.env` — that database is shared with a concurrent pipeline.
// See `docs/.pipeline-state.md` ("Test Database Isolation").
import { defineConfig } from 'vitest/config'
import { config as loadEnv } from 'dotenv'

/**
 * INTEGRATION test config — runs against the isolated `rosty_integrity_test` database ONLY.
 *
 * Why this is a hard constraint, not a preference: the shared Postgres at 127.0.0.1:54322 is
 * used by this worktree AND a concurrently-running Menu & Recipe System worktree. This branch's
 * schema.prisma has no Dish/DishIngredient models, so a `prisma db push` against the shared
 * `postgres` database would DROP that pipeline's tables, and `prisma/seed.ts` opens with
 * deleteMany() calls that would wipe its data.
 *
 * `.env.test` is gitignored (the repo has a blanket `.env*` rule), so it will not survive a
 * fresh clone. Recreate it at the repo root with:
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test"
 *   DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/rosty_integrity_test"
 *
 * The isolated database's schema is already current. Do NOT script `prisma db push` or
 * `prisma db seed` into any test run — if schema drift is ever suspected, that is a manual,
 * explicitly human-approved push against `rosty_integrity_test` only.
 */
const testEnv = loadEnv({ path: '.env.test' }).parsed ?? {}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    // Runs before any test file, and therefore before any PrismaClient is constructed.
    setupFiles: ['tests/integration/guard-database-url.ts'],
    // Sequential: these tests share one isolated database, so parallel files would race on
    // each other's fixtures. One worker, one file at a time.
    // (Vitest 4 removed `test.poolOptions` — these are the top-level replacements.)
    fileParallelism: false,
    maxWorkers: 1,
    env: testEnv,
  },
})
