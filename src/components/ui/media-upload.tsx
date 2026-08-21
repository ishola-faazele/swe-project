"use client"

import { useId, useRef, useState } from "react"
import { FileVideo, ImagePlus, Loader2, RotateCcw, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getMediaUploadUrl } from "@/lib/storage/actions"

export type MediaUploadStatus = 'idle' | 'uploading' | 'success' | 'error'

/**
 * Per-entityType limits and allowlists, keyed the same way KEY_PREFIX is in storage/actions.ts —
 * a lookup, not a branch scattered through the component body.
 *
 * The size caps are advisory only: trivially bypassable by a hand-crafted request, and
 * deliberately NOT enforced server-side (a presigned PUT carries no signed content-length
 * condition). Presigned POST with a signed content-length-range is the documented upgrade path.
 *
 * `acceptedTypes` mirrors validation.ts's allowlists, and is only ever a UX hint — the REAL gate
 * on "a customer may not upload video" is mediaUploadRequestSchema's .refine(), server-side.
 */
const MEDIA_CONFIG: Record<
  'dish' | 'customer',
  { maxBytes: number; maxLabel: string; acceptedTypes: string; hint: string }
> = {
  customer: {
    maxBytes: 8 * 1024 * 1024,
    maxLabel: '8MB',
    acceptedTypes: 'image/jpeg,image/png,image/webp',
    hint: 'JPEG, PNG or WebP, up to 8MB.',
  },
  dish: {
    // ONE combined cap covers both photos and video for a dish, rather than a second cap dimension
    // per content type — a dish photo will never realistically approach 100MB, so splitting this
    // into "image cap" vs "video cap" would add a config axis for no practical benefit.
    maxBytes: 100 * 1024 * 1024,
    maxLabel: '100MB',
    acceptedTypes: 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime',
    hint: 'JPEG, PNG, WebP, MP4, WebM or MOV, up to 100MB.',
  },
}

interface MediaUploadProps {
  /** The currently-attached public URL, or null. */
  value: string | null
  /**
   * Fires on a successful upload AND on a manual clear. `contentType` is reported so a caller that
   * needs to distinguish IMAGE from VIDEO (only DishDetailsClient does) doesn't have to re-derive
   * it from the URL string. Additive — single-arg callers are unaffected.
   */
  onChange: (url: string | null, contentType?: string) => void
  onStatusChange?: (status: MediaUploadStatus) => void
  entityType: 'dish' | 'customer'
  label?: string
  disabled?: boolean
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * File picker that uploads DIRECTLY to MinIO the instant a file is chosen — never on form submit,
 * and never through a Server Action (file bytes do not touch the Next.js server).
 *
 * Two callers with two different shapes: the dish detail page hands each successful upload
 * straight to addDishMedia, and the customer dashboard hands it straight to updateProfilePhoto.
 * Neither merges it into a surrounding form's FormData — this value never passes through one.
 *
 * Renders a plain <img>, never next/image: a preview starts life as a `blob:` object URL that
 * next/image cannot optimize at all and later becomes a real http:// MinIO URL, so next/image
 * would mean two rendering paths for one component. This also keeps next.config.ts free of any
 * images.remotePatterns entry.
 */
export function MediaUpload({
  value,
  onChange,
  onStatusChange,
  entityType,
  label = 'Photo',
  disabled = false,
}: MediaUploadProps) {
  const config = MEDIA_CONFIG[entityType]
  // Only a dish can ever hold video, so only a dish needs the wider noun in its controls.
  const mediaNoun = entityType === 'dish' ? 'media' : 'photo'

  const inputId = useId()
  const [status, setStatus] = useState<MediaUploadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // 'video' means "a video file is selected" — the tile shows an icon rather than a thumbnail for
  // it (see the render below). Tracked separately from previewUrl because a video selection
  // deliberately has NO object URL to show.
  const [previewKind, setPreviewKind] = useState<'image' | 'video' | null>(null)
  // Whether the error currently shown is retryable. Deliberately state, not derived from
  // selectedFileRef: a ref read during render neither triggers a re-render nor is safe to read
  // there, and an oversized pick must NOT offer to retry the previously-selected file.
  const [canRetry, setCanRetry] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  // The last-selected file, kept so "Try again" can re-run against it without reopening the OS
  // file picker.
  const selectedFileRef = useRef<File | null>(null)
  // Tracked separately from `previewUrl` state so revocation never depends on a re-render.
  const objectUrlRef = useRef<string | null>(null)

  /**
   * Incremented at the start of every upload attempt (and whenever an attempt is abandoned).
   * Each attempt captures its own value and applies its result ONLY if it still matches — so a
   * slow first upload resolving after a second, faster one can never overwrite the newer file's
   * URL with its own stale one. Required, not an optimization: without it that overwrite is
   * silent and produces a record pointing at the wrong file. This matters just as much in the
   * dish detail page's repeatedly-remounted "add media" slot as it did in a single-photo field.
   */
  const uploadGenerationRef = useRef(0)

  function applyStatus(next: MediaUploadStatus, message: string | null = null) {
    setStatus(next)
    setErrorMessage(message)
    onStatusChange?.(next)
  }

  function replacePreview(file: File | null) {
    // Revoke the outgoing object URL first, or every re-pick leaks a blob reference.
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (!file) {
      setPreviewUrl(null)
      setPreviewKind(null)
      return
    }
    if (file.type.startsWith('video/')) {
      // No object URL is created for video on purpose. Browsers offer no reliable free way to
      // extract a poster frame from a blob: URL without loading it into a <video> element first,
      // and this tile only ever renders <img> — so the tile shows a video icon instead of a
      // thumbnail. Real playback happens on the dish detail gallery, never inside this uploader.
      setPreviewUrl(null)
      setPreviewKind('video')
      return
    }
    const objectUrl = URL.createObjectURL(file)
    objectUrlRef.current = objectUrl
    setPreviewUrl(objectUrl)
    setPreviewKind('image')
  }

  async function runUpload(file: File) {
    const generation = ++uploadGenerationRef.current
    applyStatus('uploading')

    try {
      const result = await getMediaUploadUrl({ entityType, contentType: file.type })
      if (generation !== uploadGenerationRef.current) return
      if (!result.ok) {
        applyStatus('error', result.error)
        return
      }

      // Straight to MinIO. Content-Type must byte-match what the server signed, or MinIO rejects
      // the PUT with a 403 — that is the content-type enforcement, not a client-side courtesy.
      const response = await fetch(result.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (generation !== uploadGenerationRef.current) return
      if (!response.ok) {
        applyStatus('error', `The media server rejected the upload (${response.status}). Please try again.`)
        return
      }

      applyStatus('success')
      onChange(result.data.publicUrl, file.type)
    } catch (err) {
      // Reached when MinIO is unreachable (the compose stack is down) or the auth gate throws.
      // A successful getMediaUploadUrl does NOT imply MinIO is up: presigning is pure local
      // crypto with no network call, so an unreachable server only ever surfaces right here.
      if (generation !== uploadGenerationRef.current) return
      applyStatus('error', err instanceof Error ? err.message : 'Could not upload this file. Please try again.')
    }
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Clear the native input's value so re-picking the SAME file still fires a change event.
    event.target.value = ''
    if (!file) return

    if (file.size > config.maxBytes) {
      // Rejected inline with no upload attempted. The generation bump abandons any in-flight
      // attempt, so what is displayed (this error) always matches what will actually be applied
      // (nothing) — the previously-saved `value` is left exactly as it was.
      uploadGenerationRef.current++
      setCanRetry(false)
      applyStatus('error', `That file is ${formatMegabytes(file.size)} — please choose one under ${config.maxLabel}.`)
      return
    }

    selectedFileRef.current = file
    setCanRetry(true)
    // Swap the preview before any network call — this is what makes the upload feel instant.
    replacePreview(file)
    runUpload(file)
  }

  function handleRetry() {
    const file = selectedFileRef.current
    if (!file) return
    // Requests a FRESH presigned URL rather than replaying the previous one, which may well be
    // what expired — increasingly likely now that a 100MB video can outrun a 10-minute presign.
    runUpload(file)
  }

  function handleClear() {
    // Abandon any in-flight attempt so its late success can't resurrect a cleared file.
    uploadGenerationRef.current++
    replacePreview(null)
    selectedFileRef.current = null
    setCanRetry(false)
    applyStatus('idle')
    // Never deletes the underlying bucket object — the accepted orphan tradeoff.
    onChange(null)
  }

  const displayUrl = previewUrl ?? value
  const isUploading = status === 'uploading'
  const isVideoSelected = previewKind === 'video'
  const hasSomething = isVideoSelected || Boolean(displayUrl)
  const showClear = hasSomething && !isUploading

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>

      {/* The real file input, visually hidden but still focusable-by-label and fully functional;
          the styled button below is what the user actually sees and clicks. */}
      <Input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={config.acceptedTypes}
        className="sr-only"
        onChange={handleFileSelected}
        disabled={disabled || isUploading}
      />

      <div className="flex flex-col items-center justify-center">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isUploading}
          aria-label={hasSomething ? `Change ${mediaNoun}` : `Add ${mediaNoun}`}
          className={cn(
            "relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-input bg-transparent text-muted-foreground transition-colors outline-none",
            "hover:border-ring hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:opacity-50",
            status === 'error' && "border-destructive/40"
          )}
        >
          {isVideoSelected ? (
            <FileVideo className="h-5 w-5" aria-hidden="true" />
          ) : displayUrl ? (
            <img src={displayUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
          )}

          {isUploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="h-5 w-5 animate-spin text-foreground" aria-hidden="true" />
            </span>
          )}
        </button>

        <div className="min-w-0 w-full mt-3 flex flex-col items-center text-center space-y-1.5">

          {isUploading && (
            <p className="text-xs text-muted-foreground">Uploading…</p>
          )}

          {status === 'error' && errorMessage && (
            <div className="space-y-1.5 rounded-lg bg-destructive/10 p-2">
              <p className="text-xs text-destructive">{errorMessage}</p>
              {canRetry && (
                <Button type="button" variant="ghost" size="xs" onClick={handleRetry}>
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Try again
                </Button>
              )}
            </div>
          )}

          {showClear && (
            <Button type="button" variant="ghost" size="xs" onClick={handleClear}>
              <X className="h-3 w-3" aria-hidden="true" />
              Remove {mediaNoun}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
