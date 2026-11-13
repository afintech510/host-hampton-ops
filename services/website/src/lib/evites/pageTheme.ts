/**
 * The look of the PUBLIC invitation page around the picture (migration 097): a colour and an optional
 * motion, both chosen by the host. Pure; no imports.
 *
 *   PAGE_COLORS         the palette, keyed. Every colour is dark enough for the page's white text.
 *   PAGE_MOTIONS        'none' | 'sparkle' | 'drift'
 *   pageColorOf(v)      a stored value -> a known key (unknown / null -> DEFAULT_PAGE_COLOR)
 *   pageMotionOf(v)     a stored value -> a known motion (unknown / null -> 'none')
 *   pageThemeCss(c, m)  the CSS that restyles `.hh-inv-root`; a STATIC string built only from this
 *                       file's own constants, never from a stored value, so nothing a host types can
 *                       reach it.
 *
 * Motion respects `prefers-reduced-motion`: with it set, the page is still and the sparkle layer is
 * hidden. The default colour is the purple the page has always been, so no existing invitation changes.
 */

export const DEFAULT_PAGE_COLOR = 'midnight'

export interface PageColor {
  key: string
  label: string
  /** CSS background for the whole page. */
  bg: string
  /** The glow around the picture. */
  glow: string
  /** The swatch the picker shows. */
  swatch: string
}

export const PAGE_COLORS: readonly PageColor[] = [
  { key: 'midnight', label: 'Midnight purple', bg: '#1b0630', glow: 'rgba(138,61,255,.45)', swatch: '#1b0630' },
  { key: 'navy', label: 'Navy', bg: '#0e1f3d', glow: 'rgba(96,142,230,.40)', swatch: '#0e1f3d' },
  { key: 'forest', label: 'Forest green', bg: '#0f2e1d', glow: 'rgba(86,176,112,.38)', swatch: '#0f2e1d' },
  { key: 'plum', label: 'Plum', bg: '#3a0f33', glow: 'rgba(214,92,190,.40)', swatch: '#3a0f33' },
  { key: 'rose', label: 'Dusty rose', bg: '#5a2433', glow: 'rgba(240,140,160,.40)', swatch: '#5a2433' },
  { key: 'teal', label: 'Teal', bg: '#0b3b3f', glow: 'rgba(70,200,200,.38)', swatch: '#0b3b3f' },
  { key: 'charcoal', label: 'Charcoal', bg: '#1d1f24', glow: 'rgba(200,200,215,.28)', swatch: '#1d1f24' },
] as const

export const PAGE_MOTIONS = ['none', 'sparkle', 'drift'] as const
export type PageMotion = (typeof PAGE_MOTIONS)[number]

export const PAGE_MOTION_LABELS: Record<PageMotion, string> = {
  none: 'Still',
  sparkle: 'Sparkle',
  drift: 'Slow shimmer',
}

export function isPageColor(v: unknown): v is string {
  return typeof v === 'string' && PAGE_COLORS.some((c) => c.key === v)
}

export function isPageMotion(v: unknown): v is PageMotion {
  return typeof v === 'string' && (PAGE_MOTIONS as readonly string[]).includes(v)
}

export function pageColorOf(v: unknown): PageColor {
  return PAGE_COLORS.find((c) => c.key === v) ?? (PAGE_COLORS.find((c) => c.key === DEFAULT_PAGE_COLOR) as PageColor)
}

export function pageMotionOf(v: unknown): PageMotion {
  return isPageMotion(v) ? v : 'none'
}

/**
 * Glitter for the sparkle motion: three layers of specks at fixed positions (a small seeded generator, so the
 * CSS is the same on every render and every server). Layer 1 is many small white specks, layer 2 fewer gold
 * ones with a halo, layer 3 a few big bright flares. Each layer twinkles on its own beat and drifts slowly down.
 */
function specks(count: number, seed: number, sizes: readonly number[], colors: readonly string[], halo: number): string {
  let x = seed
  const next = (): number => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const size = sizes[Math.floor(next() * sizes.length)]
    const color = colors[Math.floor(next() * colors.length)]
    const left = (next() * 100).toFixed(1)
    const top = (next() * 100).toFixed(1)
    out.push(`radial-gradient(${size + halo}px ${size + halo}px at ${left}% ${top}%,${color} 0,${color} ${Math.round((size / (size + halo)) * 45)}%,transparent 70%)`)
  }
  return out.join(',')
}

const SPARKLE_SMALL = specks(46, 7, [3, 4, 5], ['#ffffff', '#fff6d6'], 3)
const SPARKLE_GOLD = specks(24, 23, [5, 6, 8], ['#ffe9a3', '#ffd76a', '#fff'], 8)
const SPARKLE_FLARE = specks(10, 91, [9, 11, 13], ['#ffffff', '#fff2b8'], 16)

/** The CSS for one colour and motion. Static strings only. */
export function pageThemeCss(colorKey: unknown, motion: unknown): string {
  const c = pageColorOf(colorKey)
  const m = pageMotionOf(motion)
  const parts = [
    `.hh-inv-root{background:${c.bg}}`,
    `.hh-inv-frame,.hh-inv-img{box-shadow:0 0 28px ${c.glow}}`,
  ]
  if (m === 'sparkle') {
    parts.push(
      `.hh-inv-fx{position:fixed;inset:-10% 0 0 0;pointer-events:none;z-index:0;background:${SPARKLE_SMALL};background-repeat:no-repeat;animation:hh-twinkle-a 1.9s ease-in-out infinite alternate,hh-fall 26s linear infinite}`,
      `.hh-inv-fx::before{content:"";position:absolute;inset:0;background:${SPARKLE_GOLD};background-repeat:no-repeat;animation:hh-twinkle-b 2.7s ease-in-out infinite alternate,hh-fall 34s linear infinite}`,
      `.hh-inv-fx::after{content:"";position:absolute;inset:0;background:${SPARKLE_FLARE};background-repeat:no-repeat;filter:drop-shadow(0 0 6px rgba(255,240,180,.9));animation:hh-twinkle-c 3.6s ease-in-out infinite alternate,hh-fall 44s linear infinite}`,
      '@keyframes hh-twinkle-a{0%{opacity:.25}35%{opacity:1}100%{opacity:.45}}',
      '@keyframes hh-twinkle-b{0%{opacity:1}50%{opacity:.2}100%{opacity:.9}}',
      '@keyframes hh-twinkle-c{0%{opacity:.1;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}100%{opacity:.2;transform:scale(.9)}}',
      '@keyframes hh-fall{from{background-position:0 0}to{background-position:0 110vh}}',
    )
  } else if (m === 'drift') {
    parts.push(
      `.hh-inv-fx{position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(60% 40% at 20% 20%,${c.glow},transparent 70%),radial-gradient(50% 40% at 80% 75%,${c.glow},transparent 70%);animation:hh-drift 14s ease-in-out infinite alternate}`,
      '@keyframes hh-drift{0%{opacity:.25;transform:translate3d(-2%,-1%,0) scale(1)}100%{opacity:.6;transform:translate3d(2%,2%,0) scale(1.08)}}',
    )
  }
  if (m !== 'none') {
    parts.push('.hh-inv-root>:not(.hh-inv-fx){position:relative;z-index:1}', '@media (prefers-reduced-motion:reduce){.hh-inv-fx{display:none}}')
  }
  return parts.join('\n')
}
