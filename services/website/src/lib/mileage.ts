/**
 * The mobile-party travel fee: ONE implementation, used by the planner's mileage
 * route and by the Manager assistant when it prices a mobile party.
 *
 * Owner ruling 2026-09-05: the first 20 miles from the studio are FREE; only
 * miles beyond that are billable, at $5/mile one-way, no cap. The miles and the
 * rate stay server-side - a caller sees the dollar amount.
 */

// Host Hampton - 295 Montauk Hwy, Speonk NY 11972
const HH_LAT = 40.8294
const HH_LON = -72.6925
const ROAD_FACTOR = 1.3 // crude convert from great-circle to road distance
const PER_MILE_CENTS = 500
const FREE_RADIUS_MILES = 20

export type TravelFee =
  | { kind: 'ok'; feeCents: number; resolvedAddress: string }
  | { kind: 'bad_address' }
  | { kind: 'geocode_failed' }
  | { kind: 'not_found' }

export async function travelFeeForAddress(address: string | undefined | null): Promise<TravelFee> {
  if (!address || address.trim().length < 4) return { kind: 'bad_address' }
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
  const geo = await fetch(url, { headers: { 'User-Agent': 'Host Hampton Party Planner (hosthampton.com)' } })
  if (!geo.ok) return { kind: 'geocode_failed' }
  const results = (await geo.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (!results.length) return { kind: 'not_found' }

  const { lat, lon, display_name } = results[0]
  const destLat = parseFloat(lat)
  const destLon = parseFloat(lon)

  // Haversine
  const R = 3958.8 // miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(destLat - HH_LAT)
  const dLon = toRad(destLon - HH_LON)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(HH_LAT)) * Math.cos(toRad(destLat)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const drivingMilesEstimate = R * c * ROAD_FACTOR

  const billableMiles = Math.max(0, drivingMilesEstimate - FREE_RADIUS_MILES)
  return { kind: 'ok', feeCents: Math.round(billableMiles * PER_MILE_CENTS), resolvedAddress: display_name }
}
