/**
 * Fantasy football draft nights — the one place the offer is written down.
 *
 * /fantasy-football-draft-party renders from this and /llms.txt states it, so
 * an answer engine and the page cannot disagree (the 2026-10-04 lesson: every
 * "contradiction" a model reported was two pages of ours saying different
 * things). Change a figure here and both move.
 *
 * Prices are Adam's, set 2026-10-16 from the competitor sweep in
 * docs/draft-party-research-2026-10.md. They are NOT read from
 * `pricing_items`: a draft night is quoted and invoiced by hand, not sold
 * through /studio-rental checkout (which charges the standard weekday rate).
 */

export const DRAFT_PARTY_SLUG = 'fantasy-football-draft-party'
/** `sourcePage` on the lead — /api/lead treats it as a room rental. */
export const DRAFT_PARTY_SOURCE_PAGE = DRAFT_PARTY_SLUG
export const DRAFT_PARTY_EVENT_TYPE = 'Fantasy Draft Party'

/** The nights the special runs. Fri–Sun is the standard room rental. */
export const DRAFT_NIGHTS = 'Monday–Thursday'
export const DRAFT_BLOCK_HOURS = 4
export const DRAFT_EXTRA_HOUR_CENTS = 7500
export const DRAFT_MAX_GUESTS = 16
export const DRAFT_DEPOSIT_CENTS = 10000
/** Earliest and latest start, Eastern. */
export const DRAFT_START_WINDOW = '5–7 PM'

/**
 * Whether the room has a TV/projector a laptop can plug into. Adam, 2026-10-16:
 * one is being added for draft season, so it is advertised. If it is ever
 * gone, set this false — the page then tells leagues to bring their own
 * rather than promising a screen that is not there.
 */
export const DRAFT_HAS_BIG_SCREEN = true

export interface DraftPackage {
  id: 'room' | 'package'
  name: string
  priceCents: number
  /** Guests covered by `priceCents`. */
  includesGuests: number
  /** Per guest beyond `includesGuests`, up to DRAFT_MAX_GUESTS. 0 = flat. */
  extraGuestCents: number
  tagline: string
  includes: string[]
}

export const DRAFT_PACKAGES: DraftPackage[] = [
  {
    id: 'room',
    name: 'Draft Room',
    priceCents: 29900,
    includesGuests: DRAFT_MAX_GUESTS,
    extraGuestCents: 0,
    tagline: 'The room is yours. Bring the league.',
    includes: [
      `${DRAFT_BLOCK_HOURS} hours of private room, ${DRAFT_NIGHTS} night`,
      `Up to ${DRAFT_MAX_GUESTS} people at one long draft table`,
      'Fast WiFi and power at every seat for laptops',
      ...(DRAFT_HAS_BIG_SCREEN ? ['A big screen with HDMI for the live draft room'] : []),
      'Wall space for a paper draft board',
      'Bluetooth speaker for the pick announcements',
      'Bring your own food, or order from Michelangelo’s next door',
      'We set up and clean up',
    ],
  },
  {
    id: 'package',
    name: 'Draft Night Package',
    priceCents: 49900,
    includesGuests: 12,
    extraGuestCents: 3000,
    tagline: 'Room, food and the board. Just show up and draft.',
    includes: [
      'Everything in the Draft Room',
      'Hot food from Michelangelo of Speonk, set out when you arrive: pizza pies, wings, chicken parm heroes, garlic knots and salad',
      'Soda and water on ice',
      'A physical draft board with player stickers, sized to your league',
      'Plates, napkins and cleanup handled',
    ],
  },
]

export function draftUsd(cents: number): string {
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString('en-US')}` : `$${d.toFixed(2)}`
}

/** "about $25 a manager" for an N-team league, rounded to the dollar. */
export function perManager(p: DraftPackage, teams: number): string {
  const extra = Math.max(0, teams - p.includesGuests) * p.extraGuestCents
  return draftUsd(Math.round((p.priceCents + extra) / teams / 100) * 100)
}

export interface DraftFaq {
  q: string
  a: string
}

/**
 * The questions commissioners (and the assistants they ask) actually put —
 * from the 2026-10-16 keyword sweep. Rendered on the page AND as FAQPage
 * schema, so the answer an engine quotes is the one a visitor reads.
 */
export function draftFaqs(): DraftFaq[] {
  const [room, pkg] = DRAFT_PACKAGES
  return [
    {
      q: 'Where can I host a fantasy football draft on Long Island’s East End?',
      a: `Host Hampton has a private draft room at 295 Montauk Highway in Speonk, between Westhampton and Eastport — about 10 minutes from the Moriches and 15 to 20 from Riverhead and Hampton Bays. It is a private studio, not a bar, so the room is only your league, and you can hear every pick.`,
    },
    {
      q: 'How much does a fantasy draft party room cost?',
      a: `The Draft Room is ${draftUsd(room.priceCents)} for a ${DRAFT_BLOCK_HOURS}-hour ${DRAFT_NIGHTS} night, up to ${DRAFT_MAX_GUESTS} people. That is about ${perManager(room, 12)} a manager in a 12-team league. The Draft Night Package, with food from Michelangelo of Speonk and a draft board, is ${draftUsd(pkg.priceCents)} for ${pkg.includesGuests} people plus ${draftUsd(pkg.extraGuestCents)} for each extra person. That is about ${perManager(pkg, 12)} a manager for 12. Sales tax applies.`,
    },
    {
      q: 'How many people fit? Does it work for a 10, 12 or 14-team league?',
      a: `Draft nights are set up for up to ${DRAFT_MAX_GUESTS} people at one long table, so 8, 10, 12, 14 and 16-team leagues all fit with a seat for everyone. Bigger group or a two-league night? Ask us. The studio seats 65.`,
    },
    {
      q: 'How long do we get the room? How long does a draft take?',
      a: `You get ${DRAFT_BLOCK_HOURS} hours, starting between ${DRAFT_START_WINDOW}. A 12-team snake draft usually runs 2 to 3 hours with breaks, and an auction draft runs longer, so ${DRAFT_BLOCK_HOURS} hours leaves time to eat before and talk trash after. Extra hours are ${draftUsd(DRAFT_EXTRA_HOUR_CENTS)} each.`,
    },
    {
      q: 'Is there WiFi and somewhere to plug in laptops?',
      a: 'Yes. WiFi is included and there is power at the draft table, so everyone drafting on ESPN, Yahoo, Sleeper or NFL Fantasy can stay plugged in all night.',
    },
    DRAFT_HAS_BIG_SCREEN
      ? {
          q: 'Can we put the draft room up on a big screen?',
          a: 'Yes. Plug a laptop into the TV with HDMI and the whole league can watch the draft board update live.',
        }
      : {
          q: 'Can we put the draft room up on a big screen?',
          a: 'Bring a TV or projector and we will set it up at the head of the table, with power and WiFi ready. Most leagues that draft on paper run the live board on the wall instead.',
        },
    {
      q: 'Do you have a physical draft board and stickers?',
      a: `The Draft Night Package includes a draft board with player stickers sized to your league. On the Draft Room, bring your own board and we will have the wall space ready for it.`,
    },
    {
      q: 'Can we order food? Can we bring our own?',
      a: `Both. Michelangelo of Speonk is right next door at the same address. On the Draft Night Package we order the food and have it set out when you arrive. On the Draft Room you can bring your own food or order from them yourself. Their kitchen takes orders until about 8:30 PM, so order before you start.`,
    },
    {
      q: 'Can we bring beer?',
      a: 'Alcohol at the studio needs a permit. Tell us your plans when you book and we will walk you through what is allowed.',
    },
    {
      q: 'Can managers who are not there join remotely?',
      a: 'Yes. The WiFi handles a video call alongside the draft, so a manager who can’t make it can still pick live from home. Or have someone in the room pick for them.',
    },
    {
      q: 'When should we book our draft night?',
      a: 'Most leagues draft between the start of August and the first NFL game, and the last two weeks of August go first. Book as soon as your league picks a night. A weeknight in early August is the easiest to get.',
    },
    {
      q: 'How do I reserve? What is the deposit?',
      a: `Send the form with your night and league size and we confirm within 24 hours. A ${draftUsd(DRAFT_DEPOSIT_CENTS)} deposit holds the night and comes off your total, and the balance is due on draft night. Changing your date is free when another night is open. A refundable card hold (not a charge) is placed before the event, as with every studio rental.`,
    },
    {
      q: 'Can we use the room for other league nights?',
      a: 'Yes. The same room works for championship and trophy nights, last-place punishment reveals, Super Bowl parties, March Madness bracket nights, poker nights and fantasy baseball drafts. Weeknights get the same rates.',
    },
    {
      q: 'What about Friday or the weekend?',
      a: 'The draft night rates are for Monday to Thursday. Fridays and weekends book at our standard studio rental rates, on the Party Room Rental page.',
    },
  ]
}
