/**
 * PROACTIVE-002 — fail-loud second line of defense for test database isolation.
 *
 * `vitest.integration.config.ts` pointing at `.env.test` is a config-level safeguard, but a
 * future config edit (or a CI change) could silently fall back to the real `.env`, aiming these
 * tests at the SHARED `postgres` database — where the fixture cleanup these tests perform would
 * destroy a concurrently-running pipeline's data.
 *
 * This runs as a Vitest setupFile, before any test file imports and therefore before any
 * PrismaClient is constructed. It refuses to let the suite start against the wrong database.
 *
 * See `docs/.pipeline-state.md` ("Test Database Isolation").
 */
const REQUIRED_DATABASE = 'rosty_integrity_test'

function assertIsolatedDatabase(varName: 'DATABASE_URL' | 'DIRECT_URL'): void {
  const raw = process.env[varName]

  if (!raw) {
    throw new Error(
      `[integration-guard] ${varName} is not set. Integration tests must run against the ` +
        `isolated "${REQUIRED_DATABASE}" database. Create a .env.test at the repo root — see ` +
        `the header comment in vitest.integration.config.ts.`
    )
  }

  let databaseName: string
  try {
    // pathname is "/<database>"; strip the leading slash.
    databaseName = new URL(raw).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`[integration-guard] ${varName} is not a valid connection URL.`)
  }

  if (databaseName !== REQUIRED_DATABASE) {
    throw new Error(
      `[integration-guard] REFUSING TO RUN. ${varName} points at database "${databaseName}", ` +
        `but integration tests may only run against "${REQUIRED_DATABASE}".\n` +
        `The default "postgres" database is SHARED with a concurrently-running pipeline ` +
        `(Menu & Recipe System worktree); these tests delete their own fixtures and would ` +
        `destroy its data. See docs/.pipeline-state.md ("Test Database Isolation").`
    )
  }
}

assertIsolatedDatabase('DATABASE_URL')
assertIsolatedDatabase('DIRECT_URL')
