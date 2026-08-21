"use client"

import { useState } from "react"

import { MediaUpload } from "@/components/ui/media-upload"
import { updateProfilePhoto } from "./actions"

/**
 * The customer's own profile photo, set entirely by them — the admin has no write path to this
 * field at all (see the PRD's Non-Goals).
 *
 * Unlike the admin's dialogs, which merge an uploaded URL into a bigger form's save payload, there
 * is NO surrounding form here: a photo is this widget's entire content. So a successful upload is
 * persisted the moment MediaUpload's onChange fires, rather than waiting for a Save click with
 * nothing else to batch with.
 */
export function ProfilePhoto({ initialImageUrl }: { initialImageUrl: string | null }) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(url: string | null) {
    // Optimistic: MediaUpload's own preview already shows this, so the widget would look out of
    // sync with its own uploader if it waited for the round trip.
    setImageUrl(url)
    setIsSaving(true)
    setError(null)
    try {
      const result = await updateProfilePhoto(url)
      if (!result.ok) setError(result.error)
    } catch {
      setError('Could not save your photo. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-sm font-bold text-foreground">Your photo</h2>
      <p className="meta-text mt-0.5 mb-4">
        {imageUrl
          ? 'Shown to the kitchen team so they can recognize you.'
          : 'Add a photo so the kitchen team can recognize you.'}
      </p>

      <MediaUpload
        value={imageUrl}
        onChange={handleChange}
        entityType="customer"
        label="Photo"
      />

      {isSaving && <p className="text-xs text-muted-foreground mt-2">Saving…</p>}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  )
}
