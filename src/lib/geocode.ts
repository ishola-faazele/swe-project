"use server"

import { Role } from '@prisma/client'
import { requireRole } from '@/lib/auth'
import { okResult, toErrorResult, type ActionResult } from '@/lib/errors'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
// Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim) requires a real,
// identifying User-Agent and caps unauthenticated use at ~1 request/second. A browser cannot set
// a custom User-Agent at all, which is exactly why this call is server-side rather than fired
// directly from MapComponent.tsx as it originally was.
const USER_AGENT = 'ChopWithRostty/1.0 (+business@accelerateservices.xyz)'
const MIN_REQUEST_INTERVAL_MS = 1100
const MAX_ADDRESS_LENGTH = 300

let lastRequestAt = 0
let queue: Promise<void> = Promise.resolve()

/**
 * Serializes outbound Nominatim calls so concurrent geocode/search requests never exceed ~1/sec
 * — shared by geocodeAddress and searchAddresses below, so autocomplete suggestions and the map
 * preview's own lookup both draw from the same budget rather than each enforcing it separately.
 */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const scheduled = queue.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
  })
  queue = scheduled
  return scheduled.then(fn)
}

/** Appends a Ghana hint for local geocoding accuracy, unless the caller already included one. */
function withGhanaHint(address: string): string {
  return address.toLowerCase().includes('ghana') ? address : `${address}, Ghana`
}

/**
 * Looks up an address and returns its coordinates for the delivery-address map preview
 * (order create/edit modals, driver view). Gated to staff/driver roles — this is a server-side
 * proxy to a free third-party API, not something to leave open to arbitrary callers.
 */
export async function geocodeAddress(
  address: string
): Promise<ActionResult<{ lat: number; lon: number }>> {
  await requireRole([Role.ADMIN, Role.KITCHEN_STAFF, Role.DELIVERY_DRIVER])

  const trimmed = address.trim()
  if (!trimmed) {
    return { ok: false, error: 'No address provided.', code: 'VALIDATION' }
  }
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    return { ok: false, error: 'Address is too long to look up.', code: 'VALIDATION' }
  }

  const searchQuery = withGhanaHint(trimmed)

  try {
    const res = await throttled(() =>
      fetch(`${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      })
    )
    if (!res.ok) {
      return { ok: false, error: 'Could not look up that address.', code: 'UNKNOWN' }
    }
    const data = await res.json()
    const lat = Array.isArray(data) && data[0] ? parseFloat(data[0].lat) : NaN
    const lon = Array.isArray(data) && data[0] ? parseFloat(data[0].lon) : NaN
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return { ok: false, error: 'Location not found.', code: 'NOT_FOUND' }
    }
    return okResult({ lat, lon })
  } catch (err) {
    return toErrorResult(err, 'Could not look up that address.')
  }
}

/**
 * Returns up to 5 candidate addresses for a partial, in-progress query — the autocomplete
 * dropdown under the delivery-address field. Same rate-limit queue and role gate as
 * geocodeAddress; the caller (DeliveryAddressField) is expected to debounce keystrokes before
 * calling this, same reasoning as MapComponent debouncing its own geocode call.
 */
export async function searchAddresses(
  query: string
): Promise<ActionResult<{ label: string; lat: number; lon: number }[]>> {
  await requireRole([Role.ADMIN, Role.KITCHEN_STAFF, Role.DELIVERY_DRIVER])

  const trimmed = query.trim()
  // Too short to search meaningfully — avoid firing on the first keystroke or two.
  if (trimmed.length < 3) {
    return okResult([])
  }
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    return { ok: false, error: 'Address is too long to look up.', code: 'VALIDATION' }
  }

  try {
    const res = await throttled(() =>
      fetch(`${NOMINATIM_URL}?format=json&limit=5&q=${encodeURIComponent(withGhanaHint(trimmed))}`, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      })
    )
    if (!res.ok) {
      return { ok: false, error: 'Could not search for that address.', code: 'UNKNOWN' }
    }
    const data = await res.json()
    if (!Array.isArray(data)) {
      return okResult([])
    }
    const results = (data as { display_name?: string; lat?: string; lon?: string }[])
      .map((item) => ({
        label: item.display_name ?? '',
        lat: parseFloat(item.lat ?? ''),
        lon: parseFloat(item.lon ?? ''),
      }))
      .filter((r) => r.label && !Number.isNaN(r.lat) && !Number.isNaN(r.lon))
    return okResult(results)
  } catch (err) {
    return toErrorResult(err, 'Could not search for that address.')
  }
}
