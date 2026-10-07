'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { GALLERY_CATEGORIES, type GalleryCategory, type GalleryPhoto } from '@/lib/gallery'

type Filter = 'all' | GalleryCategory

export default function GalleryGrid({ photos }: { photos: GalleryPhoto[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<number | null>(null)
  const shown = filter === 'all' ? photos : photos.filter(p => p.category === filter)

  const close = useCallback(() => setOpen(null), [])
  const next = useCallback(() => setOpen(i => (i === null ? i : (i + 1) % shown.length)), [shown.length])
  const prev = useCallback(() => setOpen(i => (i === null ? i : (i - 1 + shown.length) % shown.length)), [shown.length])

  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, close, next, prev])

  const touchX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return
    const delta = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(delta) > 40) (delta < 0 ? next : prev)()
    touchX.current = null
  }

  const current = open === null ? null : shown[open]

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {([{ id: 'all', label: 'All' }, ...GALLERY_CATEGORIES] as { id: Filter; label: string }[]).map(c => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            aria-pressed={filter === c.id}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              filter === c.id
                ? 'bg-hampton-navy text-white'
                : 'bg-hampton-pink/20 text-hampton-navy hover:bg-hampton-pink/40'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Masonry grid */}
      <div className="columns-2 md:columns-3 lg:columns-4 gap-3 [&>*]:mb-3">
        {shown.map((p, i) => (
          <button
            key={p.src}
            onClick={() => setOpen(i)}
            className="block w-full break-inside-avoid rounded-2xl overflow-hidden shadow-md group focus:outline-none focus-visible:ring-2 focus-visible:ring-hampton-mauve"
            aria-label={`Enlarge: ${p.alt}`}
          >
            <Image
              src={p.src}
              alt={p.alt}
              width={p.w}
              height={p.h}
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="w-full h-auto transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={current.alt}
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
          onClick={close}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <button onClick={close} aria-label="Close" className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10">
            <X size={30} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); prev() }}
            aria-label="Previous photo"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center z-10"
          >
            <ChevronLeft size={26} className="text-white" />
          </button>
          <figure className="relative w-[92vw] h-[80vh] max-w-5xl" onClick={e => e.stopPropagation()}>
            <Image src={current.src} alt={current.alt} fill sizes="92vw" className="object-contain" priority />
            <figcaption className="absolute -bottom-9 inset-x-0 text-center text-white/80 text-sm">{current.alt}</figcaption>
          </figure>
          <button
            onClick={e => { e.stopPropagation(); next() }}
            aria-label="Next photo"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center z-10"
          >
            <ChevronRight size={26} className="text-white" />
          </button>
        </div>
      )}
    </>
  )
}
