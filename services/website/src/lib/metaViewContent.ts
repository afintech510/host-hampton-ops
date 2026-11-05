/**
 * Which pages tell Meta "this visitor looked at a theme / at prices".
 *
 * `ViewContent` is the middle of the funnel: it builds the "looked but did not
 * book" audience that retargeting is for. Two kinds of page count, and nothing
 * else does — the home page, the FAQ and the legal pages are not interest in a
 * party.
 *
 * The map is by PATH so a page does not have to remember to fire it, and a new
 * theme page is one line here. The event carries a page slug and a category and
 * nothing about the visitor.
 */

export type ViewContentCategory = 'party_theme' | 'pricing'

/** The theme pages (each a landing page for one party theme) and the theme index. */
const THEME_PATHS = [
  '/party-themes',
  '/glow-party',
  '/slime-party',
  '/paint-party',
  '/mermaid-party',
  '/spa-party',
  '/squishy-party',
  '/arts-and-crafts-party',
  '/balloon-dog-painting-party',
  '/halloween-craft-party',
  '/communion-party',
  '/first-birthday-parties',
  '/toddler-party',
  '/fantasy-football-draft-party',
] as const

/** The pages that show what a party costs. */
const PRICING_PATHS = [
  '/party-packages',
  '/kids-party-menu',
  '/party-menu',
  '/party-room-rental',
  '/studio-rental',
  '/party-add-ons',
  '/mobile-party',
  '/mobile-craft-party',
  '/party-quote',
] as const

export interface ViewContentParams {
  content_name: string
  content_category: ViewContentCategory
}

/** The event for this path, or null if the page is not one that counts. */
export function viewContentFor(pathname: string | null | undefined): ViewContentParams | null {
  if (!pathname) return null
  // Exact page, with or without a trailing slash. A sub-page (a success page, a
  // summary) is not "looking at prices".
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if ((THEME_PATHS as readonly string[]).includes(path)) return { content_name: path.slice(1), content_category: 'party_theme' }
  if ((PRICING_PATHS as readonly string[]).includes(path)) return { content_name: path.slice(1), content_category: 'pricing' }
  return null
}
