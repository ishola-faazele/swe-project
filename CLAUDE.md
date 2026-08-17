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

### No test suite exists

There's no `test` script in `package.json` and no test framework installed (no Jest, Vitest,
Playwright, etc.). Don't assume one exists or invent an `npm test` invocation — if a task calls
for tests, check with the user before picking and installing a framework.

### Keeping the docs in sync

If you learn something new about this codebase while working (a gotcha, a gap, an architectural
decision) that would help the next agent, add it to `AGENTS.md` rather than here — it's the
shared, tool-agnostic doc that Copilot/Gemini/Cursor sessions read too. Reserve edits to this
file for things that are genuinely Claude-Code-only.
