import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { NOINDEX } from '@/lib/seo'

// Local files, not next/font/google: see scripts/fetch-fonts.mjs for why the build must not ask Google.
const baloo = localFont({ src: '../../fonts/Baloo2-latin-400-800.woff2', weight: '400 800', variable: '--font-troop-display', display: 'swap' })
const figtree = localFont({ src: '../../fonts/Figtree-latin-300-900.woff2', weight: '300 900', variable: '--font-troop-body', display: 'swap' })

// Unlisted: nothing on the site links here, it is not in the sitemap, and it
// asks not to be indexed. Allie shares the link with the troop's families.
export const metadata: Metadata = {
  title: { absolute: 'Girl Scouts Troop 2514' },
  description: 'Troop news, meetings, snack sign-ups and a quick way to reach our leaders.',
  robots: NOINDEX,
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
}

export default function Troop2514Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${baloo.variable} ${figtree.variable}`}>
      {/* No Host Hampton nav, footer or attribution strip: this is the troop's page. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            'body > header.fixed { display: none !important; } body main.flex-1 { padding-top: 0 !important; } body footer:not(.tb-foot), body footer:not(.tb-foot) ~ aside, body .h-40[aria-hidden="true"] { display: none !important; }',
        }}
      />
      {children}
    </div>
  )
}
