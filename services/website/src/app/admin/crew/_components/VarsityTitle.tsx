'use client'

import { TENANT } from '@/tenant'

/**
 * The "PARTY CREW" wordmark in the crew app's own lettering: the collegiate slab (Graduate,
 * loaded in app/admin/crew/layout.tsx as --crew-font-varsity), the brand navy, and the
 * ring of dusty blue around it (the same 16 two-pixel offsets, no blur, as the staff app).
 */

const RING = [
  [2, 0], [-2, 0], [0, 2], [0, -2], [1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2],
]
  .map(([x, y]) => `${x}px ${y}px 0 ${TENANT.brand.colors.blue}`)
  .join(',')

export default function VarsityTitle({ children }: { children: string }) {
  return (
    <h1
      className="text-center leading-none"
      style={{
        fontFamily: "var(--crew-font-varsity), Impact, 'Arial Black', sans-serif",
        fontSize: '1.7rem',
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: TENANT.brand.colors.navy,
        textShadow: RING,
        padding: '0.1rem 0.2rem 0.05rem',
      }}
    >
      {children}
    </h1>
  )
}
