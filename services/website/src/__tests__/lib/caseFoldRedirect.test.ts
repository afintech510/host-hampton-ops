import { NextRequest } from 'next/server'
import { caseFoldRedirect, middleware } from '@/middleware'

describe('caseFoldRedirect — printed QR paths typed in capitals', () => {
  it('redirects the capitalised ESM Sharks path to the real one', () => {
    expect(caseFoldRedirect('/ESM-SHARKS')).toBe('/esm-sharks')
    expect(caseFoldRedirect('/Esm-Sharks')).toBe('/esm-sharks')
  })

  it('never redirects the lowercase path to itself', () => {
    expect(caseFoldRedirect('/esm-sharks')).toBeNull()
  })

  it('leaves every other capitalised path alone', () => {
    expect(caseFoldRedirect('/plan/HH-1234/summary')).toBeNull()
    expect(caseFoldRedirect('/ESM-SHARKS-X')).toBeNull()
    expect(caseFoldRedirect('/')).toBeNull()
  })

  it('middleware answers 308 with a Location and keeps the query string', () => {
    const res = middleware(new NextRequest('https://www.hosthampton.com/ESM-SHARKS?utm_source=qr'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://www.hosthampton.com/esm-sharks?utm_source=qr')
  })

  it('middleware passes the lowercase path through', () => {
    const res = middleware(new NextRequest('https://www.hosthampton.com/esm-sharks'))
    expect(res.headers.get('location')).toBeNull()
  })
})
