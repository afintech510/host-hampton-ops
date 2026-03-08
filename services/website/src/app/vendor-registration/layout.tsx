export default function VendorRegistrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: 'body { background: #BCCDEB !important; }' }} />
      {children}
    </>
  )
}
