/** Public mobile parties are quoted by the team, never priced from the retired planner bands. */
export const MOBILE_QUOTE_MESSAGE = 'Mobile parties need a custom quote. Tell us about your party and our team will confirm pricing.'
export const MOBILE_QUOTE_URL = '/mobile-party#book'
export function isMobilePlannerRequest(body: Record<string, unknown>): boolean {
  const snapshot = body.quoteData as Record<string, unknown> | null | undefined
  return body.locationType === 'mobile' || body.party_type === 'mobile_party' || body.packageType === 'mobile_party'
    || snapshot?.locationType === 'mobile' || snapshot?.location_type === 'mobile'
    || (Array.isArray(body.lineItems) && body.lineItems.some(item => item?.category === 'mobile-package'))
}
