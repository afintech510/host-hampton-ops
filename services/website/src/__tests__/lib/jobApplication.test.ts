import { screenPortfolioUrl } from '@/lib/jobApplication'
import { payLabel, ROLES, JOB_VALID_THROUGH } from '@/lib/careers'
import { careersAlertEmail, INFO_INBOX_CONFIRMED, CAREERS_INFO_INBOX } from '@/lib/careersNotify'

describe('screenPortfolioUrl', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['instagram.com/x', 'https://instagram.com/x'],
    ['http://example.com/work', 'https://example.com/work'],
    ['https://www.pinterest.com/me/boards/', 'https://www.pinterest.com/me/boards/'],
  ])('accepts %j', (raw, expected) => {
    expect(screenPortfolioUrl(raw)).toEqual({ ok: true, url: expected })
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/admin',
    '//evil.example.com/x',
    'https:///nohost',
    'https://evil.example.com\\@hosthampton.com',
    'localhost',
    'ftp://example.com/x',
  ])('refuses %j', raw => {
    expect(screenPortfolioUrl(raw)).toEqual({ ok: false })
  })
})

describe('the hiring facts', () => {
  it('pay is what Adam set on 2026-10-11', () => {
    expect(ROLES.lead.payPerHour).toBe(25)
    expect(ROLES.helper.payPerHour).toBe(17)
    expect(payLabel('lead')).toBe('$25/hr + tips')
    expect(payLabel('helper')).toBe('$17/hr + tips')
  })

  it('the posting expires at the January minimum-wage check, not never', () => {
    expect(new Date(JOB_VALID_THROUGH).getTime()).toBeGreaterThan(Date.parse('2026-12-31'))
    expect(new Date(JOB_VALID_THROUGH).getTime()).toBeLessThan(Date.parse('2027-03-01'))
  })
})

describe('careersAlertEmail', () => {
  it('goes to info@ only once that inbox is confirmed, otherwise the owner inbox', () => {
    const prev = process.env.OWNER_NOTIFY_EMAIL
    process.env.OWNER_NOTIFY_EMAIL = 'owner@example.com'
    expect(careersAlertEmail()).toBe(INFO_INBOX_CONFIRMED ? CAREERS_INFO_INBOX : 'owner@example.com')
    process.env.OWNER_NOTIFY_EMAIL = prev
  })
})
