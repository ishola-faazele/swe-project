/**
 * Stub for `next/cache`, aliased in vitest.config.ts.
 *
 * Server Actions in this repo call `revalidatePath`/`revalidateTag` after every DB write. The
 * real implementations reach into Next's request-scoped "static generation store," which only
 * exists inside an actual Next.js request/render — calling them from a plain Vitest process
 * throws `Invariant: static generation store missing`. Every action's DB work happens BEFORE the
 * revalidate call, so no-oping it here still exercises the real transaction/query logic; only the
 * (untestable-outside-Next, and irrelevant-to-correctness) cache invalidation is skipped.
 */
export function revalidatePath(_path?: string, _type?: string) {}
export function revalidateTag(_tag?: string) {}
export function unstable_cache<T>(fn: T) {
  return fn
}
