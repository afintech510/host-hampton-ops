import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * The whole /admin subtree. robots.txt already disallows `/admin/`, but that
 * pattern does not match `/admin` itself — which returns 200 — and a Disallow
 * keeps a URL from being FETCHED, not from being listed. This says no on the
 * page, where Google will read it.
 */
export const metadata: Metadata = {
  title: 'Host Hampton Admin',
  robots: NOINDEX,
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the Host Hampton nav + footer; override body gradient for admin */}
      <style dangerouslySetInnerHTML={{ __html: `
        body > header.fixed { display: none !important; }
        main.flex-1 { padding-top: 0 !important; }
        footer, footer + div { display: none !important; }
        body { background: #f5f6f8 !important; }
      `}} />
      {children}
    </>
  )
}
