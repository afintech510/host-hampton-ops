import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Signup Sheet — Host Hampton',
  robots: 'noindex, nofollow',
}

export default function SignupSheetLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide nav, footer, gradient for print-only page */}
      <style dangerouslySetInnerHTML={{ __html: 'body > header.fixed { display: none !important; } body main.flex-1 { padding-top: 0 !important; } body > .flex-col > .h-40 { display: none !important; } body > .flex-col > footer { display: none !important; }' }} />
      {children}
    </>
  )
}
