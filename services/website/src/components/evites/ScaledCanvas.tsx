'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The 1085 x 1530 web `InviteCanvas`, scaled to fit whatever width it is given.
 *
 * Why this is a client component and not CSS. The first version scaled with
 * `transform: scale(tan(atan2(100cqw, 1085px)))` behind an `@supports` that tested the
 * same expression with `1px` in place of `100cqw`. An engine that passes that test but
 * cannot resolve a container-query length inside `atan2()` makes the declaration INVALID
 * AT COMPUTED-VALUE TIME, and the property falls back to `none`: the canvas is drawn at
 * full size, clipped to the frame, so a phone shows only the top-left third of it (the
 * host page) or a patch of the empty background (the public page). `@supports` cannot see
 * that. A measured width and a plain `scale(n)` can.
 *
 * The frame keeps the canvas's aspect ratio in CSS, so the box is the right height before
 * any script runs (no layout jump), and `initialScale` is a width-appropriate guess for
 * the server render. A `ResizeObserver` corrects it to the real width before paint. The
 * canvas itself is a server-rendered child: no template or facts are shipped to the browser.
 */

const CANVAS_W = 1085
const CANVAS_H = 1530

interface Props {
  /** Class on the frame (`hh-inv-frame`, `hh-hi-frame`). */
  frameClassName: string
  /** Class on the scaled layer (`hh-inv-canvas`, `hh-hi-canvas`). */
  canvasClassName: string
  /** The scale used until the real width is measured (server render, and no-JS). */
  initialScale: number
  children: ReactNode
}

// A layout effect where there is a DOM, a plain effect on the server (React 18 warns otherwise).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export default function ScaledCanvas({ frameClassName, canvasClassName, initialScale, children }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(initialScale)

  useIsoLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    // The LAYOUT width, not `getBoundingClientRect()`: that one includes CSS transforms, so a frame
    // inside a tilted or animating card (the /invitations look-book) measured short and the canvas
    // was drawn too small for its box. `contentRect` is fractional; `offsetWidth` is the fallback.
    const measure = (w: number = el.offsetWidth) => {
      if (w > 0) setScale(w / CANVAS_W)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => measure()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const ro = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={frame} className={frameClassName}>
      <div className={canvasClassName} style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
