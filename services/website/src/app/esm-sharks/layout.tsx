import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ESM Sharks Fundraiser — Team Gear Order Form',
  description:
    'Official Eastport-South Manor Sharks fundraiser order form. Navy and silver trucker hats, canvas totes, zip pouches, and the Sharks patch.',
}

export default function ESMSharksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the Host Hampton nav on this standalone fundraiser page */}
      <style dangerouslySetInnerHTML={{ __html: 'body > header.fixed { display: none !important; } body main.flex-1 { padding-top: 0 !important; } body > .flex-col > .h-40 { display: none !important; } body > .flex-col > footer { display: none !important; }' }} />
      {children}
    </>
  )
}
