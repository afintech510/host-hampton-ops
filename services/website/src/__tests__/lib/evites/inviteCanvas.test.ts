import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InviteCanvas, type InviteCanvasProps } from '@/components/evites/InviteCanvas'
import { OgCard } from '@/components/evites/OgCard'
import { inviteFacts } from '@/lib/evites/facts'
import { computeSizes, ogSizes, ogTexts } from '@/lib/evites/layout'
import { loadTemplateAssets, ogBackgroundUri } from '@/lib/evites/assets'
import { GLOW_TEMPLATE } from '@/lib/evites/templates/glow'
import { PLAIN_TEMPLATE } from '@/lib/evites/templates/plain'
import type { TemplateLayout } from '@/lib/evites/templates/types'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, THEME_ROWS } from '../../helpers/eviteFixtures'

/**
 * `InviteCanvas` smoke tests. The repo's jest runs in a node environment with no
 * jsdom, so this is the React DOM SERVER renderer (the same tree a page would
 * hydrate) read as markup, rather than React Testing Library.
 */

const factsFor = (booking: Record<string, unknown> = {}, evite: Record<string, unknown> = {}) =>
  inviteFacts(bookingRow(booking) as never, evitesRow(evite) as never, LINE_ITEM_ROWS, THEME_ROWS, 'live')

function web(facts = factsFor(), template: TemplateLayout = GLOW_TEMPLATE): string {
  const props: InviteCanvasProps = { template, facts, sizes: computeSizes(template, facts), mode: 'web' }
  return renderToStaticMarkup(createElement(InviteCanvas, props))
}

function satoriTree(facts = factsFor(), template: TemplateLayout = GLOW_TEMPLATE): ReactElement {
  return InviteCanvas({ template, facts, sizes: computeSizes(template, facts), mode: 'satori', assets: loadTemplateAssets(template) })
}

/** Every opening tag of `tag` in the markup. */
const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? []

describe('InviteCanvas - web mode, with a name', () => {
  const html = web()

  it('draws the honoree, the age, the date, the place and the host line', () => {
    expect(html).toContain('>MIA<')
    expect(html).toContain('>7TH<')
    expect(html).toContain('>Birthday!<')
    expect(html).toContain('>GLOW<')
    expect(html).toContain('>PARTY<')
    expect(html).toContain(">YOU&#x27;RE INVITED TO A<")
    expect(html).toContain('SATURDAY, NOVEMBER 14')
    expect(html).toContain('Host Hampton')
    expect(html).toContain('Any questions? Ask Allie')
  })

  it('does NOT draw the star when there is a name, and draws the icon strip', () => {
    expect(html).not.toContain('/evites/glow/star.png')
    expect(html).toContain('src="/evites/glow/icon-strip.png"')
    expect(html).not.toContain('BIRTHDAY STAR')
  })

  it('image src is a public path in web mode (the page webp, no data URIs)', () => {
    expect(html).toContain('src="/evites/glow/background.webp"')
    expect(html).not.toContain('background.jpg')
    expect(html).not.toContain('data:')
  })

  it('every div is display:flex, and every text div carries a numeric line-height', () => {
    const divs = tags(html, 'div')
    expect(divs.length).toBeGreaterThanOrEqual(12)
    for (const d of divs) expect(d).toMatch(/display:flex/)
    expect(tags(html, 'img')).toHaveLength(4) // background, two squiggles, the icon strip
    const textDivs = divs.filter((d) => /font-size:/.test(d))
    expect(textDivs.length).toBeGreaterThanOrEqual(9)
    for (const d of textDivs) expect(d).toMatch(/line-height:\d+(\.\d+)?[;"]/)
  })

  it('gradient text is ONE background-clip layer plus drop-shadow filters from the glow stops', () => {
    const glow = tags(html, 'div').filter((d) => d.includes('background-clip:text'))
    expect(glow).toHaveLength(1)
    expect(glow[0]).toContain('filter:drop-shadow(0 0 10px #ff3df2) drop-shadow(0 0 26px #8a3dff)')
    expect(glow[0]).toContain('linear-gradient(90deg, #ff3df2, #ffd23f 35%, #3dd9ff 70%, #b84dff)')
    expect(glow[0]).toContain('color:transparent')
    expect(glow[0]).not.toContain('text-shadow')
  })

  it('solid text uses stacked text-shadow from its stops; shapes use stacked box-shadow', () => {
    expect(html).toContain('text-shadow:0 0 6px #ffe100, 0 0 18px #ffe100, 0 0 40px #ffe100') // the honoree
    expect(html).toContain('text-shadow:0 0 6px #ff3355, 0 0 18px #ff3355, 0 0 40px #ff3355') // PARTY
    expect(html).toContain('box-shadow:0 0 8px #ff2bd6, 0 0 22px #a24bff, 0 0 40px #5b6bff') // the bar
    expect(html).toContain('box-shadow:0 0 10px #ff3df2, 0 0 24px #c92bff') // a bracket
  })

  it('web mode leaves letter-spacing to the browser: no word-spacing and no left shift', () => {
    expect(html).toContain('letter-spacing:9.9px') // 0.33em of 30px
    expect(html).not.toContain('word-spacing')
    expect(html).not.toMatch(/left:-\d/)
  })

  it('exposes the invitation to assistive tech as one labelled image', () => {
    expect(html).toContain('role="img"')
    expect(html).toContain(`aria-label="Mia&#x27;s Glow Party"`)
  })
})

describe('InviteCanvas - web mode, with no name', () => {
  const html = web(factsFor({ child_name: null }))

  it('shows BIRTHDAY STAR and the star icon IMAGE (never an emoji glyph)', () => {
    expect(html).toContain('>BIRTHDAY STAR<')
    expect(html).toContain('src="/evites/glow/star.png"')
    for (const cp of [0x2b50, 0x1f31f, 0x1f4ab]) expect(html).not.toContain(String.fromCodePoint(cp))
    expect(html).not.toContain('>MIA<')
  })

  it('the shrunken name is centred in the same 165 px box a name fills at full size', () => {
    const row = tags(html, 'div').find((d) => d.includes('gap:24px')) as string
    expect(row).toBeDefined()
    expect(row).toContain('height:165px')
    expect(row).toContain('align-items:center')
    // and that is the row a short name sits in too
    const mia = tags(web(), 'div').find((d) => d.includes('gap:24px')) as string
    expect(mia).toContain('height:165px')
    expect(mia).toContain('align-items:center')
  })
})

describe('InviteCanvas - slots that come and go', () => {
  it('no age: no 7TH and no "Birthday!"', () => {
    const html = web(factsFor({ child_age: null }))
    expect(html).not.toContain('Birthday!')
    expect(html).not.toContain('>7TH<')
  })

  it('host contact switched off: no host line', () => {
    expect(web(factsFor({}, { show_host_contact: false }))).not.toContain('Any questions?')
  })

  it('plain: no icon strip, the rest unchanged', () => {
    const html = web(factsFor({ package_type: 'Mystery' }), PLAIN_TEMPLATE)
    expect(html).not.toContain('icon-strip.png')
    expect(html).toContain('>MIA<')
  })

  it('a shrunken slot keeps the box it would fill at nominal size (GLOW with a long override)', () => {
    const html = web(factsFor({}, { theme_word: 'ABCDEFGHIJKL' }))
    const box = tags(html, 'div').find((d) => d.includes('top:201px')) as string
    expect(box).toContain('height:250px')
    const text = tags(html, 'div').find((d) => d.includes('background-clip:text')) as string
    expect(text).not.toContain('font-size:250px')
  })
})

describe('InviteCanvas - satori mode', () => {
  it('draws every image from a data URI, and the 1x JPEG background', () => {
    const html = renderToStaticMarkup(satoriTree())
    const srcs = Array.from(html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)).map((m) => m[1])
    expect(srcs).toHaveLength(4)
    for (const s of srcs) expect(s.startsWith('data:image/')).toBe(true)
    expect(srcs[0].startsWith('data:image/jpeg;base64,')).toBe(true) // the background
    expect(html).not.toContain('/evites/')
  })

  it('applies the letter-spacing fix: word-spacing = letter-spacing, box shifted left by half', () => {
    const html = renderToStaticMarkup(satoriTree())
    expect(html).toContain('letter-spacing:9.9px;word-spacing:9.9px')
    expect(html).toContain('left:-4.95px')
    expect(html).toContain('letter-spacing:1.44px;word-spacing:1.44px') // date: 0.04em of 36px
  })

  it('uses the same gradient + drop-shadow glow as the page', () => {
    const html = renderToStaticMarkup(satoriTree())
    expect(html).toContain('filter:drop-shadow(0 0 10px #ff3df2) drop-shadow(0 0 26px #8a3dff)')
    expect(html).toContain('background-clip:text')
  })

  it('THROWS rather than let a bare /evites path reach Satori (the one way it could fetch)', () => {
    const facts = factsFor()
    expect(() => InviteCanvas({ template: GLOW_TEMPLATE, facts, sizes: computeSizes(GLOW_TEMPLATE, facts), mode: 'satori', assets: {} })).toThrow(/no data URI/)
    expect(() => InviteCanvas({ template: GLOW_TEMPLATE, facts, sizes: {}, mode: 'satori' })).toThrow(/no data URI/)
  })

  it('can be called as a plain function (no hooks): same markup as rendering the element', () => {
    const facts = factsFor()
    const props: InviteCanvasProps = { template: GLOW_TEMPLATE, facts, sizes: computeSizes(GLOW_TEMPLATE, facts), mode: 'web' }
    expect(renderToStaticMarkup(InviteCanvas(props))).toBe(renderToStaticMarkup(createElement(InviteCanvas, props)))
  })
})

describe('OgCard', () => {
  it('draws the title, date, place, host line and the Tap to RSVP pill with every div display:flex', async () => {
    const facts = factsFor()
    const texts = ogTexts(facts)
    const el = OgCard({
      template: GLOW_TEMPLATE,
      texts,
      sizes: ogSizes(texts, GLOW_TEMPLATE),
      portraitSrc: 'data:image/jpeg;base64,AAAA',
      backgroundSrc: await ogBackgroundUri(GLOW_TEMPLATE),
    })
    const html = renderToStaticMarkup(el)
    expect(html).toContain(`MIA&#x27;S GLOW PARTY`)
    expect(html).toContain('Tap to RSVP')
    expect(html).toContain('Questions? Ask Allie')
    expect(html).toContain('Host Hampton, Speonk')
    for (const d of tags(html, 'div')) expect(d).toMatch(/display:flex/)
    expect(tags(html, 'img')).toHaveLength(1)
  })
})
