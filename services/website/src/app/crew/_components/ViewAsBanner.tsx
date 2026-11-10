'use client'

import { useState } from 'react'

/** The strip across the top while an admin is previewing the crew app as one member. Read-only: every write is refused server-side. */
export default function ViewAsBanner({ name }: { name: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <div
      role="status"
      style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--c-brand-navy)', color: 'var(--c-on-accent)', padding: '.5rem 1rem', display: 'flex', gap: '.75rem', alignItems: 'center', justifyContent: 'space-between', fontSize: '.9rem' }}
    >
      <span>Viewing as <strong>{name}</strong> &middot; read-only, nothing you click here changes anything.</span>
      <button
        disabled={busy}
        className="crew-btn crew-btn-ghost"
        style={{ minHeight: 32, padding: '.2rem .8rem' }}
        onClick={async () => {
          setBusy(true)
          await fetch('/api/crew/view-as/exit', { method: 'POST' }).catch(() => null)
          window.location.href = '/admin/crew/members'
        }}
      >
        Exit
      </button>
    </div>
  )
}
