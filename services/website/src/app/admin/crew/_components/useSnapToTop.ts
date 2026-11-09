'use client'

import { useLayoutEffect, type RefObject } from 'react'

/** Breathing room between the sticky menu and the top of the opened card. */
const GAP_PX = 8

/**
 * The scroll position that puts a card's top edge just under the sticky menu.
 * Pure so the arithmetic is tested without a browser: `cardTop` is the card's
 * `getBoundingClientRect().top` AFTER the layout settled, `scrollY` the page's
 * current offset. Never negative.
 */
export function snapTarget(cardTop: number, scrollY: number, menuHeight: number, gap = GAP_PX): number {
  return Math.max(0, Math.round(cardTop + scrollY - menuHeight - gap))
}

/**
 * When a card opens, bring its top to the top of the screen.
 *
 * Only one card is open at a time, so opening a second closes the first in the
 * SAME render. The closing card is usually above the new one and shrinks the page,
 * which on iOS (no scroll anchoring) leaves the new card somewhere off screen.
 * Measuring in a layout effect, after that render has committed, reads the
 * position the card really has, so the scroll lands on it whichever way the
 * previous card collapsed. With reduced motion on, the jump is instant instead of
 * animated; it still lands on the card.
 */
export function useSnapToTop(ref: RefObject<HTMLElement>, open: boolean) {
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    const menu = document.querySelector<HTMLElement>('[data-crew-admin-bar]')
    const top = snapTarget(el.getBoundingClientRect().top, window.scrollY, menu?.offsetHeight ?? 0)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
  }, [open, ref])
}
