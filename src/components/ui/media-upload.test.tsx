/**
 * Component tests for MediaUpload (FE-001) — the admin-only photo picker that uploads directly to
 * MinIO the instant a file is picked. `@/lib/storage/actions`'s getMediaUploadUrl and `global.fetch`
 * are mocked; no real network call, no real MinIO instance required.
 *
 * jsdom (this repo's `jsdom` Vitest project) does not implement `URL.createObjectURL`/
 * `revokeObjectURL` at all — calling either throws "is not a function" — so both are stubbed
 * directly on the global `URL` object below. This is a jsdom gap, not something this component
 * does wrong; every test in this file needs the stub, so it lives in `beforeEach`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaUpload } from './media-upload'
import type { ActionResult } from '@/lib/errors'

vi.mock('@/lib/storage/actions', () => ({ getMediaUploadUrl: vi.fn() }))

import { getMediaUploadUrl } from '@/lib/storage/actions'

const getMediaUploadUrlMock = vi.mocked(getMediaUploadUrl)

type UploadUrlResult = ActionResult<{ uploadUrl: string; publicUrl: string }>

/** A promise this test controls the resolution timing of — required for the stale-generation race. */
function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let fetchMock: ReturnType<typeof vi.fn>
let objectUrlCounter: number

beforeEach(() => {
  vi.clearAllMocks()
  objectUrlCounter = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(URL as any).createObjectURL = vi.fn(() => `blob:mock-url-${objectUrlCounter++}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(URL as any).revokeObjectURL = vi.fn()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jpegFile(name = 'photo.jpg') {
  return new File(['fake-image-bytes'], name, { type: 'image/jpeg' })
}

describe('MediaUpload — idle', () => {
  it('renders idle with no preview when value is null', () => {
    const { container } = render(<MediaUpload value={null} onChange={vi.fn()} entityType="dish" />)

    expect(container.querySelector('img')).not.toBeInTheDocument()
    // entityType="dish" uses the wider "media" noun (a dish can hold video too) — "photo" is only
    // used for entityType="customer".
    expect(screen.getByRole('button', { name: 'Add media' })).toBeInTheDocument()
    expect(screen.queryByText('Uploading…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove media/i })).not.toBeInTheDocument()
  })

  // NOTE: the preview <img> is rendered with alt="" (purely decorative, its meaning is carried by
  // the surrounding label/button), which removes it from the accessibility tree entirely — so
  // getByRole('img') can never find it. container.querySelector('img') is used instead throughout
  // this file for exactly that reason, not as a shortcut.
  it('renders an existing photo (a non-null value) as the preview image, with the Change-photo affordance', () => {
    const { container } = render(<MediaUpload value="https://cdn.example.com/dishes/existing.jpg" onChange={vi.fn()} entityType="dish" />)

    const img = container.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('https://cdn.example.com/dishes/existing.jpg')
    expect(screen.getByRole('button', { name: 'Change media' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove media/i })).toBeInTheDocument()
  })
})

describe('MediaUpload — successful upload', () => {
  it('shows an instant preview and the uploading status the moment a file is picked, before the action resolves', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<UploadUrlResult>()
    getMediaUploadUrlMock.mockReturnValue(deferred.promise)

    const { container } = render(<MediaUpload value={null} onChange={vi.fn()} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement

    await user.upload(input, jpegFile())

    // Preview swaps before any network call resolves — this is what makes the upload feel instant.
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('blob:mock-url-')
    expect(screen.getByText('Uploading…')).toBeInTheDocument()

    deferred.resolve({ ok: true, data: { uploadUrl: 'https://upload', publicUrl: 'https://public/x.jpg' } })
    await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument())
  })

  it('calls onChange with the public URL once getMediaUploadUrl and the PUT both succeed', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned', publicUrl: 'https://minio.local/dishes/abc.jpg' },
    })
    fetchMock.mockResolvedValue({ ok: true } as Response)
    const onChange = vi.fn()

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, jpegFile())

    // Widened 2-arg signature: (url, contentType) — a caller that needs to distinguish IMAGE from
    // VIDEO (DishDetailsClient) doesn't have to re-derive it from the URL string.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://minio.local/dishes/abc.jpg', 'image/jpeg'))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://minio.local/presigned',
      expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } })
    )
  })

  it('passes entityType through to getMediaUploadUrl along with the picked file\'s content type', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned', publicUrl: 'https://minio.local/customers/abc.jpg' },
    })
    fetchMock.mockResolvedValue({ ok: true } as Response)

    render(<MediaUpload value={null} onChange={vi.fn()} entityType="customer" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, jpegFile())

    await waitFor(() => expect(getMediaUploadUrlMock).toHaveBeenCalledWith({ entityType: 'customer', contentType: 'image/jpeg' }))
  })
})

describe('MediaUpload — failure modes', () => {
  it('shows the error state and does not call onChange when getMediaUploadUrl returns ok: false', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({ ok: false, error: 'Only JPEG, PNG, or WebP images are supported.', code: 'VALIDATION' })
    const onChange = vi.fn()

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, jpegFile())

    expect(await screen.findByText('Only JPEG, PNG, or WebP images are supported.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the error state and does not call onChange when the PUT itself is rejected (non-ok response)', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned', publicUrl: 'https://minio.local/dishes/abc.jpg' },
    })
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response)
    const onChange = vi.fn()

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, jpegFile())

    expect(await screen.findByText(/rejected the upload \(403\)/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a retryable error and does not call onChange when MinIO is unreachable (fetch throws)', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned', publicUrl: 'https://minio.local/dishes/abc.jpg' },
    })
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const onChange = vi.fn()

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, jpegFile())

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects an oversized file inline against the customer 8MB cap (no getMediaUploadUrl call at all)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const oversized = new File([new Uint8Array(9 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' })

    render(<MediaUpload value={null} onChange={onChange} entityType="customer" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, oversized)

    expect(await screen.findByText(/please choose one under 8MB/i)).toBeInTheDocument()
    expect(getMediaUploadUrlMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  // Proves MEDIA_CONFIG's per-entityType lookup is actually wired to the right instance, not a
  // global constant — the exact same file size that just got rejected for entityType="customer"
  // above must sail through for entityType="dish" (100MB cap).
  it('accepts the same file size a customer upload would reject, against the dish 100MB cap', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned', publicUrl: 'https://minio.local/dishes/big.jpg' },
    })
    fetchMock.mockResolvedValue({ ok: true } as Response)
    const onChange = vi.fn()
    const nineMb = new File([new Uint8Array(9 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    await user.upload(input, nineMb)

    await waitFor(() => expect(getMediaUploadUrlMock).toHaveBeenCalled())
    expect(screen.queryByText(/please choose one under/i)).not.toBeInTheDocument()
  })

  it('accepts an .mp4 file selection for entityType="dish", well under the 100MB cap', async () => {
    const user = userEvent.setup()
    getMediaUploadUrlMock.mockResolvedValue({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned', publicUrl: 'https://minio.local/dishes/clip.mp4' },
    })
    fetchMock.mockResolvedValue({ ok: true } as Response)
    const onChange = vi.fn()
    const clip = new File(['fake-video-bytes'], 'clip.mp4', { type: 'video/mp4' })

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement
    expect(input.accept).toContain('video/mp4')
    await user.upload(input, clip)

    await waitFor(() => expect(getMediaUploadUrlMock).toHaveBeenCalledWith({ entityType: 'dish', contentType: 'video/mp4' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://minio.local/dishes/clip.mp4', 'video/mp4'))
  })
})

describe('MediaUpload — clear', () => {
  // `value` is a controlled prop — MediaUpload itself never decides the photo is gone, it only
  // reports the intent via onChange(null) and immediately resets its OWN local status back to
  // idle. Whether the <img> actually disappears depends on the parent re-rendering with
  // value={null} in response, which this test simulates explicitly via rerender() rather than
  // assuming it happens automatically.
  it('clicking Remove photo calls onChange(null), and the preview clears once the parent passes value={null} back down', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const { container, rerender } = render(
      <MediaUpload value="https://cdn.example.com/dishes/existing.jpg" onChange={onChange} entityType="dish" />
    )
    await user.click(screen.getByRole('button', { name: /remove media/i }))

    expect(onChange).toHaveBeenCalledWith(null)
    expect(onChange).toHaveBeenCalledTimes(1)

    rerender(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove media/i })).not.toBeInTheDocument()
  })
})

describe('MediaUpload — stale-generation race (the required, not-to-be-skipped case)', () => {
  /**
   * Select file A (its getMediaUploadUrl call is held open via a deferred promise, never resolved
   * until the end of the test), then select file B before A resolves — B's own call resolves
   * immediately end-to-end. Only after B has fully completed (onChange already called with B's
   * URL) is A's deferred promise finally resolved. Without the generation-counter guard in
   * image-upload.tsx, A's late resolution would call onChange a second time with A's stale URL,
   * silently overwriting the newer photo. This is the single most failure-prone behavior FE-001
   * introduced (see its Estimated Complexity note in the task list) — asserted here by name, not
   * folded into a generic "upload works" test.
   *
   * Uses fireEvent.change directly rather than userEvent.upload for BOTH selections: the real
   * component disables the file input the instant status flips to 'uploading' (so a real admin
   * physically cannot open the OS file picker again mid-upload), and userEvent.upload faithfully
   * enforces that same disabled-element restriction — it would refuse to fire a second selection
   * once the first has (synchronously, by the time `await user.upload(...)` returns) disabled the
   * input. fireEvent.change bypasses that browser-realism layer to drive the underlying
   * generation-counter guard directly, which is what this test exists to exercise. Whether two
   * selections can race in a real browser (e.g. a narrow pre-render window, or a future change to
   * the disabled logic) is exactly the kind of defense-in-depth this guard is for.
   */
  it('a slow first upload resolving after a faster second one never overwrites the newer image', async () => {
    const deferredA = createDeferred<UploadUrlResult>()

    getMediaUploadUrlMock
      .mockReturnValueOnce(deferredA.promise) // File A: held open indefinitely, for now
      .mockResolvedValueOnce({
        ok: true,
        data: { uploadUrl: 'https://minio.local/presigned-b', publicUrl: 'https://minio.local/dishes/b.jpg' },
      }) // File B: resolves immediately

    fetchMock.mockResolvedValue({ ok: true } as Response)
    const onChange = vi.fn()

    render(<MediaUpload value={null} onChange={onChange} entityType="dish" />)
    const input = screen.getByLabelText('Photo') as HTMLInputElement

    // File A selected first — its upload attempt starts and immediately stalls on the deferred
    // getMediaUploadUrl call above.
    fireEvent.change(input, { target: { files: [jpegFile('a.jpg')] } })
    // File B selected before A resolves — this bumps the generation counter past A's captured value.
    fireEvent.change(input, { target: { files: [jpegFile('b.jpg')] } })

    // B's faster upload completes in full.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://minio.local/dishes/b.jpg', 'image/jpeg'))
    expect(onChange).toHaveBeenCalledTimes(1)

    // NOW let A's stale upload resolve. Its generation no longer matches the ref's current value,
    // so it must be discarded silently: no second onChange call, and A's URL must never appear.
    deferredA.resolve({
      ok: true,
      data: { uploadUrl: 'https://minio.local/presigned-a', publicUrl: 'https://minio.local/dishes/a.jpg' },
    })
    // Flush the microtask/promise chain inside the (now-abandoned) runUpload(fileA) continuation.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalledWith('https://minio.local/dishes/a.jpg')
    // fetch was never reached for A's PUT — the generation check short-circuits before that.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
