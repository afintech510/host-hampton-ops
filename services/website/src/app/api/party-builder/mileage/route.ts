import { NextRequest, NextResponse } from 'next/server'

// Host Hampton — 295 Montauk Hwy, Speonk NY 11972
const HH_LAT = 40.8294
const HH_LON = -72.6925
const ROAD_FACTOR = 1.3 // crude convert from great-circle to road distance
const PER_MILE_CENTS = 500 // $5/mile, one-way — server-side, not disclosed to UI

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

    // Mobile Party Fee component: one-way miles × $5. No free zone, no cap,
    // no rounding. Miles + rate stay server-side — UI only sees the dollar
    // amount.
    const feeCents = Math.round(drivingMilesEstimate * PER_MILE_CENTS)

    return NextResponse.json({
      feeCents,
      resolvedAddress: display_name,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'mileage calculation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
