/**
 * Is a freshly minted slug already somebody's OLD link? (adversarial review, finding 10)
 *
 * `evites.slug` is UNIQUE, which stops two live slugs colliding. It says nothing about `previous_slugs`: a slug
 * re-minted away from (before go-live) stays in that array as a 308 alias. `resolveEviteBySlug` looks the live
 * `slug` up first, so a NEW evite that minted a slug equal to another evite's alias would be served for that
 * address and the old link's holders would land on a stranger's invitation. Minted slugs end in four random
 * characters (~1M values per name part), so the odds are tiny, but the check is one indexed-enough read on a small
 * table, and the failure it prevents is a child's party page shown under somebody else's link.
 *
 * Three outcomes (rule 12): a failed read is `unknown`, never `free`.
 */

import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export type SlugAliasCheck = 'free' | 'taken' | 'unknown'

export async function slugIsAnAlias(supabase: Supa, slug: string): Promise<SlugAliasCheck> {
  const { data, error } = await supabase.from('evites').select('id').contains('previous_slugs', [slug]).limit(1)
  if (error) {
    console.error(`evites/slug: alias check failed: ${error.message}`)
    return 'unknown'
  }
  return ((data ?? []) as unknown[]).length > 0 ? 'taken' : 'free'
}
