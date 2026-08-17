import { test, expect, APIRequestContext } from '@playwright/test'

/**
 * Admin marketing approval flow at the API layer: the snapshot loads, and a
 * draft content row can be walked draft → pending_review → approved →
 * published through the graph (each step is an admin-gated advance()).
 *
 * Requires ADMIN_PASSWORD + a reachable DB with migrations applied and the
 * Southampton draft seeded. Skips cleanly otherwise.
 */

const ADMIN = process.env.ADMIN_PASSWORD
const authHeaders = () => ({ Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' })

async function findSouthampton(request: APIRequestContext) {
  const res = await request.get('/api/admin/marketing', { headers: authHeaders() })
  if (!res.ok()) return null
  const data = await res.json()
  return (data.content || []).find((c: any) => c.slug === 'permanent-jewelry-southampton') || null
}

test.describe('admin marketing', () => {
  test.skip(!ADMIN, 'ADMIN_PASSWORD not set in this environment')

  test('snapshot requires admin auth', async ({ request }) => {
    const res = await request.get('/api/admin/marketing')
    expect(res.status()).toBe(401)
  })

  test('walks the Southampton draft to published', async ({ request }) => {
    const row = await findSouthampton(request)
    test.skip(!row, 'Southampton seed not present')

    // Reset to draft if it was left published/approved by a prior run.
    if (row.status !== 'draft') {
      await request.post('/api/admin/marketing/content', {
        headers: authHeaders(),
        data: { id: row.id, to: 'draft' },
      })
    }

    for (const to of ['pending_review', 'approved', 'published']) {
      const res = await request.post('/api/admin/marketing/content', {
        headers: authHeaders(),
        data: { id: row.id, to },
      })
      expect(res.ok(), `advance to ${to}`).toBeTruthy()
    }

    // Published page now renders.
    const page = await request.get('/permanent-jewelry-southampton')
    expect(page.status()).toBe(200)
  })

  test('rejects an illegal transition (draft → published)', async ({ request }) => {
    const row = await findSouthampton(request)
    test.skip(!row, 'Southampton seed not present')
    // Force back to draft first.
    await request.post('/api/admin/marketing/content', { headers: authHeaders(), data: { id: row.id, to: 'draft' } })
    const res = await request.post('/api/admin/marketing/content', {
      headers: authHeaders(),
      data: { id: row.id, to: 'published' },
    })
    expect(res.status()).toBe(400)
  })
})
