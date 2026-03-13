import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CM Cheer Fundraiser — Team Gear Order Form',
  description: 'Official Center Moriches Cheerleading fundraiser order form. Trucker hats, canvas totes, pouches, and team patches.',
}

export default function CMCheerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the Host Hampton nav on this standalone fundraiser page */}
      <style dangerouslySetInnerHTML={{ __html: 'body > header.fixed { display: none !important; }' }} />
      {children}
    </>
  )
}
