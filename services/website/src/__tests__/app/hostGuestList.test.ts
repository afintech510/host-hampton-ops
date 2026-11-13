import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HostGuestList, { smsLinkFor } from '@/components/evites/HostGuestList'

/** The host's guest-list panel: server-rendered (effects do not run), plus the sms: link it builds. */
describe('HostGuestList', () => {
  const html = renderToStaticMarkup(
    createElement(HostGuestList, { shareText: 'Join us!', reshareText: 'Reminder!', inviteUrl: 'https://example.com/i/x', audience: 'guests', onChanged: () => undefined }),
  )

  it('draws both sections in plain language', () => {
    expect(html).toContain('Your guest list')
    expect(html).toContain('Add an RSVP yourself')
    expect(html).toContain('Choose a CSV file')
    expect(html).toContain('We never text your guests')
  })

  it('builds an sms: link that opens the host\'s own messaging app', () => {
    expect(smsLinkFor('+16315551234', 'Join us! https://example.com/i/x')).toBe('sms:+16315551234?&body=Join%20us!%20https%3A%2F%2Fexample.com%2Fi%2Fx')
  })
})
