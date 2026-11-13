import { HOST_PATCH_KEYS, PAGE_ONLY_KEYS, isPageOnlyPatch, screenHostPatch, type HostPatchContext } from '@/lib/evites/hostScreens'
import { cleanRegistryUrl, registryHostname, registryView } from '@/lib/evites/registry'
import { formFromCustomize, patchFromForm, type HostCustomizeValues } from '@/lib/evites/hostUi'
import { inviteFacts, type InviteFactsEvite } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { EVITE_PAGE_COLUMNS, EVITE_SEND_COLUMNS } from '@/lib/evites/views'
import { EVITE_RENDER_COLUMNS } from '@/lib/evites/render'

/** Migration 097 host tools: second contact, appearance, registry. */

const CTX: HostPatchContext = { today: '2026-11-01', partyDate: '2026-11-14', current: { rsvp_deadline: null } }
const ok = (body: unknown, ctx: HostPatchContext = CTX) => {
  const r = screenHostPatch(body, ctx)
  if (!r.ok) throw new Error(`expected ok, got ${r.field}: ${r.message}`)
  return r.columns
}
const refused = (body: unknown, ctx: HostPatchContext = CTX) => {
  const r = screenHostPatch(body, ctx)
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r.columns)}`)
  return r
}

describe('second contact', () => {
  it('needs both a name and a phone', () => {
    expect(ok({ host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' })).toEqual({ host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' })
    expect(refused({ host_contact2_name: 'Ciara' }).field).toBe('host_contact2_phone')
    expect(refused({ host_contact2_phone: '631-875-6580' }).field).toBe('host_contact2_name')
  })
  it('clearing both is fine; clearing one against a stored pair is not', () => {
    expect(ok({ host_contact2_name: '', host_contact2_phone: null })).toEqual({ host_contact2_name: null, host_contact2_phone: null })
    const stored = { ...CTX, current: { rsvp_deadline: null, host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' } }
    expect(refused({ host_contact2_name: '' }, stored).field).toBe('host_contact2_name')
    expect(ok({ host_contact2_phone: '631-875-0000' }, stored)).toEqual({ host_contact2_phone: '631-875-0000' })
  })
  it.each(['(631) 555-0123', '555-0123', '131-555-0123', 'call me', '<script>'])('screens the phone %j', (phone) => {
    expect(refused({ host_contact2_name: 'Ciara', host_contact2_phone: phone }).field).toBe('host_contact2_phone')
  })
  it('a name is 1..40 characters', () => {
    expect(refused({ host_contact2_name: 'x'.repeat(41), host_contact2_phone: '631-875-6580' }).field).toBe('host_contact2_name')
  })
})

describe('appearance', () => {
  it('accepts a palette key and a motion, or null', () => {
    expect(ok({ page_color: 'navy', page_motion: 'sparkle' })).toEqual({ page_color: 'navy', page_motion: 'sparkle' })
    expect(ok({ page_color: null, page_motion: '' })).toEqual({ page_color: null, page_motion: null })
  })
  it.each(['#ff0000', 'red;background:url(x)', 'NAVY', 'nope', 3, ['navy']])('refuses colour %j', (v) => {
    expect(refused({ page_color: v }).field).toBe('page_color')
  })
  it.each(['blink', 'SPARKLE', 1, {}])('refuses motion %j', (v) => {
    expect(refused({ page_motion: v }).field).toBe('page_motion')
  })
})

describe('registry link and message', () => {
  it('accepts an https link and a note, "" -> null', () => {
    expect(ok({ registry_url: 'https://www.babylist.com/list/mia', registry_note: ' Thank you!  ' })).toEqual({
      registry_url: 'https://www.babylist.com/list/mia',
      registry_note: 'Thank you!',
    })
    expect(ok({ registry_url: '', registry_note: '' })).toEqual({ registry_url: null, registry_note: null })
  })
  it.each([
    'http://babylist.com/x',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//babylist.com/x',
    'https://user:pw@babylist.com/x',
    'https://babylist.com/a b',
    'https://localhost/x',
    'https://10.0.0.1/x',
    'https://[::1]/x',
    'https://babylist.com/"onmouseover="x',
    'https://' + 'a'.repeat(300) + '.com',
    'ftp://babylist.com',
    'babylist.com',
    42,
  ])('refuses the link %j', (v) => {
    expect(refused({ registry_url: v }).field).toBe('registry_url')
  })
  it('a note over 300 characters is refused', () => {
    expect(refused({ registry_note: 'x'.repeat(301) }).field).toBe('registry_note')
  })
  it('the page shows the hostname only, and re-screens what it was handed', () => {
    expect(registryHostname('https://www.babylist.com/list/abc?utm=1')).toBe('babylist.com')
    expect(registryView('https://www.babylist.com/x', null)).toEqual({ note: null, link: { href: 'https://www.babylist.com/x', host: 'babylist.com' } })
    expect(registryView('javascript:alert(1)', null)).toBeNull()
    expect(registryView('javascript:alert(1)', 'Hello')).toEqual({ note: 'Hello', link: null })
    expect(registryView(null, '   ')).toBeNull()
    expect(cleanRegistryUrl('https://a.co/x')).toBe('https://a.co/x')
  })
})

describe('the allow-list', () => {
  it('names thirteen keys and the page-only ones are among them', () => {
    expect(HOST_PATCH_KEYS).toHaveLength(13)
    for (const k of PAGE_ONLY_KEYS) expect(HOST_PATCH_KEYS).toContain(k)
  })
  it('an unknown key is still a 400 that names it', () => {
    expect(refused({ page_colour: 'navy' }).field).toBe('page_colour')
    expect(refused({ added_by_host: true }).field).toBe('added_by_host')
  })
  it('a patch of only page-only keys needs no re-render; anything printed does', () => {
    expect(isPageOnlyPatch({ page_color: 'navy', registry_url: null })).toBe(true)
    expect(isPageOnlyPatch({ page_color: 'navy', host_note: 'x' })).toBe(false)
    expect(isPageOnlyPatch({ host_contact2_name: 'x', host_contact2_phone: '631-875-6580' })).toBe(false)
    expect(isPageOnlyPatch({})).toBe(false)
  })
})

describe('the form', () => {
  const stored: HostCustomizeValues = {
    host_note: null,
    gift_note: null,
    rsvp_deadline: null,
    show_host_contact: true,
    host_contact_name: null,
    host_contact_phone: null,
    host_contact2_name: null,
    host_contact2_phone: null,
    page_color: 'midnight',
    page_motion: 'none',
    registry_url: null,
    registry_note: null,
  }
  it('an untouched form is an empty patch', () => {
    expect(patchFromForm(formFromCustomize(stored), stored)).toEqual({})
  })
  it('sends only what changed, "" as null, the phone formatted', () => {
    const f = { ...formFromCustomize(stored), pageColor: 'teal', pageMotion: 'drift', hostContact2Name: 'Ciara', hostContact2Phone: '(631) 875-6580', registryUrl: ' https://a.co/x ', registryNote: '' }
    expect(patchFromForm(f, stored)).toEqual({
      page_color: 'teal',
      page_motion: 'drift',
      host_contact2_name: 'Ciara',
      host_contact2_phone: '631-875-6580',
      registry_url: 'https://a.co/x',
    })
  })
  it('clearing stored values sends null', () => {
    const s2 = { ...stored, host_contact2_name: 'C', host_contact2_phone: '631-875-6580', registry_url: 'https://a.co/x', registry_note: 'hi' }
    const f = { ...formFromCustomize(s2), hostContact2Name: '', hostContact2Phone: '', registryUrl: '', registryNote: '' }
    expect(patchFromForm(f, s2)).toEqual({ host_contact2_name: null, host_contact2_phone: null, registry_url: null, registry_note: null })
  })
})

describe('hostContactLine with a second person', () => {
  const DOT = String.fromCharCode(0xb7)
  const booking = {
    party_type: 'in_studio_theme',
    party_date: '2026-11-14',
    party_time: '14:00',
    package_type: null,
    guest_count_approx: 10,
    child_name: 'Mia',
    child_age: 7,
    party_tags: { location_type: 'host_hampton' },
    quote_snapshot: null,
  }
  const evite = (over: Partial<InviteFactsEvite> = {}): InviteFactsEvite => ({
    template_slug: 'glow',
    theme_word: null,
    theme_sub: null,
    host_contact_name: 'Sue',
    host_contact_phone: '516-982-4997',
    show_host_contact: true,
    host_note: null,
    gift_note: null,
    rsvp_deadline: null,
    ...over,
  })
  const facts = (e: InviteFactsEvite) => inviteFacts(booking as never, e, [], [], 'live')
  const line = (e: InviteFactsEvite) => facts(e).hostContactLine

  it('reads "Ask Sue - 516-982-4997 or Ciara - 631-875-6580"', () => {
    expect(line(evite({ host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' }))).toBe(`Any questions? Ask Sue ${DOT} 516-982-4997 or Ciara ${DOT} 631-875-6580`)
  })
  it('the single-contact string is unchanged, and half a pair is ignored', () => {
    const single = `Any questions? Ask Sue ${DOT} 516-982-4997`
    expect(line(evite())).toBe(single)
    expect(line(evite({ host_contact2_name: 'Ciara', host_contact2_phone: null }))).toBe(single)
    expect(line(evite({ host_contact2_name: null, host_contact2_phone: '631-875-6580' }))).toBe(single)
    expect(line(evite({ host_contact2_name: 'Ciara', host_contact2_phone: 'call me' }))).toBe(single)
  })
  it('hidden stays hidden', () => {
    expect(line(evite({ show_host_contact: false, host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' }))).toBeNull()
  })
  it('the second contact moves the render hash; appearance and registry are not in it', () => {
    const a = renderInputsHash(facts(evite()))
    const b = renderInputsHash(facts(evite({ host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' })))
    expect(a).not.toBe(b)
    const c = renderInputsHash(facts({ ...evite(), page_color: 'navy', registry_url: 'https://a.co/x' } as never))
    expect(c).toBe(a)
  })
})

describe('column lists carry the new columns', () => {
  it('page, send and render reads select them', () => {
    for (const c of ['host_contact2_name', 'host_contact2_phone']) {
      expect(EVITE_PAGE_COLUMNS).toContain(c)
      expect(EVITE_SEND_COLUMNS).toContain(c)
      expect(EVITE_RENDER_COLUMNS).toContain(c)
    }
    for (const c of ['page_color', 'page_motion', 'registry_url', 'registry_note']) expect(EVITE_PAGE_COLUMNS).toContain(c)
  })
})
