import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'RSE Merch — Remsenburg-Speonk Elementary Order Form',
  description:
    'Official Remsenburg-Speonk Elementary merch. Royal blue and yellow crewneck sweatshirts, canvas totes, makeup bags and trucker hats with the RSE rooster, varsity, Reggie and heart patches.',
}

export default function RSEMerchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the Host Hampton nav on this standalone fundraiser page */}
      <style dangerouslySetInnerHTML={{ __html: 'body > header.fixed { display: none !important; } body main.flex-1 { padding-top: 0 !important; } body > .flex-col > .h-40 { display: none !important; } body > .flex-col > footer { display: none !important; }' }} />
      {children}
    </>
  )
}
