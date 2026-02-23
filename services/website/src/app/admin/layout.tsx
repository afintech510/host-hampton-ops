export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the Host Hampton nav + footer on admin pages */}
      <style dangerouslySetInnerHTML={{ __html: `
        body > header.fixed { display: none !important; }
        main.flex-1 { padding-top: 0 !important; }
        footer, footer + div { display: none !important; }
      `}} />
      {children}
    </>
  )
}
