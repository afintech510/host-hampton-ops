'use client'

import { useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ImageGalleryProps {
  images: { url: string; name: string; is_primary: boolean }[]
  title: string
}

export default function ImageGallery({ images, title }: ImageGalleryProps) {
  const [current, setCurrent] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  function goTo(idx: number) {
    setCurrent(idx)
    scrollRef.current?.children[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }

  function prev() { goTo(current > 0 ? current - 1 : images.length - 1) }
  function next() { goTo(current < images.length - 1 ? current + 1 : 0) }

  return (
    <div className="rounded-2xl overflow-hidden mb-6 bg-white relative group">
      {/* Main image */}
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory overflow-x-auto scrollbar-hide"
        onScroll={(e) => {
          const el = e.currentTarget
          const idx = Math.round(el.scrollLeft / el.clientWidth)
          if (idx !== current && idx >= 0 && idx < images.length) setCurrent(idx)
        }}
      >
        {images.map((img, i) => (
          <div key={i} className="w-full flex-shrink-0 snap-center">
            <img
              src={img.url}
              alt={`${title} — ${img.name || `Photo ${i + 1}`}`}
              className="w-full object-contain"
            />
          </div>
        ))}
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-5 h-5 text-hampton-navy" />
          </button>
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
            aria-label="Next image"
          >
            <ChevronRight className="w-5 h-5 text-hampton-navy" />
          </button>

          {/* Dot indicators */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === current ? 'bg-white w-5' : 'bg-white/50 hover:bg-white/80'
                }`}
                aria-label={`Go to image ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
