import { NextRequest, NextResponse } from 'next/server'

// Host Hampton — 295 Montauk Hwy, Speonk NY 11972
const HH_LAT = 40.8294
const HH_LON = -72.6925
const ROAD_FACTOR = 1.3 // crude convert from great-circle to road distance
const MAX_MILES = 200
const FREE_RADIUS_MILES = 20 // no mobile-party fee inside this radius
const PER_MILE_CENTS = 500 // $5/mile — kept server-side, not disclosed to UI

export async function POST(req: NextRequest) {
  try {
    const { address } = (await req.json()) as { address?: string }
    if (!address || address.trim().length < 4) {
      return NextResponse.json({ error: 'address required' }, { status: 400 })
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
    const geo = await fetch(url, {
      headers: { 'User-Agent': 'Host Hampton Party Planner (hosthampton.com)' },
    })
    if (!geo.ok) return NextResponse.json({ error: 'geocode failed' }, { status: 502 })
    const results = (await geo.json()) as Array<{ lat: string; lon: string; display_name: string }>
    if (!results.length) return NextResponse.json({ error: 'address not found' }, { status: 404 })

    const { lat, lon, display_name } = results[0]
    const destLat = parseFloat(lat)
    const destLon = parseFloat(lon)

    // Haversine
    const R = 3958.8 // miles
    const toRad = (d: number) => (d * Math.PI) / 180
    const dLat = toRad(destLat - HH_LAT)
    const dLon = toRad(destLon - HH_LON)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(HH_LAT)) * Math.cos(toRad(destLat)) * Math.sin(dLon / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const straightMiles = R * c
    const drivingMilesEstimate = straightMiles * ROAD_FACTOR

    // Out-of-service-area: no fee, generic warning (no distance disclosed)
    if (drivingMilesEstimate > MAX_MILES) {
      return NextResponse.json({
        feeCents: 0,
        resolvedAddress: display_name,
        warning: `This address is outside our typical service area. We'll review and confirm pricing.`,
      })
    }

    // Inside free radius: no fee, no further disclosure
    if (drivingMilesEstimate < FREE_RADIUS_MILES) {
      return NextResponse.json({
        feeCents: 0,
        resolvedAddress: display_name,
      })
    }

    // Otherwise: opaque fee, rounded to nearest $25 — UI does not see miles or rate
    const rawCents = drivingMilesEstimate * PER_MILE_CENTS
    const feeCents = Math.round(rawCents / 2500) * 2500
    return NextResponse.json({
      feeCents,
      resolvedAddress: display_name,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'mileage calculation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
