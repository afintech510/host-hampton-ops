import { NextResponse, type NextRequest } from 'next/server'

/**
 * Case-folds the handful of paths that are PRINTED — on QR codes and flyers —
 * where somebody typed the URL in capitals.
 *
 * This cannot live in `next.config.js` redirects(): Next compiles a redirect
 * `source` case-INSENSITIVELY (measured: `/ESM-SHARKS/ORDER` already 307s via
 * the `/esm-sharks/order` rule), so `/ESM-SHARKS → /esm-sharks` would also
 * match `/esm-sharks` and redirect it to itself forever. Here the comparison is
 * exact: only a path that is NOT already lowercase is redirected.
 *
 * Deliberately an allowlist, not "lowercase every path": plan refs, portal
 * tokens and review links carry capitals that mean something.
 */
export const CASE_FOLDED_PATHS = new Set(['/esm-sharks'])

export function caseFoldRedirect(pathname: string): string | null {
  const lower = pathname.toLowerCase()
  if (lower === pathname) return null
  return CASE_FOLDED_PATHS.has(lower) ? lower : null
}

export function middleware(req: NextRequest) {
  const target = caseFoldRedirect(req.nextUrl.pathname)
  if (!target) return NextResponse.next()
  const url = req.nextUrl.clone()
  url.pathname = target
  return NextResponse.redirect(url, 308)
}

// Matcher patterns are compiled without the case-insensitive flag, so list the
// whole top-level path space (minus assets and API) and decide in code.
export const config = {
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
}
