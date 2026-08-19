"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { OTPField } from "@base-ui/react/otp-field"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { requestPhoneOtp, verifyPhoneOtp } from "./actions"

const OTP_LENGTH = 6

/**
 * Two-step phone login: enter a number, then enter the 6-digit code that arrives by SMS.
 *
 * Both steps live on this one component with no navigation between them — the customer never
 * loses their place, and the phone number stays in state for a resend.
 */
export function PhoneLoginForm() {
  const router = useRouter()
  const [step, setStep] = useState<"phone" | "code">("phone")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function handleRequestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setIsPending(true)
    try {
      const result = await requestPhoneOtp(phone)
      if (!result.ok) {
        // Covers the cooldown rejection too. Deliberately just the server's own message — a live
        // countdown was rejected for v1, both to avoid advertising exact rate-limit timing and to
        // avoid carrying timer state through this component.
        setError(result.error)
        return
      }
      setStep("code")
      setNotice(`We sent a 6-digit code to ${phone}.`)
    } catch {
      setError("Could not send the login code. Please try again.")
    } finally {
      setIsPending(false)
    }
  }

  /**
   * Fires from OTPField's onValueComplete — the moment the 6th digit lands, with no separate
   * "Verify" tap. A deliberate call for a non-technical, one-handed mobile user.
   */
  async function handleVerify(value: string) {
    setError(null)
    setIsPending(true)
    try {
      const result = await verifyPhoneOtp(phone, value)
      if (!result.ok) {
        // Stay on the code step so a mistyped digit is a one-tap fix, not a restart. The message is
        // whatever the server said — always generic, never a remaining-attempts count.
        setError(result.error)
        setCode("")
        return
      }
      router.push(result.data.redirectTo)
    } catch {
      setError("Could not sign you in. Please try again.")
      setCode("")
    } finally {
      setIsPending(false)
    }
  }

  async function handleResend() {
    setError(null)
    setNotice(null)
    setIsPending(true)
    try {
      const result = await requestPhoneOtp(phone)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCode("")
      setNotice(`We sent a new code to ${phone}.`)
    } catch {
      setError("Could not send the login code. Please try again.")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="space-y-4">
      {step === "phone" ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone" className="eyebrow">
              Phone Number
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              spellCheck={false}
              placeholder="024 123 4567"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="font-mono-data"
            />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Sending..." : "Send code"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="otp" className="eyebrow">
              Enter the 6-digit code
            </Label>
            <OTPField.Root
              id="otp"
              length={OTP_LENGTH}
              value={code}
              onValueChange={setCode}
              onValueComplete={handleVerify}
              disabled={isPending}
              className="flex justify-between gap-2"
            >
              {/* Each slot's index comes from its position — the primitive tracks it, there is no
                  index prop to pass. */}
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                <OTPField.Input
                  key={i}
                  autoFocus={i === 0}
                  aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
                  className={cn(
                    "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent text-center font-mono-data text-base transition-colors outline-none",
                    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    "disabled:pointer-events-none disabled:opacity-50",
                    "dark:bg-input/30"
                  )}
                />
              ))}
            </OTPField.Root>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setStep("phone")
                setCode("")
                setError(null)
                setNotice(null)
              }}
            >
              Change number
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleResend}>
              Resend code
            </Button>
          </div>
        </div>
      )}

      {/* Announced to screen readers as the two steps swap and errors come back. */}
      <div role="status" aria-live="polite" className="space-y-2">
        {notice && (
          <div className="rounded-lg border border-chart-3/30 bg-chart-3/12 px-4 py-3 font-mono-data text-sm text-chart-3">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/12 px-4 py-3 font-mono-data text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
