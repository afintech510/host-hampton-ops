'use client'

import { useEffect, useRef } from 'react'

/**
 * A modal dialog on the platform's own `<dialog>`: focus is trapped inside,
 * Escape and the backdrop close it, and it is announced as a dialog. It slides
 * up from the bottom on a phone (see `.crew-modal` in the layout).
 */
export default function Modal(props: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { open, onClose } = props

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="crew-modal"
      aria-labelledby="crew-modal-title"
      onClose={onClose}
      onClick={e => { if (e.target === ref.current) onClose() }}
    >
      {open && (
        <div className="crew-modal-body">
          <h2 id="crew-modal-title" style={{ marginTop: 0 }}>{props.title}</h2>
          {props.children}
        </div>
      )}
    </dialog>
  )
}
