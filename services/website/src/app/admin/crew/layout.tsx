import localFont from 'next/font/local'
import CrewAdminShell from './_components/CrewAdminShell'

/**
 * Every /admin/crew page shares this shell: one sign-in check, the sticky top menu, and the
 * warmed data behind every tab. It persists across tab changes, which is what makes them
 * instant. The collegiate slab used for the "PARTY CREW" title is the staff app's own.
 */
const varsity = localFont({ src: '../../../fonts/Graduate-latin-400.woff2', weight: '400', variable: '--crew-font-varsity', display: 'swap' })

export default function CrewAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={varsity.variable}>
      <CrewAdminShell>{children}</CrewAdminShell>
    </div>
  )
}
