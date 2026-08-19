"use client"

import { useState } from "react"
import { OTPField } from "@base-ui/react/otp-field"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  requestAddEmail,
  requestAddPhone,
  verifyAddEmail,
  verifyAddPhone,
} from "./actions"

const OTP_LENGTH = 6

const CHANNEL_COPY = {
  email: {
    label: "Email address",
    inputType: "email" as const,
    inputMode: "email" as const,
    autoComplete: "email" as const,
    placeholder: "ama@example.com",
    cta: "Add email",
    sentPrefix: "We sent a 6-digit code to",
  },
  phone: {
    label: "Phone number",
    inputType: "tel" as const,
    inputMode: "tel" as const,
    autoComplete: "tel" as const,
    placeholder: "024 123 4567",
    cta: "Add phone",
    sentPrefix: "We sent a 6-digit code to",
  },
}

/**
 * Two-step "add a missing contact method" flow — enter the new value, then the 6-digit code that
 * arrives on it. Deliberately mirrors PhoneLoginForm.tsx's shape (same OTPField primitive, same
 * "no live countdown, just the server's own cooldown message" call) since it's solving the same
 * underlying problem: prove ownership of a value before it becomes part of the account.
 *
 * Only ever rendered for a channel the customer's row genuinely lacks (see dashboard/page.tsx) —
 * there is no "change an existing value" mode, on purpose.
 */
export function AddContactForm({ channel }: { channel: "email" | "phone" }) {
  const copy = CHANNEL_COPY[channel]
  const requestCode = channel === "email" ? requestAddEmail : requestAddPhone
  const verifyCode = channel === "email" ? verifyAddEmail : verifyAddPhone

  const [step, setStep] = useState<"value" | "code">("value")
  const [value, setValue] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [done, setDone] = useState(false)

  async function handleRequestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setIsPending(true)
    try {
      const result = await requestCode(value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setStep("code")
      setNotice(`${copy.sentPrefix} ${value}.`)
    } catch {
      setError("Could not send the verification code. Please try again.")
    } finally {
      setIsPending(false)
    }
  }

  /** Fires the moment the 6th digit lands — no separate "Verify" tap, same as PhoneLoginForm. */
  async function handleVerify(otp: string) {
    setError(null)
    setIsPending(true)
    try {
      const result = await verifyCode(value, otp)
      if (!result.ok) {
        setError(result.error)
        setCode("")
        return
      }
      setDone(true)
    } catch {
      setError("Could not verify that code. Please try again.")
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
      const result = await requestCode(value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCode("")
      setNotice(`We sent a new code to ${value}.`)
    } catch {
      setError("Could not send the verification code. Please try again.")
    } finally {
      setIsPending(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-chart-3/30 bg-chart-3/12 px-4 py-3 font-mono-data text-sm text-chart-3">
        {copy.label} added. Refresh to see it on your profile.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {step === "value" ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`add-${channel}`} className="eyebrow">
              {copy.label}
            </Label>
            <Input
              id={`add-${channel}`}
              name={channel}
              type={copy.inputType}
              inputMode={copy.inputMode}
              autoComplete={copy.autoComplete}
              spellCheck={false}
              placeholder={copy.placeholder}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono-data"
            />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Sending..." : copy.cta}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`add-${channel}-otp`} className="eyebrow">
              Enter the 6-digit code
            </Label>
            <OTPField.Root
              id={`add-${channel}-otp`}
              length={OTP_LENGTH}
              value={code}
              onValueChange={setCode}
              onValueComplete={handleVerify}
              disabled={isPending}
              className="flex justify-between gap-2"
            >
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
                setStep("value")
                setCode("")
                setError(null)
                setNotice(null)
              }}
            >
              Change {channel === "email" ? "email" : "number"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleResend}>
              Resend code
            </Button>
          </div>
        </div>
      )}

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
