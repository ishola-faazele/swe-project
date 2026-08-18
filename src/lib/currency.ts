/**
 * Currency formatting — the single source of truth for how money is rendered
 * anywhere in this app (admin tables, order forms, the customer portal).
 *
 * The business operates in Ghana (confirmed directly by the owner), so the
 * default is GHS/en-GH. The seed fixture data (`prisma/seed.ts`: +234 phone
 * codes, Nigerian customer names) is just placeholder test data and was never
 * a reliable signal for the business's actual currency — an earlier version
 * of this module defaulted to NGN based on that fixture data before the owner
 * corrected it. `NEXT_PUBLIC_CURRENCY` can still override the code for local
 * testing; it is `NEXT_PUBLIC_`-prefixed because both Server and Client
 * Components format prices.
 *
 * The currency is resolved and the formatter built ONCE at module load, not per
 * call — `Intl.NumberFormat` construction is the expensive part, and the value
 * cannot change at runtime (Next.js statically inlines `NEXT_PUBLIC_*` at build
 * time, so changing it requires a rebuild/restart).
 */

export const BUSINESS_LOCALE = "en-GH"

const DEFAULT_CURRENCY = "GHS"

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: "en-NG",
  GHS: "en-GH",
  USD: "en-US",
  GBP: "en-GB",
  EUR: "en-IE",
}

/**
 * Unset → silently default (the overwhelmingly common case, not a misconfiguration).
 * Set but unsupported → warn loudly and fall back, since that IS a
 * misconfiguration someone needs to fix, but it must never crash a render.
 *
 * ⚠️ Validation is deliberately an allowlist check, NOT a `try/catch` around a
 * throwaway `Intl.NumberFormat`. That approach is tempting and wrong: `Intl`
 * only validates that a currency code is WELL-FORMED (exactly three ASCII
 * letters), not that it is an ASSIGNED ISO 4217 currency. Verified in this
 * repo's Node: `currency: "NGM"` and `"ZZZ"` construct happily and render as
 * `"NGM 1,200.00"` — so a typo'd code would silently ship to production
 * un-warned. Only malformed input (`"NG"`, `"NGNN"`, `"$$$"`) throws.
 *
 * Every supported code therefore needs a CURRENCY_LOCALES entry, which it needs
 * anyway to be formatted with the right regional conventions.
 */
function resolveCurrencyCode(): string {
  const raw = process.env.NEXT_PUBLIC_CURRENCY?.trim().toUpperCase()
  if (!raw) return DEFAULT_CURRENCY

  if (!Object.hasOwn(CURRENCY_LOCALES, raw)) {
    console.warn(
      `[currency] Invalid NEXT_PUBLIC_CURRENCY="${raw}" — falling back to ${DEFAULT_CURRENCY}. ` +
        `Supported: ${Object.keys(CURRENCY_LOCALES).join(", ")}.`
    )
    return DEFAULT_CURRENCY
  }

  return raw
}

const CURRENCY_CODE = resolveCurrencyCode()
const LOCALE = CURRENCY_LOCALES[CURRENCY_CODE] ?? BUSINESS_LOCALE
const formatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY_CODE,
})

/**
 * Formats an amount as a full localized currency string, e.g. `GH₵1,200.00`.
 * Non-finite input (NaN/Infinity — e.g. a half-typed form field coerced with
 * `Number()`) formats as zero rather than rendering the literal text "NaN".
 */
export function formatCurrency(amount: number): string {
  return formatter.format(Number.isFinite(amount) ? amount : 0)
}

/** The bare symbol only (e.g. `GH₵`), for form labels like "Total Price (GH₵)". */
export function getCurrencySymbol(): string {
  return formatter.formatToParts(0).find((p) => p.type === "currency")?.value ?? CURRENCY_CODE
}

/** The resolved ISO 4217 code actually in use (post-validation/fallback). */
export function getCurrencyCode(): string {
  return CURRENCY_CODE
}
