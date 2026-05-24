import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

/**
 * One-shot migration runner — applies the equivalent of:
 *   starting_plan/migration_010_party_planner_pricing.sql
 *   starting_plan/migration_011_party_planner_food_decor.sql
 *
 * Idempotent — safe to re-run. Admin-only.
 * Hit with: POST /api/admin/run-pricing-migration (Bearer ADMIN_PASSWORD)
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const ops: { step: string; matched?: number; error?: string }[] = []

  // List all items matching ANY of the given ilike patterns
  async function findIdsByPattern(patterns: string[]): Promise<string[]> {
    const ids = new Set<string>()
    for (const pat of patterns) {
      const { data, error } = await supabase
        .from('pricing_items')
        .select('id, name')
        .ilike('name', pat)
      if (error) continue
      ;(data || []).forEach((row: { id: string }) => ids.add(row.id))
    }
    return Array.from(ids)
  }

  async function updateByPatterns(
    step: string,
    patterns: string[],
    updateData: Record<string, unknown>,
  ) {
    try {
      const ids = await findIdsByPattern(patterns)
      if (ids.length === 0) { ops.push({ step, matched: 0 }); return }
      const { error } = await supabase.from('pricing_items').update(updateData).in('id', ids)
      if (error) ops.push({ step, error: error.message })
      else ops.push({ step, matched: ids.length })
    } catch (e) {
      ops.push({ step, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // 1. Photobooth → party-add-on, $119, popular
  await updateByPatterns(
    'photobooth → party-add-on $119 popular',
    ['%photobooth%', '%photo booth%'],
    { category: 'party-add-on', price_cents: 11900, is_popular: true, sort_order: 1 },
  )

  // 2. Soft Play → party-add-on
  await updateByPatterns(
    'soft play → party-add-on',
    ['%soft play%'],
    { category: 'party-add-on', sort_order: 2 },
  )

  // 3. Rename "Leaning Balloon Tower w/ Number" → "Balloon Tower w/ Number"
  await updateByPatterns(
    'rename Leaning Balloon Tower → Balloon Tower w/ Number',
    ['Leaning Balloon Tower w/ Number'],
    { name: 'Balloon Tower w/ Number' },
  )

  // 4. Face Painter → $325
  await updateByPatterns(
    'face painter → $325',
    ['%face paint%'],
    { price_cents: 32500, price_label: null },
  )

  // 5. Character Visit → starting at $435
  await updateByPatterns(
    'character visit → starting at $435',
    ['%character visit%', '%character appear%'],
    { price_cents: 43500, price_label: 'Starting at $435' },
  )

  // 6. Sodas & Seltzers → $50 + description
  await updateByPatterns(
    'sodas & seltzers → $50',
    ['%sodas%seltzer%', '%seltzer%soda%', '%Sodas & Seltzers%'],
    {
      price_cents: 5000,
      price_label: null,
      description: 'Choose up to 4 types served in a bucket over ice for your guests.',
    },
  )

  // 7. Deactivate "Pizza - Assorted Pies (per person)"
  await updateByPatterns(
    'deactivate pizza assorted pies (per person)',
    ['%pizza - assorted%', '%pizza%assorted pies%'],
    { is_active: false },
  )

  // 8. Deactivate "Additional Party Guest" / "Extra Guest"
  await updateByPatterns(
    'deactivate additional/extra party guest',
    ['%additional%guest%', '%extra guest%'],
    { is_active: false },
  )

  // 9. Double Arch — only update if NOT decor-add-on
  try {
    const { data: doubleArch, error } = await supabase
      .from('pricing_items')
      .select('id, name, category')
      .ilike('name', 'double arch%')
    if (!error && doubleArch) {
      const ids = doubleArch.filter((d: { category: string }) => d.category !== 'decor-add-on').map((d: { id: string }) => d.id)
      if (ids.length) {
        await supabase.from('pricing_items').update({ category: 'decor-add-on' }).in('id', ids)
        ops.push({ step: 'double arch → decor-add-on', matched: ids.length })
      } else {
        ops.push({ step: 'double arch → decor-add-on', matched: 0 })
      }
    }
  } catch (e) {
    ops.push({ step: 'double arch → decor-add-on', error: e instanceof Error ? e.message : String(e) })
  }

  // Verification
  const verifyPatterns = ['%photobooth%', '%soft play%', '%face paint%', '%character%', '%pizza%', '%seltzer%', '%balloon tower%', '%double arch%', '%additional%guest%', '%extra guest%']
  const verifyIds = new Set<string>()
  for (const pat of verifyPatterns) {
    const { data } = await supabase.from('pricing_items').select('id').ilike('name', pat)
    ;(data || []).forEach((row: { id: string }) => verifyIds.add(row.id))
  }
  const { data: verification } = verifyIds.size
    ? await supabase
        .from('pricing_items')
        .select('category, name, price_cents, price_label, is_popular, is_active, sort_order')
        .in('id', Array.from(verifyIds))
        .order('category')
    : { data: [] as unknown }

  return NextResponse.json({ ops, verification })
}
