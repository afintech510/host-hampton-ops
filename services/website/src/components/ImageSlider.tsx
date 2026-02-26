'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ImageSliderProps {
  images: string[]
  alt: string
  aspectRatio?: string
  autoPlayMs?: number
  className?: string
}

export default function ImageSlider({
  images,
  alt,
  aspectRatio = 'aspect-[3/2]',
  autoPlayMs = 4000,
  className = '',
}: ImageSliderProps) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const multi = images.length > 1

  // Reset to first image when images change (theme switch)
  useEffect(() => setCurrent(0), [images])

  const next = useCallback(
    () => setCurrent(i => (i + 1) % images.length),
    [images.length],
  )
  const prev = useCallback(
    () => setCurrent(i => (i - 1 + images.length) % images.length),
    [images.length],
  )

  // Touch swipe
  const touchX = useRef<number | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX
    setPaused(true)
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null) return
    const delta = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(delta) > 40) {
      delta < 0 ? next() : prev()
    }
    touchX.current = null
  }

  // Auto-play
  useEffect(() => {
    if (!multi || paused) return
    // Respect reduced motion preference
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(next, autoPlayMs)
    return () => clearInterval(id)
  }, [multi, paused, next, autoPlayMs])

  return (
    <div
      className={`relative overflow-hidden ${aspectRatio} ${className}`}
      onMouseEnter={() => multi && setPaused(true)}
      onMouseLeave={() => multi && setPaused(false)}
      onTouchStart={multi ? onTouchStart : undefined}
      onTouchEnd={multi ? onTouchEnd : undefined}
    >
      {images.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt={`${alt} ${i + 1}`}
          fill
          className={`object-cover transition-opacity duration-700 ease-in-out ${
            i === current ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}

      {multi && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev() }}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors z-10"
          >
            <ChevronLeft size={20} className="text-white" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next() }}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors z-10"
          >
            <ChevronRight size={20} className="text-white" />
          </button>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setCurrent(i) }}
                aria-label={`Go to image ${i + 1}`}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  i === current ? 'bg-white scale-110' : 'bg-white/50 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
