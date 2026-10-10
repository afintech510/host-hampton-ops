/**
 * The invitation, drawn from a template layout and the invite facts
 * (spec §0.6, §2, §6): ONE component for the page (`mode: 'web'`) and for Satori
 * (`mode: 'satori'`). No hooks, no state, no effects, so it can be rendered by
 * React DOM and also called as a plain function:
 *
 *     satori(InviteCanvas({ template, facts, sizes, mode: 'satori', assets }), ...)
 *
 * Rules this file follows because Satori needs them (and they cost nothing in a
 * browser):
 *   - every `div` is `display: flex`, whatever it holds;
 *   - every text slot has an explicit numeric `lineHeight`;
 *   - the helpers below are called as functions, never used as `<Components />`;
 *   - an image `src` is a public path in web mode and a `data:` URI in satori
 *     mode. A satori image with no data URI THROWS: a bare `/evites/...` path
 *     is the one input that could ever make Satori reach for the network.
 *
 * Glow (spec §6 v1.1): a gradient-filled slot is ONE `backgroundClip: 'text'`
 * layer plus `filter: drop-shadow(stop) drop-shadow(stop)...`, in both modes; a
 * solid-colour slot uses stacked `text-shadow`; a shape uses stacked `box-shadow`.
 *
 * Letter-spacing (spec §6 v1.1, from the P01 spike): Chrome counts the trailing
 * letter-space in a centred line, Satori does not, and Satori skips the space
 * after a space. In satori mode a spaced slot therefore sets
 * `wordSpacing = letterSpacing` and shifts its box left by half of it. Web mode
 * needs neither and must not have them (word-spacing would ADD to a space).
 *
 * A shrunken slot is centred vertically in the box it would have filled at its
 * nominal size (spec changelog B5), so a long name does not open a bigger gap
 * above the age line than "MIA" does.
 *
 * Client-safe: imports only types and the pure helpers in `templates/`.
 */

import type { CSSProperties, ReactElement } from 'react'
import type { InviteFacts } from '@/lib/evites/facts'
import { showWhenOk, slotText } from '@/lib/evites/templates/slotText'
import {
  FONT_STYLE,
  type Glow,
  type ImageLayer,
  type ImageSlot,
  type InviteAssets,
  type InviteSizes,
  type RowSlot,
  type ShapeLayer,
  type TemplateLayout,
  type TextSlot,
} from '@/lib/evites/templates/types'

export interface InviteCanvasProps {
  template: TemplateLayout
  facts: InviteFacts
  /** From `computeSizes()` (server). A slot missing from it draws at its nominal size. */
  sizes: InviteSizes
  mode: 'web' | 'satori'
  /** Public path -> data URI. Required in satori mode. */
  assets?: InviteAssets
}

interface Ctx {
  W: number
  mode: 'web' | 'satori'
  facts: InviteFacts
  sizes: InviteSizes
  src: (publicPath: string) => string
}

/** `0 0 6px #fff, 0 0 18px #fff`. */
function shadowOf(glow: Glow): string {
  return glow.stops.map((s) => `0 0 ${s.radius}px ${s.color}`).join(', ')
}

/** `drop-shadow(0 0 10px #f0f) drop-shadow(0 0 26px #80f)`. */
function dropShadowOf(glow: Glow): string {
  return glow.stops.map((s) => `drop-shadow(0 0 ${s.radius}px ${s.color})`).join(' ')
}

function textStyle(slot: TextSlot, size: number, mode: 'web' | 'satori'): CSSProperties {
  const font = FONT_STYLE[slot.font]
  const style: CSSProperties = {
    display: 'flex',
    fontFamily: font.family,
    fontWeight: font.weight,
    fontSize: size,
    lineHeight: slot.lineHeight,
    whiteSpace: 'nowrap',
  }
  if (slot.fill) {
    style.color = 'transparent'
    style.backgroundImage = `linear-gradient(${slot.fill.angleDeg}deg, ${slot.fill.gradient.join(', ')})`
    style.backgroundClip = 'text'
    if (mode === 'web') (style as Record<string, unknown>).WebkitBackgroundClip = 'text'
    if (slot.glow) style.filter = dropShadowOf(slot.glow)
  } else {
    style.color = slot.color ?? '#ffffff'
    if (slot.glow) style.textShadow = shadowOf(slot.glow)
  }
  return style
}

/** Letter-spacing in px for a slot at `size`, and the satori-only corrections that make it centre like Chrome. */
function spacingOf(slot: TextSlot, size: number, mode: 'web' | 'satori'): { style: CSSProperties; shift: number } {
  const ls = (slot.letterSpacingEm ?? 0) * size
  if (!ls) return { style: {}, shift: 0 }
  if (mode === 'satori') return { style: { letterSpacing: ls, wordSpacing: ls }, shift: -ls / 2 }
  return { style: { letterSpacing: ls }, shift: 0 }
}

function image(ctx: Ctx, publicPath: string, w: number, h: number, extra: CSSProperties, key?: string): ReactElement {
  return (
    <img
      key={key}
      src={ctx.src(publicPath)}
      alt=""
      width={Math.round(w)}
      height={Math.round(h)}
      style={{ width: w, height: h, ...extra }}
    />
  )
}

function shapeLayer(layer: ShapeLayer): ReactElement {
  const style: CSSProperties = {
    display: 'flex',
    position: 'absolute',
    left: layer.left,
    top: layer.top,
    width: layer.width,
    height: layer.height,
    borderRadius: layer.radius,
  }
  if (layer.fill) {
    if (layer.fill.includes('gradient')) style.backgroundImage = layer.fill
    else style.backgroundColor = layer.fill
  }
  if (layer.border) {
    const b = layer.border
    style.boxSizing = 'border-box'
    style.borderStyle = 'solid'
    style.borderColor = b.color
    style.borderTopWidth = b.sides.includes('t') ? b.width : 0
    style.borderRightWidth = b.sides.includes('r') ? b.width : 0
    style.borderBottomWidth = b.sides.includes('b') ? b.width : 0
    style.borderLeftWidth = b.sides.includes('l') ? b.width : 0
  }
  if (layer.glow) style.boxShadow = shadowOf(layer.glow)
  return <div key={layer.id} style={style} />
}

function imageLayer(ctx: Ctx, layer: ImageLayer): ReactElement {
  const w = layer.height * layer.aspect
  return image(
    ctx,
    layer.src,
    w,
    layer.height,
    { position: 'absolute', left: layer.left, top: layer.top, transform: `rotate(${layer.rotateDeg ?? 0}deg)` },
    layer.id,
  )
}

function textSlot(ctx: Ctx, slot: TextSlot): ReactElement | null {
  if (!showWhenOk(slot.showWhen, ctx.facts)) return null
  const text = slotText(slot, ctx.facts)
  if (text === '') return null
  const size = ctx.sizes[slot.id] ?? slot.size
  const sp = spacingOf(slot, size, ctx.mode)
  return (
    <div
      key={slot.id}
      style={{
        display: 'flex',
        position: 'absolute',
        left: sp.shift,
        top: slot.top,
        width: ctx.W,
        // The box this slot fills at its nominal size: a shrunken one is centred in it.
        height: slot.size * slot.lineHeight,
        alignItems: 'center',
      }}
    >
      <div style={{ ...textStyle(slot, size, ctx.mode), ...sp.style, width: ctx.W, justifyContent: 'center' }}>{text}</div>
    </div>
  )
}

function imageSlot(ctx: Ctx, slot: ImageSlot): ReactElement | null {
  if (!showWhenOk(slot.showWhen, ctx.facts)) return null
  const w = slot.width
  return (
    <div key={slot.id} style={{ display: 'flex', position: 'absolute', left: 0, top: slot.top, width: ctx.W, justifyContent: 'center' }}>
      {image(ctx, slot.src, w, w / slot.aspect, {})}
    </div>
  )
}

function rowSlot(ctx: Ctx, row: RowSlot): ReactElement | null {
  if (!showWhenOk(row.showWhen, ctx.facts)) return null
  const kids: ReactElement[] = []
  for (const child of row.children) {
    if (!showWhenOk(child.showWhen, ctx.facts)) continue
    if (child.type === 'image') {
      const w = ctx.sizes[child.id] ?? child.width
      kids.push(<div key={child.id} style={{ display: 'flex' }}>{image(ctx, child.src, w, w / child.aspect, {})}</div>)
      continue
    }
    const text = slotText(child, ctx.facts)
    if (text === '') continue
    const size = ctx.sizes[child.id] ?? child.size
    kids.push(
      <div key={child.id} style={textStyle(child, size, ctx.mode)}>
        {text}
      </div>,
    )
  }
  if (kids.length === 0) return null
  return (
    <div
      key={row.id}
      style={{
        display: 'flex',
        position: 'absolute',
        left: 0,
        top: row.top,
        width: ctx.W,
        ...(row.boxHeight !== undefined ? { height: row.boxHeight } : {}),
        justifyContent: 'center',
        alignItems: row.align,
        gap: row.gap,
        whiteSpace: 'nowrap',
      }}
    >
      {kids}
    </div>
  )
}

export function InviteCanvas(props: InviteCanvasProps): ReactElement {
  const { template, facts, sizes, mode, assets } = props
  const W = template.canvas.width
  const H = template.canvas.height

  const src = (publicPath: string): string => {
    if (mode === 'web') return publicPath
    const uri = assets?.[publicPath]
    if (!uri || !uri.startsWith('data:')) {
      throw new Error(`InviteCanvas: no data URI for "${publicPath}" in satori mode`)
    }
    return uri
  }
  const ctx: Ctx = { W, mode, facts, sizes, src }

  const children: Array<ReactElement | null> = [
    <img
      key="background"
      src={src(mode === 'web' ? template.background.web : template.background.raster)}
      alt=""
      width={W}
      height={H}
      style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}
    />,
  ]
  for (const layer of template.layers) children.push(layer.type === 'shape' ? shapeLayer(layer) : imageLayer(ctx, layer))
  for (const slot of template.slots) {
    if (slot.type === 'text') children.push(textSlot(ctx, slot))
    else if (slot.type === 'image') children.push(imageSlot(ctx, slot))
    else children.push(rowSlot(ctx, slot))
  }

  return (
    <div
      {...(mode === 'web' ? { role: 'img', 'aria-label': facts.title } : {})}
      style={{
        position: 'relative',
        display: 'flex',
        width: W,
        height: H,
        backgroundColor: template.backgroundColor,
        overflow: 'hidden',
      }}
    >
      {children.filter((c): c is ReactElement => c !== null)}
    </div>
  )
}
