import CrewPartyEditor from '../../_components/CrewPartyEditor'

export default function CrewPartyPage({ params }: { params: { id: string } }) {
  return <CrewPartyEditor partyId={params.id} />
}
