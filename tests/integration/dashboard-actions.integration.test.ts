/**
 * Integration coverage for updateProfilePhoto (src/app/dashboard/actions.ts) — TEST-013.
 *
 * Real Postgres via the same prisma singleton the app uses. `@/utils/supabase/server` is mocked
 * to simulate a signed-in session, same pattern as every other integration file in this suite
 * (see helpers.ts's mockAuthSession/mockNoSession).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/utils/supabase/server'
import { prisma } from '@/lib/prisma'
import { updateProfilePhoto } from '@/app/dashboard/actions'
import { createTestCustomer, mockAuthSession, mockNoSession, newRegistry, cleanupRegistry, type TestRegistry } from './helpers'

const createClientMock = vi.mocked(createClient)

describe('updateProfilePhoto (integration)', () => {
  let reg: TestRegistry

  beforeEach(() => {
    reg = newRegistry()
  })

  afterEach(async () => {
    await cleanupRegistry(reg)
  })

  it('rejects with VALIDATION when not signed in, writing nothing', async () => {
    mockNoSession(createClientMock)

    const result = await updateProfilePhoto('https://minio.local/customers/x.jpg')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('VALIDATION')
  })

  it('round-trips a new photo URL onto the signed-in customer\'s own row', async () => {
    const customer = await createTestCustomer(reg)
    mockAuthSession(createClientMock, { id: customer.id, email: customer.email })

    const result = await updateProfilePhoto('https://minio.local/customers/new-photo.jpg')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.imageUrl).toBe('https://minio.local/customers/new-photo.jpg')

    const persisted = await prisma.user.findUnique({ where: { id: customer.id } })
    expect(persisted?.imageUrl).toBe('https://minio.local/customers/new-photo.jpg')
  })

  it('explicit null clears an existing photo', async () => {
    const customer = await createTestCustomer(reg)
    await prisma.user.update({ where: { id: customer.id }, data: { imageUrl: 'https://minio.local/customers/old.jpg' } })
    mockAuthSession(createClientMock, { id: customer.id, email: customer.email })

    const result = await updateProfilePhoto(null)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.imageUrl).toBeNull()
    const persisted = await prisma.user.findUnique({ where: { id: customer.id } })
    expect(persisted?.imageUrl).toBeNull()
  })

  it('scopes the write to the caller\'s own row only — a second customer\'s photo is untouched', async () => {
    const customer = await createTestCustomer(reg)
    const bystander = await createTestCustomer(reg)
    mockAuthSession(createClientMock, { id: customer.id, email: customer.email })

    await updateProfilePhoto('https://minio.local/customers/mine.jpg')

    const bystanderRow = await prisma.user.findUnique({ where: { id: bystander.id } })
    expect(bystanderRow?.imageUrl).toBeNull()
  })
})
