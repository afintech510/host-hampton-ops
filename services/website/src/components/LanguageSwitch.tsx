import Link from 'next/link'
import { Globe } from 'lucide-react'

/**
 * The link to the same page in the other language. Labelled in the language it
 * leads TO ("Español" on the English page, "English" on the Spanish one), and
 * `lang`/`hrefLang` say so, because that is the label the visitor who needs it
 * can read.
 */
export default function LanguageSwitch({ to, href }: { to: 'en' | 'es'; href: string }) {
  const label = to === 'es' ? 'Ver en español' : 'View in English'
  return (
    <div className="flex justify-end max-w-5xl mx-auto px-4 sm:px-6 pt-4">
      <Link
        href={href}
        lang={to}
        hrefLang={to}
        className="inline-flex items-center gap-1.5 rounded-full border border-hampton-pink/30 bg-white px-3 py-1.5 text-xs font-semibold text-hampton-navy hover:border-hampton-pink transition-colors"
      >
        <Globe size={13} className="text-hampton-pink" />
        {label}
      </Link>
    </div>
  )
}
