/**
 * The admin chat drawer, rendered with react-dom/server (jest here is node-only,
 * so this proves what the component RETURNS on first paint; the data flow is
 * proved in lib/assistantOverlaySurface.test.ts).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let mockPath = '/admin'
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ refresh: jest.fn() }) }))

import AssistantDrawer from '@/components/admin/AssistantDrawer'
import AssistantChat from '@/components/admin/AssistantChat'

const render = (el: React.ReactElement, path = '/admin') => {
  mockPath = path
  return renderToStaticMarkup(el)
}

describe('AssistantDrawer', () => {
  it('shows the floating button when the server already verified the admin session', () => {
    const html = render(createElement(AssistantDrawer, { verified: true, page: 'invoice', bookingRef: 'HH-PTY-AB12C' }), '/plan/HH-PTY-AB12C/summary')
    expect(html).toContain('Open the manager assistant')
    expect(html).toContain('print:hidden')
    expect(html).toContain('no-print')
  })

  it('renders nothing until the session check passes (a signed-out visitor sees no trace of it)', () => {
    expect(render(createElement(AssistantDrawer, {}))).toBe('')
  })

  it('renders nothing on the full-screen view (the drawer would be a second chat on top of the first)', () => {
    expect(render(createElement(AssistantDrawer, { verified: true }), '/admin/assistant')).toBe('')
  })
})

describe('AssistantChat', () => {
  it('first paint is the loading state, with the booking named when there is one', () => {
    const html = render(createElement(AssistantChat, { variant: 'drawer', context: { page: 'invoice', bookingRef: 'HH-PTY-AB12C' } }))
    expect(html).toContain('Manager assistant')
    expect(html).toContain('HH-PTY-AB12C')
    expect(html).toContain('Loading')
  })

  it('uses no <footer>/<main>/<header>: the admin layout hides footer and restyles main.flex-1', () => {
    const html = render(createElement(AssistantChat, { variant: 'full', context: { page: 'assistant', bookingRef: null } }))
    expect(html).not.toMatch(/<(footer|main|header)[ >]/)
    expect(html).toContain('<textarea')
  })
})
