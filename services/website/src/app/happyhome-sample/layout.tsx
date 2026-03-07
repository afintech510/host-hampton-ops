export default function HappyHomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        body { background: #f8f9fa !important; }
        header.fixed, header[class*="fixed"] { display: none !important; }
        footer, div[aria-hidden="true"].h-40, div.h-40[aria-hidden] { display: none !important; }
        main { padding-top: 0 !important; }
      `}} />
      {children}
    </>
  )
}
