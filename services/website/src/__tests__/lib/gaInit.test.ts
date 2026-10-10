import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { gaInitScript } from '@/lib/gaInit'

/**
 * The GA / Google Ads bootstrap on `/i/<slug>` (spec §7.1, A17): the slug must
 * never reach Google, and the Ads tag must not run on a guest's page.
 */

const GA = 'G-TEST123'
const ADS = 'AW-99887766'
const script = (pathname: string | null) => gaInitScript({ gaId: GA, gadsId: ADS, pathname })

describe('gaInitScript on an invitation', () => {
  const s = script('/i/mia-glow-7kq2')

  it('sets a cleaned page_location, title and an empty referrer', () => {
    expect(s).toContain("gtag('set', { page_location: window.location.origin + '/i/invite', page_title: 'Party invitation', page_referrer: '' });")
  })

  it('does so BEFORE the config, so the first page_view is cleaned', () => {
    expect(s.indexOf("gtag('set'")).toBeGreaterThan(-1)
    expect(s.indexOf("gtag('set'")).toBeLessThan(s.indexOf("gtag('config'"))
  })

  it('still configures GA4 and does NOT configure Google Ads', () => {
    expect(s).toContain(`gtag('config', '${GA}', { send_page_view: true });`)
    expect(s).not.toContain(ADS)
    expect(s).not.toMatch(/GADS|AW-/)
  })

  it('never contains the slug', () => {
    expect(s).not.toContain('mia-glow')
  })
})

describe('gaInitScript everywhere else is what it always was', () => {
  it.each(['/', '/party-packages', '/my-booking', '/my-booking/invitation', '/i', '/invoice/i/x', null])('%s', (p) => {
    const s = script(p)
    expect(s).not.toContain("gtag('set'")
    expect(s).toContain(`gtag('config', '${GA}', { send_page_view: true });`)
    expect(s).toContain(`gtag('config', '${ADS}');`)
  })

  it('no Ads id configured: no Ads config, as before', () => {
    expect(gaInitScript({ gaId: GA, gadsId: '', pathname: '/' })).not.toContain("gtag('config', ''")
  })
})

describe('the GoogleAnalytics component renders that script for the current path', () => {
  let pathname = '/'
  beforeEach(() => {
    jest.resetModules()
    jest.doMock('next/navigation', () => ({ usePathname: () => pathname }))
    jest.doMock('next/script', () => ({
      __esModule: true,
      default: (p: { id?: string; src?: string; children?: string }) =>
        createElement('script', { 'data-id': p.id, 'data-src': p.src, dangerouslySetInnerHTML: { __html: p.children ?? '' } }),
    }))
    jest.doMock('@/lib/gtag', () => ({ GA_ID: 'G-TEST123', GADS_ID: 'AW-99887766' }))
  })
  afterEach(() => jest.dontMock('next/navigation'))

  const render = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const GoogleAnalytics = require('@/components/GoogleAnalytics').default
    return renderToStaticMarkup(createElement(GoogleAnalytics))
  }

  it('/i/<slug>: the set call, no Ads config, GA4 config kept', () => {
    pathname = '/i/mia-glow-7kq2'
    const html = render()
    expect(html).toContain("gtag('set'")
    expect(html).toContain("page_location: window.location.origin + '/i/invite'")
    expect(html).not.toContain('AW-99887766')
    expect(html).toContain('G-TEST123')
  })

  it('/party-packages: unchanged, with the Ads config', () => {
    pathname = '/party-packages'
    const html = render()
    expect(html).not.toContain("gtag('set'")
    expect(html).toContain('AW-99887766')
  })
})
