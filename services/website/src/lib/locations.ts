/**
 * Service-area locations for the mobile craft party landing pages.
 *
 * Each entry powers one SEO location page at /mobile-craft-party/<slug> plus a
 * card on the /mobile-craft-party hub. Host Hampton's studio is in Speonk, NY
 * (11972, western Southampton Town on the East End). We travel across Long
 * Island — East End to Nassau, and into NYC for larger events.
 *
 * IMPORTANT (avoiding thin/doorway pages): every field here exists to give each
 * town page genuinely localized, non-duplicate content — a real region label,
 * true neighboring towns, a local-context sentence, and an honest travel note.
 * Keep descriptors factual (public geography only) — no invented business facts.
 */

export type TravelTier = 'included' | 'eastEnd' | 'western' | 'nassau' | 'nyc'

export interface Location {
  slug: string
  /** Town/city name as people search it. */
  name: string
  county: 'Suffolk' | 'Nassau' | 'New York'
  /** Region label shown on the page and used to group the hub list. */
  region: string
  /** Approximate driving distance from the Speonk studio, in miles. */
  milesFromStudio: number
  travelTier: TravelTier
  /** Real neighboring towns we also serve — used for internal links + local relevance. */
  nearby: string[]
  /** One true, local-flavor sentence. Public geography only, no business claims. */
  context: string
}

/** Human-readable travel note per tier. Mirrors the mobile-party FAQ policy. */
export const TRAVEL_NOTES: Record<TravelTier, string> = {
  included:
    'You’re inside our core service area — travel is included, with no extra trip fee.',
  eastEnd:
    'You’re on the East End, close to our Speonk studio — a small travel fee may apply for the far end of the Forks.',
  western:
    'We regularly head west across Suffolk for parties — a modest travel fee covers the drive.',
  nassau:
    'We come out to Nassau County for parties booked ahead — a travel fee applies for the longer haul.',
  nyc:
    'We’ll bring the party into the five boroughs for larger events — ask us for a custom travel quote.',
}

export const LOCATIONS: Location[] = [
  // ── East End · South Fork (closest to the studio) ──
  { slug: 'westhampton-beach', name: 'Westhampton Beach', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 6, travelTier: 'included', nearby: ['Quogue', 'Remsenburg', 'Hampton Bays'], context: 'Just minutes from our Speonk studio, Westhampton Beach is about as close to home as our route gets — an easy setup for backyard and beach-house parties.' },
  { slug: 'quogue', name: 'Quogue', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 5, travelTier: 'included', nearby: ['Westhampton Beach', 'Hampton Bays', 'East Quogue'], context: 'Quogue’s quiet, leafy streets are a short hop from Speonk — an easy at-home setup for us.' },
  { slug: 'hampton-bays', name: 'Hampton Bays', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 10, travelTier: 'included', nearby: ['Quogue', 'Southampton', 'Flanders'], context: 'From canal-side homes to summer rentals, Hampton Bays parties are well within our core route.' },
  { slug: 'southampton', name: 'Southampton', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 15, travelTier: 'eastEnd', nearby: ['Water Mill', 'Hampton Bays', 'Bridgehampton'], context: 'Southampton Village and its estate-section backyards give our mobile craft crew plenty of room to work, indoors or out.' },
  { slug: 'bridgehampton', name: 'Bridgehampton', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 22, travelTier: 'eastEnd', nearby: ['Sag Harbor', 'Sagaponack', 'Water Mill'], context: 'Bridgehampton’s big backyards and farm-country homes are made for outdoor craft stations.' },
  { slug: 'sag-harbor', name: 'Sag Harbor', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 25, travelTier: 'eastEnd', nearby: ['Bridgehampton', 'East Hampton', 'North Haven'], context: 'We bring the party to Sag Harbor’s historic village homes and waterfront cottages alike.' },
  { slug: 'east-hampton', name: 'East Hampton', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 30, travelTier: 'eastEnd', nearby: ['Amagansett', 'Sag Harbor', 'Wainscott'], context: 'From East Hampton Village to the ocean-side lanes, we’ll bring the full craft setup to your door.' },
  { slug: 'amagansett', name: 'Amagansett', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 34, travelTier: 'eastEnd', nearby: ['East Hampton', 'Montauk', 'Wainscott'], context: 'Beach-house birthdays in Amagansett pair perfectly with our sand-art and seashell stations.' },
  { slug: 'montauk', name: 'Montauk', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 44, travelTier: 'eastEnd', nearby: ['Amagansett', 'East Hampton'], context: 'Yes — we go all the way out to The End. Montauk beach houses and summer rentals are within our travel range.' },
  { slug: 'sagaponack', name: 'Sagaponack', county: 'Suffolk', region: 'East End · South Fork', milesFromStudio: 24, travelTier: 'eastEnd', nearby: ['Bridgehampton', 'Wainscott', 'Water Mill'], context: 'Sagaponack’s open farmland backyards give us room to run every station outdoors.' },

  // ── East End · North Fork ──
  { slug: 'riverhead', name: 'Riverhead', county: 'Suffolk', region: 'East End · North Fork', milesFromStudio: 14, travelTier: 'included', nearby: ['Aquebogue', 'Wading River', 'Calverton'], context: 'Riverhead sits right at the fork of the Island — an easy, close-in drive for our team.' },
  { slug: 'mattituck', name: 'Mattituck', county: 'Suffolk', region: 'East End · North Fork', milesFromStudio: 24, travelTier: 'eastEnd', nearby: ['Cutchogue', 'Jamesport', 'Southold'], context: 'North Fork farm stands and vineyards make Mattituck a scenic at-home party spot.' },
  { slug: 'southold', name: 'Southold', county: 'Suffolk', region: 'East End · North Fork', milesFromStudio: 30, travelTier: 'eastEnd', nearby: ['Mattituck', 'Greenport', 'Cutchogue'], context: 'We bring craft stations out to Southold’s waterfront and vineyard-country homes.' },
  { slug: 'greenport', name: 'Greenport', county: 'Suffolk', region: 'East End · North Fork', milesFromStudio: 35, travelTier: 'eastEnd', nearby: ['Southold', 'Orient', 'East Marion'], context: 'Greenport’s harbor village is our easternmost North Fork stop for mobile parties.' },

  // ── Central Suffolk ──
  { slug: 'patchogue', name: 'Patchogue', county: 'Suffolk', region: 'Central Suffolk', milesFromStudio: 22, travelTier: 'western', nearby: ['Bellport', 'Sayville', 'Blue Point'], context: 'Patchogue’s lively village and family neighborhoods sit right on our route west across Suffolk.' },
  { slug: 'sayville', name: 'Sayville', county: 'Suffolk', region: 'Central Suffolk', milesFromStudio: 28, travelTier: 'western', nearby: ['Patchogue', 'Bayport', 'Oakdale'], context: 'We bring the mobile craft party to Sayville homes, clubs, and community rooms.' },
  { slug: 'bay-shore', name: 'Bay Shore', county: 'Suffolk', region: 'Central Suffolk', milesFromStudio: 34, travelTier: 'western', nearby: ['Islip', 'Brightwaters', 'West Islip'], context: 'Bay Shore and the greater Islip area are well within our western Suffolk range.' },
  { slug: 'smithtown', name: 'Smithtown', county: 'Suffolk', region: 'Central Suffolk', milesFromStudio: 38, travelTier: 'western', nearby: ['Nesconset', 'St. James', 'Hauppauge'], context: 'Smithtown’s roomy suburban backyards are a great fit for a full craft-station lineup.' },
  { slug: 'babylon', name: 'Babylon', county: 'Suffolk', region: 'Central Suffolk', milesFromStudio: 40, travelTier: 'western', nearby: ['West Islip', 'Lindenhurst', 'Amityville'], context: 'From Babylon Village to the South Shore, we bring the whole party to your door.' },
  { slug: 'huntington', name: 'Huntington', county: 'Suffolk', region: 'Central Suffolk', milesFromStudio: 46, travelTier: 'western', nearby: ['Melville', 'Northport', 'Cold Spring Harbor'], context: 'We travel out to Huntington and the North Shore for at-home and community parties.' },

  // ── Nassau County ──
  { slug: 'rockville-centre', name: 'Rockville Centre', county: 'Nassau', region: 'Nassau County', milesFromStudio: 55, travelTier: 'nassau', nearby: ['Lynbrook', 'Baldwin', 'Oceanside'], context: 'Rockville Centre families can book our mobile craft party with a little advance notice.' },
  { slug: 'garden-city', name: 'Garden City', county: 'Nassau', region: 'Nassau County', milesFromStudio: 58, travelTier: 'nassau', nearby: ['Mineola', 'Hempstead', 'Franklin Square'], context: 'We come out to Garden City for backyard birthdays, showers, and community events.' },
  { slug: 'long-beach', name: 'Long Beach', county: 'Nassau', region: 'Nassau County', milesFromStudio: 58, travelTier: 'nassau', nearby: ['Island Park', 'Oceanside', 'Lido Beach'], context: 'Beach-town birthdays in Long Beach pair naturally with our sand-art and seashell stations.' },
  { slug: 'great-neck', name: 'Great Neck', county: 'Nassau', region: 'Nassau County', milesFromStudio: 68, travelTier: 'nassau', nearby: ['Manhasset', 'Port Washington', 'Roslyn'], context: 'We’ll bring the party to Great Neck and the North Shore Gold Coast for booked-ahead events.' },
  { slug: 'manhasset', name: 'Manhasset', county: 'Nassau', region: 'Nassau County', milesFromStudio: 66, travelTier: 'nassau', nearby: ['Great Neck', 'Port Washington', 'Roslyn'], context: 'Manhasset and the surrounding North Shore villages are within our Nassau service range.' },

  // ── New York City ──
  { slug: 'manhattan', name: 'Manhattan', county: 'New York', region: 'New York City', milesFromStudio: 85, travelTier: 'nyc', nearby: ['Brooklyn', 'Queens'], context: 'For the right event, we’ll bring the full Host Hampton craft experience into Manhattan — penthouse, loft, or private room.' },
]

export function getLocation(slug: string): Location | undefined {
  return LOCATIONS.find(l => l.slug === slug)
}

/** Locations grouped by region, in display order, for the hub page. */
export function locationsByRegion(): { region: string; items: Location[] }[] {
  const order: string[] = []
  const map = new Map<string, Location[]>()
  for (const loc of LOCATIONS) {
    if (!map.has(loc.region)) {
      map.set(loc.region, [])
      order.push(loc.region)
    }
    map.get(loc.region)!.push(loc)
  }
  return order.map(region => ({ region, items: map.get(region)! }))
}
