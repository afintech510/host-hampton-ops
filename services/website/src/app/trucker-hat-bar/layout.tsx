import { Cormorant_Garamond, Montserrat } from 'next/font/google'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
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
