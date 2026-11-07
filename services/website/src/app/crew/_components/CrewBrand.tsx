import Link from 'next/link'

/**
 * Top centre of every crew screen: "Party Crew" in varsity lettering (navy core,
 * dusty-blue border: both from the tenant's brand colours, the same on every
 * theme). No logo - the crew app is called Party Crew and nothing else. One
 * component so a screen cannot spell the header its own way; the centring lives in
 * the `.crew-top` grid in `layout.tsx`.
 */
export default function CrewBrand({ href = '/crew' }: { href?: string }) {
  return (
    <Link href={href} className="crew-brandmark" aria-label="Party Crew">
      <span className="crew-wordmark" aria-hidden="true">Party Crew</span>
    </Link>
  )
}
