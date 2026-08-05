import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sample Fundraiser Ordering Page — Host Hampton',
  description: 'See a live example of the custom online ordering page your supporters use to order fundraiser gear — trucker hats, canvas totes, pouches, and team patches.',
}

export default function LiHighLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the Host Hampton nav on this standalone fundraiser sample page */}
      <style dangerouslySetInnerHTML={{ __html: 'body > header.fixed { display: none !important; } body main.flex-1 { padding-top: 0 !important; } body > .flex-col > .h-40 { display: none !important; } body > .flex-col > footer { display: none !important; }' }} />
      {children}
    </>
  )
}
