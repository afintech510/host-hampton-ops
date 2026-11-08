import { NextRequest } from 'next/server'
import { POST as save } from '@/app/api/party-builder/save/route'
import { POST as checkout } from '@/app/api/party-checkout/route'
import { getSupabase } from '@/lib/supabase'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn(() => { throw new Error('Must not access customer data') }) }))
beforeEach(() => { jest.clearAllMocks(); __resetRateLimitForTests() })

describe.each([['save', save], ['checkout', checkout]] as const)('%s requires a mobile quote', (_name, post) => {
  it.each([
    { locationType: 'mobile' },
    { quoteData: { locationType: 'mobile' } },
    { lineItems: [{ name: 'Mobile Party Package', category: 'mobile-package', unit_price_cents: 40000, quantity: 1 }] },
  ])('rejects the retired mobile calculation before writes, mail, or payments: %j', async body => {
    const res = await post(new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ quoteUrl: '/mobile-party#book', error: expect.stringContaining('custom quote') })
    expect(getSupabase).not.toHaveBeenCalled()
  })
})
