import Image from 'next/image'
import Link from 'next/link'
import { TENANT } from '@/tenant'

/**
 * Top left of every crew screen: the Host Hampton logo, and CREW in varsity
 * lettering (navy core, dusty-blue border: both from the tenant's brand colours,
 * the same on every theme). One component so a screen cannot spell the header
 * its own way.
 */
export default function CrewBrand({ href = '/crew' }: { href?: string }) {
  return (
    <Link href={href} className="crew-brandmark" aria-label={`${TENANT.business.name} Crew`}>
      <Image src={TENANT.brand.logo} alt="" width={78} height={34} className="crew-logo" priority />
      <span className="crew-wordmark" aria-hidden="true">Crew</span>
    </Link>
  )
}
