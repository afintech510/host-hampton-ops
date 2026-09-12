import { permanentRedirect } from 'next/navigation'

/**
 * /party-add-ons was folded into /kids-party-menu, which carries the full
 * add-ons list. 308 rather than 307 for the reason in /classes/page.tsx — and
 * this one is linked in body copy from /first-birthday-parties, so it is a URL
 * Google has a reason to hold on to.
 */
export default function PartyAddOns() {
  permanentRedirect('/kids-party-menu')
}
