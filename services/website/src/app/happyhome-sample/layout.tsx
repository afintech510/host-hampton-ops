export default function HappyHomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        body > header.sticky, body > header, nav.sticky, header[class*="sticky"],
        body > footer, footer[class*="bg-"] { display: none !important; }
        main { padding-top: 0 !important; }
      `}} />
      {children}
    </>
  )
}
