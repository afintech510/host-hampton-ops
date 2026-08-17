/**
 * Tests for parseLocaleSlug — the /es/ locale-prefix parser behind the
 * DB-driven content renderer (app/[...slug]). Pure function, no rendering.
 */

import { parseLocaleSlug } from '@/lib/content/slug'

describe('parseLocaleSlug', () => {
  it('treats a bare slug as English', () => {
    expect(parseLocaleSlug('party-room-rental')).toEqual({
      locale: 'en',
      slug: 'party-room-rental',
      reserved: false,
    })
  })

  it('maps an /es/ prefix to Spanish and strips it from the slug', () => {
    expect(parseLocaleSlug('es/party-room-rental')).toEqual({
      locale: 'es',
      slug: 'party-room-rental',
      reserved: false,
    })
  })

  it('marks a bare /es (no slug) as reserved so it 404s', () => {
    expect(parseLocaleSlug('es')).toMatchObject({ locale: 'es', slug: '', reserved: true })
  })

  it('blocks reserved prefixes even under /es', () => {
    expect(parseLocaleSlug('es/admin').reserved).toBe(true)
    expect(parseLocaleSlug('admin').reserved).toBe(true)
    expect(parseLocaleSlug('api/anything').reserved).toBe(true)
  })

  it('keeps nested slugs and only checks the first segment for reservation', () => {
    expect(parseLocaleSlug('es/a/b')).toEqual({ locale: 'es', slug: 'a/b', reserved: false })
  })

  it('does not treat an en town-service jewelry slug as reserved', () => {
    expect(parseLocaleSlug('permanent-jewelry-southampton')).toEqual({
      locale: 'en',
      slug: 'permanent-jewelry-southampton',
      reserved: false,
    })
  })
})
