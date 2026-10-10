/**
 * The 1200x630 link-preview card (spec §5 step 5): the portrait invitation on the
 * left, the words on the right. Satori-only (it is never shown in a page), but it
 * follows the same rules as `InviteCanvas`: no hooks, every `div` is
 * `display: flex`, numeric line-heights, data-URI images.
 *
 * Composition is the P01 spike's, which matched `handoff/mocks/og_card_mia.jpg`:
 * 64 px side padding, a 397x560 portrait with a violet halo, a 56 px gap, a 619 px
 * column holding the kicker, the title, the date, the place, the host line and the
 * "Tap to RSVP" pill. The text and its sizes come from `ogTexts()` / `ogSizes()`
 * in `lib/evites/layout.ts`, so every string passed `screenForImage` and was fitted.
 */

import type { ReactElement } from 'react'
import { FONT_STYLE, type TemplateLayout } from '@/lib/evites/templates/types'
import type { OgSizes, OgTexts } from '@/lib/evites/layout'

export interface OgCardProps {
  template: TemplateLayout
  texts: OgTexts
  sizes: OgSizes
  /** `data:` URI of the portrait, already downscaled to the card's portrait size. */
  portraitSrc: string
  /** `data:` URI of the card background, already cropped to 1200x630. */
  backgroundSrc: string
}

export const OG_PORTRAIT_HEIGHT = 560
export const OG_PADDING_X = 64
export const OG_GAP = 56
export const OG_COLUMN = 619

export function OgCard({ template, texts, sizes, portraitSrc, backgroundSrc }: OgCardProps): ReactElement {
  const spec = template.ogCard
  const portraitWidth = Math.round((spec.portraitHeight * template.canvas.width) / template.canvas.height)
  const poppins = FONT_STYLE.poppins400
  const bungee = FONT_STYLE[spec.titleFont]
  const glow = spec.glow.stops.map((s) => `0 0 ${s.radius}px ${s.color}`).join(', ')

  const line = (key: string, text: string, size: number, extra: Record<string, string | number> = {}): ReactElement => (
    <div key={key} style={{ display: 'flex', fontSize: size, lineHeight: 1.5, whiteSpace: 'nowrap', ...extra }}>
      {text}
    </div>
  )

  const column: ReactElement[] = [
    <div
      key="kicker"
      style={{ display: 'flex', fontSize: 24, lineHeight: 1.5, letterSpacing: 0.3 * 24, wordSpacing: 0.3 * 24, opacity: 0.85 }}
    >
      {texts.kicker}
    </div>,
    <div
      key="title"
      style={{
        display: 'flex',
        fontFamily: bungee.family,
        fontWeight: bungee.weight,
        fontSize: sizes.title,
        lineHeight: 1.05,
        color: spec.titleColor,
        textShadow: glow,
        margin: '14px 0 26px 0',
      }}
    >
      {texts.title}
    </div>,
    line('date', texts.date, sizes.date),
    line('place', texts.place, sizes.place),
  ]
  if (texts.host) column.push(line('host', texts.host, sizes.host, { color: '#ffd6f6', marginTop: 6 }))
  column.push(
    <div key="cta" style={{ display: 'flex', marginTop: 24 }}>
      <div
        style={{
          display: 'flex',
          fontWeight: 600,
          fontSize: 28,
          padding: '14px 30px',
          borderRadius: 999,
          backgroundColor: spec.ctaBg,
          color: spec.ctaColor,
          boxShadow: `0 0 24px ${spec.ctaBg}`,
        }}
      >
        {spec.ctaText}
      </div>
    </div>,
  )

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: 1200,
        height: 630,
        padding: `0 ${OG_PADDING_X}px`,
        boxSizing: 'border-box',
        backgroundColor: template.backgroundColor,
        backgroundImage: `url(${backgroundSrc})`,
        backgroundSize: '1200px 630px',
        color: '#fbf9f1',
        fontFamily: poppins.family,
        fontWeight: poppins.weight,
        overflow: 'hidden',
      }}
    >
      <img
        src={portraitSrc}
        alt=""
        width={portraitWidth}
        height={spec.portraitHeight}
        style={{
          width: portraitWidth,
          height: spec.portraitHeight,
          borderRadius: spec.radius,
          boxShadow: '0 0 40px #b84dff88, 0 10px 30px #0008',
          marginRight: OG_GAP,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', width: OG_COLUMN }}>{column}</div>
    </div>
  )
}
