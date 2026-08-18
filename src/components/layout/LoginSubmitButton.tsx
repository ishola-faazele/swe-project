"use client"

import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"

/**
 * `useFormStatus` only reports the pending state of an ancestor <form>, so it
 * has to be called from a component rendered INSIDE that form. That is the
 * whole reason this is its own file: `login/page.tsx` stays a Server Component,
 * and only this button crosses the client boundary.
 */
export function LoginSubmitButton({ formAction }: { formAction: (formData: FormData) => void }) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      formAction={formAction}
      disabled={pending}
      size="lg"
      className="w-full tracking-wide"
    >
      {pending ? "Sending…" : "Send Magic Link →"}
    </Button>
  )
}
