import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'RSE Merch — Remsenburg-Speonk Elementary Order Form',
  description:
    // Says only what /rse-merch sells today — see ON_SALE in page.tsx.
    'Official Remsenburg-Speonk Elementary merch. A royal blue canvas tote and a yellow canvas makeup bag with the RSE rooster or varsity patch, plus the patches on their own.',
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
