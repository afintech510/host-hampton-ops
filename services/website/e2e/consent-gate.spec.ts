import { test, expect, APIRequestContext } from '@playwright/test'

/**
 * Consent hard gate: a website_content row flagged references_child_media with
 * no signed release attached must be refused when approved/published. The admin
 * content route returns 409 with the friendly message (layer 2); the DB trigger
 * (layer 1) is the structural backstop underneath.
 *
 * Requires ADMIN_PASSWORD + DB. Needs a child-media draft to exist; skips if
 * none is present (create one manually to exercise this in a live environment).
 */

const ADMIN = process.env.ADMIN_PASSWORD
const authHeaders = () => ({ Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' })

async function findChildMediaDraft(request: APIRequestContext) {
  const res = await request.get('/api/admin/marketing', { headers: authHeaders() })
  if (!res.ok()) return null
  const data = await res.json()
  return (data.content || []).find(
    (c: any) => c.references_child_media && (c.status === 'draft' || c.status === 'pending_review')
  ) || null
}

test.describe('consent gate', () => {
  test.skip(!ADMIN, 'ADMIN_PASSWORD not set in this environment')

  test('approving child-media content without a signed release is refused (409)', async ({ request }) => {
    const row = await findChildMediaDraft(request)
    test.skip(!row, 'No child-media draft present to exercise the gate')

    // Make sure it is at pending_review (a legal precursor to approved).
    if (row.status === 'draft') {
      await request.post('/api/admin/marketing/content', {
        headers: authHeaders(),
        data: { id: row.id, to: 'pending_review' },
      })
    }

    const res = await request.post('/api/admin/marketing/content', {
      headers: authHeaders(),
      data: { id: row.id, to: 'approved' },
    })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('Consent gate')
  })
})
