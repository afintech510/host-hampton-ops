import CrewAdminShell from './_components/CrewAdminShell'

/**
 * Every /admin/crew page shares this shell: one sign-in check, the sticky top menu,
 * and the warmed data behind every tab. It persists across tab changes, which is what
 * makes them instant.
 */
export default function CrewAdminLayout({ children }: { children: React.ReactNode }) {
  return <CrewAdminShell>{children}</CrewAdminShell>
}
