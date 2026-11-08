import { quoAppLink } from '@/lib/quoAppLink'

describe('quoAppLink', () => {
  it('opens a new text in the Quo app, with the number encoded', () => {
    expect(quoAppLink('text', '(631) 555-0100')).toBe('openphone://message?number=%2B16315550100&selectedAsFallback=true')
    expect(quoAppLink('text', '1-631-555-0100')).toBe('openphone://message?number=%2B16315550100&selectedAsFallback=true')
  })

  it('opens the dialer and does not dial by itself', () => {
    const url = quoAppLink('call', '6315550100')
    expect(url).toBe('openphone://dial?number=%2B16315550100&selectedAsFallback=true')
    expect(url).not.toMatch(/action=call/)
  })

  it('refuses anything that is not a phone number', () => {
    for (const bad of [null, undefined, '', 'abc', '555-0100', '12345678901234']) expect(quoAppLink('text', bad)).toBeNull()
  })

  it('cannot be steered by what is in the number field', () => {
    const url = quoAppLink('text', '631555010&text=hi')
    expect(url).toBeNull()
  })
})
