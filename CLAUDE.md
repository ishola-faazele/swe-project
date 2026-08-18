# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Notes specific to Claude Code

`AGENTS.md` (imported above) is the canonical, actively-maintained orientation doc for this
repo — written by the agent that built the app, and read by every coding agent that touches this
codebase (Copilot, Gemini, Cursor, Claude). It already covers the product, tech stack, the
Next.js 16 breaking changes, repo layout, data model, established patterns, and known gaps
(unenforced role gating, cancellation not reverting stock, SMS stub, etc.). Read it in full — the
`@AGENTS.md` line above inlines it into context automatically, so don't skip past it.

This file exists only to add what AGENTS.md doesn't cover, and to avoid the two docs drifting out
of sync by restating the same architecture notes in slightly different words.

### Full command reference

AGENTS.md's "Local Dev Quick Start" covers the day-to-day loop (`supabase:start` → `db push` →
`db seed` → `dev`). The rest of `package.json`'s scripts, plus a couple of useful Prisma/Supabase
commands it doesn't mention:

```bash
npm run build              # production build
npm run start               # run the production build
npm run lint                 # ESLint — eslint-config-next core-web-vitals + typescript, flat config
npm run supabase:stop      # stop local Supabase Docker containers
npx prisma studio            # inspect the local DB visually
```

### The test suite

Vitest is installed and wired up across two separate configs. Both suites are expected to be
green before any merge:

```bash
npm test                 # unit — vitest.config.mts, `node` + `jsdom` projects
npm run test:watch       # unit, watch mode
npm run test:integration # integration — vitest.integration.config.mts, real Postgres
```

- **Unit** (`vitest.config.mts`) — two projects. `node` covers pure logic and Server Action unit
  tests (`src/**/*.test.ts`); `jsdom` covers React Testing Library component tests
  (`src/**/*.test.tsx`). `next/cache` is aliased to a stub, and `DATABASE_URL` points at a closed
  port so a stray query fails loudly instead of silently hitting a real database.
- **Integration** (`vitest.integration.config.mts`) — `tests/integration/**`, running against an
  isolated `rosty_integrity_test` database configured via `.env.test` (gitignored — it will not
  survive a fresh worktree checkout and must be recreated). `tests/integration/guard-database-url.ts`
  hard-fails the run if it is pointed anywhere else. **Never** point it at the shared `postgres`
  database, and never run `prisma db seed` as part of a test loop — `prisma/seed.ts` opens with
  destructive `deleteMany()` calls.

Add new unit tests alongside the module they cover (`src/lib/foo.ts` → `src/lib/foo.test.ts`);
they are auto-discovered by the include globs, so no config change is needed.

### Keeping the docs in sync

If you learn something new about this codebase while working (a gotcha, a gap, an architectural
decision) that would help the next agent, add it to `AGENTS.md` rather than here — it's the
shared, tool-agnostic doc that Copilot/Gemini/Cursor sessions read too. Reserve edits to this
file for things that are genuinely Claude-Code-only.
