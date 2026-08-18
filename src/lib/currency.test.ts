/**
 * Unit tests for src/lib/currency.ts.
 *
 * ⚠️ Module-reset pattern, and why it is mandatory here: `resolveCurrencyCode()`
 * runs ONCE at module load and the `Intl.NumberFormat` is built once at module
 * scope. A single static top-level `import` would therefore lock in whatever
 * `NEXT_PUBLIC_CURRENCY` was set to at first import, and no later mutation of
 * `process.env` could ever exercise the fallback branches. Every case below
 * that needs a different currency must set the env var, call
 * `vi.resetModules()`, and then `await import()` a FRESH copy of the module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Loads a pristine copy of the module with NEXT_PUBLIC_CURRENCY set to `value`
// (or deleted entirely when `value` is undefined).
async function loadCurrencyModule(value?: string) {
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_CURRENCY
  } else {
    process.env.NEXT_PUBLIC_CURRENCY = value
  }
  vi.resetModules()
  return import('./currency')
}

const ORIGINAL = process.env.NEXT_PUBLIC_CURRENCY

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NEXT_PUBLIC_CURRENCY
  } else {
    process.env.NEXT_PUBLIC_CURRENCY = ORIGINAL
  }
  vi.resetModules()
})

describe('currency configuration', () => {
  it('defaults to GHS when NEXT_PUBLIC_CURRENCY is unset, without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { formatCurrency, getCurrencyCode, getCurrencySymbol } = await loadCurrencyModule(undefined)

    expect(getCurrencyCode()).toBe('GHS')
    expect(getCurrencySymbol()).toBe('GH₵')
    expect(formatCurrency(1200)).toBe('GH₵1,200.00')
    // Unset is the normal case, not a misconfiguration — it must stay quiet.
    expect(warn).not.toHaveBeenCalled()
  })

  it('honors a valid override (NGN) with that currency’s own locale conventions', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { formatCurrency, getCurrencyCode, getCurrencySymbol } = await loadCurrencyModule('NGN')

    expect(getCurrencyCode()).toBe('NGN')
    expect(getCurrencySymbol()).toBe('₦')
    expect(formatCurrency(1200)).toBe('₦1,200.00')
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to GHS and warns on a well-formed but UNASSIGNED code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // "NGM" is the important case: it is three ASCII letters, so it is
    // well-formed and `new Intl.NumberFormat({ currency: 'NGM' })` does NOT
    // throw — it renders "NGM 1,200.00". A try/catch-based validator would let
    // this through silently. The allowlist is what actually catches it.
    const { formatCurrency, getCurrencyCode } = await loadCurrencyModule('NGM')

    expect(getCurrencyCode()).toBe('GHS')
    expect(formatCurrency(1200)).toBe('GH₵1,200.00')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('NGM')
  })

  it('falls back to GHS and warns on a malformed code, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Malformed (not three letters) — this is the input that WOULD throw a
    // RangeError if passed straight to Intl. It must be contained.
    const { getCurrencyCode } = await loadCurrencyModule('GHSS')

    expect(getCurrencyCode()).toBe('GHS')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('GHSS')
  })

  it('normalizes case and surrounding whitespace on the env value', async () => {
    const { getCurrencyCode } = await loadCurrencyModule('  usd  ')
    expect(getCurrencyCode()).toBe('USD')
  })
})

describe('formatCurrency', () => {
  it('formats whole and fractional amounts with a thousands separator', async () => {
    const { formatCurrency } = await loadCurrencyModule(undefined)

    expect(formatCurrency(0)).toBe('GH₵0.00')
    expect(formatCurrency(350)).toBe('GH₵350.00')
    expect(formatCurrency(45000)).toBe('GH₵45,000.00')
    expect(formatCurrency(3500.5)).toBe('GH₵3,500.50')
  })

  it('formats non-finite input as zero rather than rendering "NaN" or throwing', async () => {
    const { formatCurrency } = await loadCurrencyModule(undefined)

    // Reachable in real use: `Number(formData.get('totalPrice'))` on an empty
    // or half-typed field yields NaN, and that must never reach the screen.
    expect(formatCurrency(Number.NaN)).toBe('GH₵0.00')
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('GH₵0.00')
    expect(formatCurrency(Number.NEGATIVE_INFINITY)).toBe('GH₵0.00')
  })

  it('formats negative amounts without crashing', async () => {
    const { formatCurrency } = await loadCurrencyModule(undefined)
    expect(formatCurrency(-1200)).toContain('1,200.00')
  })
})

describe('getCurrencySymbol', () => {
  it('returns only the bare symbol, not a formatted amount', async () => {
    const { getCurrencySymbol } = await loadCurrencyModule(undefined)

    const symbol = getCurrencySymbol()
    expect(symbol).toBe('GH₵')
    // Guards the form-label use case: "Total Price (GH₵)", never "Total Price (GH₵0.00)".
    expect(symbol).not.toMatch(/\d/)
  })
})

describe('BUSINESS_LOCALE', () => {
  it('is en-GH, the single place the locale choice is declared', async () => {
    const { BUSINESS_LOCALE } = await loadCurrencyModule(undefined)
    expect(BUSINESS_LOCALE).toBe('en-GH')
  })
})
