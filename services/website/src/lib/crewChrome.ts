/**
 * Which paths are the crew app (`/crew`), for the site-wide chrome (prompt 03).
 *
 * The crew app is a staff tool with its own shell: no site nav, no footer, no
 * agency credit, no chat bubble, no promo banners, no ad pixel and no
 * attribution capture. Imported by client components, so it imports nothing.
 *
 * Callers must use it AFTER their hooks: Nav lives in the root layout and
 * survives a client-side navigation, and returning before a hook changed the
 * hook count and took the planner down on mobile once.
 */
export function isCrewPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && (pathname === '/crew' || pathname.startsWith('/crew/'))
}
