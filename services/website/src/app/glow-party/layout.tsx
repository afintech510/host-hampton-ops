export default function GlowPartyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: 'body { background: #05090d !important; }' }} />
      {children}
    </>
  )
}
