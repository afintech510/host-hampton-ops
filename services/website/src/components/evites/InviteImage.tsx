/**
 * The stored portrait invitation (1085 x 1530 JPEG) as a responsive picture.
 *
 * A plain `<img>`, not `next/image`: the file lives on the Supabase storage origin, the optimizer
 * is not wanted for a picture that is already the right size, and a plain tag is what a link
 * preview and a phone both understand. `aspect-ratio` reserves the box before the bytes arrive,
 * so nothing jumps. No hooks, so it renders on the server and in the repo's node-only jest.
 *
 * The URL is already public (it is the share card's sibling in the same folder); this adds no new
 * exposure.
 */

import type { CSSProperties } from 'react'

export const INVITE_IMAGE_W = 1085
export const INVITE_IMAGE_H = 1530

interface Props {
  src: string
  alt: string
  /** CSS max-width of the picture, in px. */
  maxWidth: number
  /** True above the fold (the public page); false lets the browser defer it. */
  eager?: boolean
  className?: string
  style?: CSSProperties
}

export default function InviteImage({ src, alt, maxWidth, eager = false, className, style }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={INVITE_IMAGE_W}
      height={INVITE_IMAGE_H}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      data-invite-image=""
      className={className}
      style={{
        display: 'block',
        width: '100%',
        maxWidth,
        height: 'auto',
        aspectRatio: `${INVITE_IMAGE_W} / ${INVITE_IMAGE_H}`,
        margin: '0 auto',
        ...style,
      }}
    />
  )
}
