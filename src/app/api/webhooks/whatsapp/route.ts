/**
 * WhatsApp Cloud API webhook — the endpoint Meta requires to operate the Cloud API at all.
 *
 * GET  completes Meta's one-time ownership-verification handshake.
 * POST receives delivery events, each authenticated by an HMAC-SHA256 signature.
 *
 * ⚠ UNAUTHENTICATED BY DESIGN. Meta calls this endpoint, not a logged-in admin, so
 * requireAdmin()/getCurrentDbUser() from src/lib/auth.ts do NOT apply here and must not be added.
 * The signature check IS the security boundary for POST; the verify-token match is the boundary
 * for GET. Both fail closed when their secret is missing, so a misconfigured deploy is loudly
 * broken (Meta's dashboard shows failed deliveries) rather than quietly insecure.
 *
 * ⚠ Do NOT add `export const runtime = 'edge'` — crypto.createHmac/timingSafeEqual need the
 * Node.js runtime. Route Handlers already default to it; the danger is someone pasting an `edge`
 * export in from elsewhere and silently breaking this route until a real webhook call fails.
 */
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'

const SIGNATURE_HEADER = 'x-hub-signature-256'
const SIGNATURE_PREFIX = 'sha256='

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (!verifyToken) {
    // Fail closed: an unset verify token means we cannot distinguish a legitimate Meta handshake
    // from any other GET request. Reject rather than silently "auto-verifying."
    console.error('[WhatsApp Webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured — rejecting verification handshake')
    return new NextResponse('Webhook verify token not configured', { status: 403 })
  }

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    // Must be the RAW challenge value as plain text, not JSON-wrapped — Meta's verification
    // fails otherwise.
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse('Verification failed', { status: 403 })
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    // Fail closed: nothing can be verified without the secret, so the body is never even read.
    console.error('[WhatsApp Webhook] WHATSAPP_APP_SECRET not configured — rejecting POST')
    return new NextResponse('Not configured', { status: 503 })
  }

  const signatureHeader = request.headers.get(SIGNATURE_HEADER)
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    console.error('[WhatsApp Webhook] Missing or malformed signature header')
    return new NextResponse('Missing signature', { status: 401 })
  }

  // MUST read as raw text FIRST. request.json() consumes the body stream; calling it before
  // computing the HMAC would make it impossible to verify the signature against the exact bytes
  // Meta signed. JSON.parse only happens after verification succeeds, below.
  const rawBody = await request.text()

  const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const providedSignature = signatureHeader.slice(SIGNATURE_PREFIX.length)

  const expectedBuffer = Buffer.from(expectedSignature, 'hex')
  const providedBuffer = Buffer.from(providedSignature, 'hex')

  // crypto.timingSafeEqual THROWS a RangeError on length-mismatched buffers, so the lengths must
  // be compared first — otherwise a truncated or non-hex header (Buffer.from stops at the first
  // invalid character, yielding a short buffer) would crash the route with a raw 500 instead of
  // rejecting cleanly. && short-circuits, so timingSafeEqual is never reached on a mismatch.
  const isValid = expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer)

  if (!isValid) {
    console.error('[WhatsApp Webhook] Signature verification failed')
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[WhatsApp Webhook] Verified request had unparseable JSON body')
    return new NextResponse('Invalid payload', { status: 400 })
  }

  // Log the raw payload rather than guessing at a specific delivery-event structure, matching
  // this codebase's existing "log, don't build a UI for it yet" pattern. No persistence — that
  // is an explicit PRD non-goal.
  console.log('[WhatsApp Webhook] Received event:', JSON.stringify(payload))

  return NextResponse.json({ received: true }, { status: 200 })
}
