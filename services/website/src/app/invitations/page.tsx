import type { Metadata } from 'next'
import { OG_DEFAULTS, SITE_URL } from '@/lib/seo'
import { fontFaceCss } from '@/lib/evites/fontFaces'
import { sampleShowcaseInput, showcaseCards } from '@/lib/evites/showcase'
import InvitationShowcase from './InvitationShowcase'

/**
 * /invitations — every Host Hampton EVITE design, as a look-book a parent can type into.
 *
 * The first render is drawn here with a sample party (Mia, turning 7, a Saturday two weeks
 * out, 2 PM) so the page is complete before any script runs; the form then redraws every
 * card through `POST /api/invitations/showcase` (see that route for why it is a body).
 *
 * Per-request so the sample date stays two weeks ahead rather than freezing at build time.
 * No database read. The designs come from the template registry, so a design added there
 * appears here with no change to this page.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DESCRIPTION =
  'See every Host Hampton EVITE party invitation design with your child’s name, age, date and time. Included with every theme party.'

export const metadata: Metadata = {
  title: 'Party Invitation Designs',
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/invitations` },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Party Invitation Designs — Host Hampton',
    description: DESCRIPTION,
    url: `${SITE_URL}/invitations`,
  },
}

export default function InvitationsPage() {
  const input = sampleShowcaseInput()
  const cards = showcaseCards(input)
  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss() }} />
      <InvitationShowcase initialCards={cards} initialInput={input} />
    </>
  )
}
