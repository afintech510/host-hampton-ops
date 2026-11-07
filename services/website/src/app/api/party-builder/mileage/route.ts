import { NextRequest, NextResponse } from 'next/server'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { travelFeeForAddress } from '@/lib/mileage'

// The arithmetic (free first 20 miles, $5/mile beyond) is lib/mileage.ts.

export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('party-builder/mileage'))
  if (limited) return limited

  try {
    const { address } = (await req.json()) as { address?: string }
    const fee = await travelFeeForAddress(address)
    if (fee.kind === 'bad_address') return NextResponse.json({ error: 'address required' }, { status: 400 })
    if (fee.kind === 'geocode_failed') return NextResponse.json({ error: 'geocode failed' }, { status: 502 })
    if (fee.kind === 'not_found') return NextResponse.json({ error: 'address not found' }, { status: 404 })
    return NextResponse.json({ feeCents: fee.feeCents, resolvedAddress: fee.resolvedAddress })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'mileage calculation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
