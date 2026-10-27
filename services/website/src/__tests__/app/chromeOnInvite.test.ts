import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isHostInvitationPath, isInvitePath, isMetaPixelBlockedPath } from '@/lib/evites/chrome'

/**
 * The site chrome on a guest's invitation (spec §7.1): Nav, Footer, the agency
 * credit and the Meta Pixel are all absent on `/i/<slug>`; the host page keeps
 * the site chrome but not the Pixel. Rendered with react-dom/server (jest here is
 * node-only), so this proves what each component RETURNS; the hook order is
 * proved from source in navHookOrder.test.ts.
 */

let mockPath = '/'
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }))
jest.mock('next/image', () => ({ __esModule: true, default: (p: { alt?: string }) => require('react').createElement('img', { alt: p.alt }) }))
jest.mock('next/script', () => ({
  __esModule: true,
  default: (p: { id?: string; children?: string }) =>
    require('react').createElement('script', { 'data-id': p.id, dangerouslySetInnerHTML: { __html: p.children ?? '' } }),
}))
jest.mock('@/components/CartButton', () => ({ __esModule: true, default: () => null }))
jest.mock('@/lib/metaPixel', () => ({ META_PIXEL_ID: '1543468516699272' }))

import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import BenchworksAttribution from '@/components/BenchworksAttribution'
import MetaPixel from '@/components/MetaPixel'

const render = (c: () => unknown, p: string): string => {
  mockPath = p
  return renderToStaticMarkup(createElement(c as never))
}

describe('path predicates', () => {
  it('/i/<anything> is an invitation; /i, /index and /invoice are not', () => {
    expect(isInvitePath('/i/mia-glow-7kq2')).toBe(true)
    expect(isInvitePath('/i/x/y')).toBe(true)
    for (const no of ['/i', '/index', '/invoice/i/x', '/plan/i/1', '/', '', null, undefined]) expect(isInvitePath(no as never)).toBe(false)
  })

  it('the host page is /my-booking/invitation and beneath, not /my-booking', () => {
    expect(isHostInvitationPath('/my-booking/invitation')).toBe(true)
    expect(isHostInvitationPath('/my-booking/invitation/edit')).toBe(true)
    for (const no of ['/my-booking', '/my-booking/invitations', '/my-booking/pay', '/i/x']) expect(isHostInvitationPath(no)).toBe(false)
  })

  it('the Pixel is blocked on exactly those two', () => {
    expect(isMetaPixelBlockedPath('/i/mia-glow-7kq2')).toBe(true)
    expect(isMetaPixelBlockedPath('/my-booking/invitation')).toBe(true)
    expect(isMetaPixelBlockedPath('/my-booking')).toBe(false)
    expect(isMetaPixelBlockedPath('/party-packages')).toBe(false)
  })
})

describe('on /i/<slug> the chrome renders nothing', () => {
  const P = '/i/mia-glow-7kq2'
  it('Nav', () => expect(render(Nav, P)).toBe(''))
  it('Footer (and its fade-out spacer)', () => expect(render(Footer, P)).toBe(''))
  it('BenchworksAttribution', () => expect(render(BenchworksAttribution, P)).toBe(''))
  it('MetaPixel: no init script, so no PageView and no connect.facebook.net', () => {
    const out = render(MetaPixel, P)
    expect(out).toBe('')
    expect(out).not.toContain('fbevents')
  })
})

describe('on /my-booking/invitation the site chrome stays but the Pixel does not', () => {
  const P = '/my-booking/invitation'
  it('Nav, Footer and the credit render', () => {
    expect(render(Nav, P)).toContain('<header')
    expect(render(Footer, P)).toContain('<footer')
    expect(render(BenchworksAttribution, P)).toContain('Built by Benchworks')
  })
  it('MetaPixel renders nothing', () => expect(render(MetaPixel, P)).toBe(''))
})

describe('everywhere else nothing moved', () => {
  it.each(['/', '/party-packages', '/my-booking', '/events/x'])('%s', (p) => {
    expect(render(Nav, p)).toContain('<header')
    const footer = render(Footer, p)
    expect(footer).toContain('<footer')
    expect(footer).toContain('h-40 bg-gradient-to-b') // the spacer rides with the footer
    expect(render(BenchworksAttribution, p)).toContain('Built by Benchworks')
    const pixel = render(MetaPixel, p)
    expect(pixel).toContain("fbq('init', '1543468516699272')") // script text is raw in dangerouslySetInnerHTML
  })

  it('Nav still hides on the planner', () => {
    expect(render(Nav, '/party-planner')).toBe('')
  })
})

describe('other things that would otherwise ride along onto a guest\'s page', () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8')

  it('the promo banners are hidden on /i/', () => {
    for (const f of ['ChristmasMarketBanner.tsx', 'AppointmentBanner.tsx']) {
      expect(read('components', f)).toMatch(/'\/i\/',/)
    }
  })

  it('the Crisp chat is neither shown nor even LOADED on /i/ (its page URL would carry the slug)', () => {
    const crisp = read('components', 'CrispChat.tsx')
    expect(crisp).toMatch(/HIDDEN_PAGES = \[[^\]]*'\/i'/)
    const inject = crisp.slice(crisp.indexOf('Inject Crisp script once'), crisp.indexOf('Show/hide based on current route'))
    expect(inject.indexOf('isInvitePath(pathname)')).toBeGreaterThan(-1)
    expect(inject.indexOf('isInvitePath(pathname)')).toBeLessThan(inject.indexOf('createElement'))
  })

  it('attribution capture is skipped on /i/ because landing_path would store the slug', () => {
    expect(read('components', 'AttributionCapture.tsx')).toMatch(/isInvitePath\(pathname\)\) return/)
    expect(read('lib', 'utm.ts')).toMatch(/landing_path = window\.location\.pathname/)
  })
})

describe('next.config.js headers() for /i/:path*', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(path.join(process.cwd(), 'next.config.js')) as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> }

  it('sends X-Robots-Tag noindex,nofollow and Referrer-Policy no-referrer', async () => {
    const rules = await config.headers()
    const rule = rules.find((r) => r.source === '/i/:path*')
    expect(rule).toBeDefined()
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ]),
    )
  })

  it('does not put those headers on any other path', async () => {
    const rules = await config.headers()
    for (const r of rules) {
      if (r.source === '/i/:path*') continue
      // The crew app is a staff tool and says noindex too — but ONLY that: none of the
      // invitation's referrer policy rides along.
      if (r.source === '/crew/:path*') {
        expect(r.headers.map((h) => h.key)).toEqual(['X-Robots-Tag'])
        continue
      }
      expect(r.headers.map((h) => h.key)).not.toContain('X-Robots-Tag')
    }
  })
})
