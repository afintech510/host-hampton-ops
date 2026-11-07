'use client'

/**
 * A "Sort" button for the top right of a screen's heading row, opening a short list of
 * orders with a check on the one in use. Closes on a pick, an outside tap or Escape.
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Check } from 'lucide-react'
import type { SortOption } from '@/lib/crewAppSort'

export default function SortMenu<K extends string>({ options, value, onChange }: { options: SortOption<K>[]; value: K; onChange: (k: K) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="relative" ref={ref} data-sort-menu>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Sort"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 h-8 rounded-full border border-hampton-navy/15 bg-white px-3 text-xs font-semibold text-hampton-navy active:bg-hampton-navy/10"
      >
        <ArrowUpDown size={14} aria-hidden="true" /> Sort
      </button>
      {open && (
        <ul role="listbox" aria-label="Sort by" className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-hampton-navy/10 bg-white py-1 shadow-lg">
          {options.map(o => (
            <li key={o.key} role="option" aria-selected={o.key === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.key)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-hampton-navy hover:bg-[#F6F1EB]"
              >
                {o.label}
                {o.key === value && <Check size={15} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
