import { test, expect } from '@playwright/test'

/**
 * DB-driven renderer (app/[...slug]):
 *  - existing static routes are NOT shadowed by the catch-all
 *  - an unknown / unpublished slug 404s
 *  - a published seed slug 200s with FAQ JSON-LD (guarded on the seed existing)
 */
test.describe('landing pages', () => {
  test('existing static route is unaffected by the catch-all', async ({ page }) => {
    const res = await page.goto('/permanent-jewelry')
    expect(res?.status()).toBe(200)
  })

  test('unknown slug returns 404', async ({ request }) => {
    const res = await request.get('/this-slug-should-never-exist-xyz-123')
    expect(res.status()).toBe(404)
  })

  test('published content slug renders with FAQ JSON-LD', async ({ page }) => {
    const res = await page.goto('/permanent-jewelry-southampton')
    // Only asserts fully when the Southampton seed has been published.
    test.skip(res?.status() === 404, 'Southampton landing not published in this environment')
    expect(res?.status()).toBe(200)
    const faqLd = await page.locator('script[type="application/ld+json"]').allTextContents()
    expect(faqLd.some(t => t.includes('FAQPage'))).toBeTruthy()
  })
})
