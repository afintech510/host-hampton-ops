import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

export const metadata: Metadata = {
  robots: NOINDEX,
  title: 'Boggle Solver',
  description: 'Upload a screenshot of your word game grid and find every valid word instantly.',
}

export default function BoggleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide Host Hampton nav/footer on this standalone tool page */}
      <style dangerouslySetInnerHTML={{ __html: 'body > header.fixed { display: none !important; } body main.flex-1 { padding-top: 0 !important; } body > .flex-col > .h-40 { display: none !important; } body > .flex-col > footer { display: none !important; }' }} />
      {children}
    </>
  )
}
