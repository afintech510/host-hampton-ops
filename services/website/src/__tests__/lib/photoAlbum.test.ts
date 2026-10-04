import {
  PHOTO_ALBUM_SUBJECT, defaultOccasion, photoAlbumEmailHtml, photoAlbumText,
  screenFotoshareUrl, screenOccasion,
} from '@/lib/photoAlbum'
import { REVIEW_BASE_URL } from '@/lib/marketing/reviewLink'

describe('screenFotoshareUrl', () => {
  it.each([
    ['https://fotoshare.co/e/AbC123', 'https://fotoshare.co/e/AbC123'],
    ['  https://fotoshare.co/e/AbC123  ', 'https://fotoshare.co/e/AbC123'],
    ['fotoshare.co/e/AbC123', 'https://fotoshare.co/e/AbC123'],
    ['http://fotoshare.co/e/AbC123', 'https://fotoshare.co/e/AbC123'],
    ['https://www.fotoshare.co/e/AbC123', 'https://www.fotoshare.co/e/AbC123'],
  ])('accepts %j', (raw, want) => {
    expect(screenFotoshareUrl(raw)).toEqual({ ok: true, url: want })
  })

  it.each([
    [''],
    ['   '],
    [null],
    ['https://www.hosthampton.com/portal/abc'],     // the likeliest wrong paste
    ['https://photos.google.com/share/abc'],
    ['https://fotoshare.co.evil.example/e/abc'],     // suffix, not a subdomain
    ['https://evilfotoshare.co/e/abc'],
    ['https://fotoshare.co/'],                       // home page, not an album
    ['https://fotoshare.co'],
    ['javascript:alert(1)'],
    ['https://user:pw@fotoshare.co/e/abc'],
    ['https://fotoshare.co:8443/e/abc'],
    ['https://fotoshare.co\\e\\abc'],
  ])('refuses %j with a reason', raw => {
    const r = screenFotoshareUrl(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })
})

describe('screenOccasion', () => {
  it('collapses whitespace and newlines to one line', () => {
    expect(screenOccasion("  Emma's\n  birthday   party ")).toEqual({ ok: true, occasion: "Emma's birthday party" })
  })
  it('refuses empty and over-long', () => {
    expect(screenOccasion('  ').ok).toBe(false)
    expect(screenOccasion('x'.repeat(101)).ok).toBe(false)
  })
})

describe('defaultOccasion — a starting guess from messy production values', () => {
  it.each([
    [{ child_name: 'Emma', event_type: 'kid-party' }, "Emma's birthday party"],
    [{ child_name: 'Emma ', event_type: 'Kids Birthday Party' }, "Emma's birthday party"],
    [{ child_name: 'James', event_type: 'mobile party' }, "James' birthday party"],
    [{ child_name: 'Emma', event_type: 'Corporate Event' }, "Emma's event"],
    [{ child_name: null, event_type: 'Baby shower ' }, 'your baby shower'],
    [{ child_name: null, event_type: '40th Birthday' }, 'your 40th birthday'],
    [{ child_name: null, event_type: 'studio-rental', party_type: 'studio_rental' }, 'your event'],
    [{ child_name: null, event_type: 'kid-party' }, 'your party'],
    [{}, 'your party'],
  ])('%j → %j', (b, want) => {
    expect(defaultOccasion(b)).toBe(want)
  })
})

describe('the message', () => {
  const m = { contactName: 'Jessica Smith', occasion: "Emma's birthday party", albumUrl: 'https://fotoshare.co/e/AbC123' }

  it('is the message Adam sends by hand, word for word', () => {
    expect(PHOTO_ALBUM_SUBJECT).toBe('📷 Photo Booth Album🥳')
    expect(photoAlbumText(m)).toBe(
      'Hi Jessica ✨\n' +
      '\n' +
      "Thank you so much for choosing us to host Emma's birthday party! 🎈🎉\n" +
      '\n' +
      'Here is the link to access all of your amazing photo booth pics:\n' +
      'https://fotoshare.co/e/AbC123\n' +
      '(Please let me know if you have any issues at all!)\n' +
      '\n' +
      'If you have a quick moment, we would be so incredibly grateful if you could leave us a 5-star review on Google! 🌟🙏 It helps our small business grow so much!\n' +
      'https://search.google.com/local/writereview?placeid=ChIJv3k3iqn36IkRfD0Mkz2QWj4\n' +
      '\n' +
      'Thank you again!',
    )
  })

  it('uses the one review URL constant', () => {
    expect(photoAlbumText(m)).toContain(REVIEW_BASE_URL)
  })

  it('falls back to "there" with no contact name', () => {
    expect(photoAlbumText({ ...m, contactName: null })).toMatch(/^Hi there ✨/)
  })

  it('HTML escapes the customer- and admin-written values and links both URLs', () => {
    const html = photoAlbumEmailHtml({ ...m, contactName: '<b>Jess</b>', occasion: 'Emma & <i>Liam</i>\'s party' })
    expect(html).not.toContain('<b>Jess')
    expect(html).not.toContain('<i>Liam')
    expect(html).toContain('&lt;b&gt;Jess&lt;/b&gt;')
    expect(html).toContain('Emma &amp; &lt;i&gt;Liam&lt;/i&gt;&#39;s party')
    expect(html).toContain('href="https://fotoshare.co/e/AbC123"')
    expect(html).toContain(`href="${REVIEW_BASE_URL}"`)
  })

  it('the plain-text half is NOT escaped', () => {
    expect(photoAlbumText({ ...m, occasion: "Emma & Liam's party" })).toContain("Emma & Liam's party")
  })
})
