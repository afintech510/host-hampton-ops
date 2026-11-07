import localFont from 'next/font/local'

// Local files, not next/font/google: see scripts/fetch-fonts.mjs for why the build must not ask Google.
const cormorant = localFont({
  src: '../../fonts/CormorantGaramond-latin-300-700.woff2',
  weight: '300 700',
  variable: '--font-cormorant',
  display: 'swap',
})

const montserrat = localFont({
  src: '../../fonts/Montserrat-latin-100-900.woff2',
  weight: '100 900',
  variable: '--font-montserrat',
  display: 'swap',
})

export default function AtelierBrimLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${cormorant.variable} ${montserrat.variable}`}>
      {/* Hide site Nav & Footer */}
      <style dangerouslySetInnerHTML={{ __html: `
        body > header.fixed { display: none !important; }
        main.flex-1 { padding-top: 0 !important; }
        footer, footer + div { display: none !important; }
      `}} />
      {children}
    </div>
  )
}
