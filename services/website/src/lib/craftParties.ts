/**
 * Craft / theme landing pages — data-driven "[craft] party" SEO pages.
 *
 * Each entry renders one top-level landing page (e.g. /slime-party) via the
 * shared <CraftPartyLanding> component. These target exact-match "[craft] party"
 * search intent and cross-link into the mobile-craft-party hub + town pages.
 *
 * NOTE: /glow-party already exists as its own bespoke page — it is intentionally
 * NOT duplicated here; we link to it as a related craft instead.
 *
 * `venue` controls the "where" messaging:
 *   'both'   → at your house (mobile) OR our Speonk studio
 *   'studio' → hosted at our Speonk studio (e.g. shower venue)
 *   'mobile' → we bring it to your location / on-site (e.g. brand activation)
 */

export type Venue = 'both' | 'studio' | 'mobile'

export interface Highlight {
  emoji: string
  title: string
  desc: string
}

export interface CraftFaq {
  q: string
  a: string
}

export interface CraftParty {
  slug: string
  /** Display name, e.g. "Slime Party". */
  name: string
  /** Small eyebrow above the H1. */
  eyebrow: string
  /** Optional italic accent word(s) inside the H1 (rendered in blue italic). */
  h1Accent?: string
  metaTitle: string
  metaDescription: string
  keywords: string[]
  /** Lead paragraph under the H1. */
  intro: string
  /** One-line audience/age note shown as a chip. */
  audience: string
  /** 4 image paths under /public for the hero collage. */
  heroImages: string[]
  highlightsTitle: string
  highlights: Highlight[]
  faqs: CraftFaq[]
  /** Slugs of related craft pages to cross-link. May include 'glow-party'. */
  relatedSlugs: string[]
  venue: Venue
  ctaHeading: string
  /** schema.org Service serviceType. */
  serviceType: string
}

export const CRAFT_PARTIES: CraftParty[] = [
  // ── Arts & Crafts (general) ──
  {
    slug: 'arts-and-crafts-party',
    name: 'Arts & Crafts Party',
    eyebrow: 'Kids Craft Party · Long Island',
    h1Accent: 'Arts & Crafts',
    metaTitle: 'Kids Arts & Crafts Party — Long Island | Host Hampton',
    metaDescription:
      'Hands-on arts & crafts birthday parties for kids. Canvas painting, sand art, slime, bracelet making & more — at your home across Long Island or at our Speonk studio. Every craft is a take-home keepsake.',
    keywords: ['arts and crafts party', 'kids arts and crafts birthday party', 'craft party Long Island', 'art party kids near me', 'craft birthday party Hamptons'],
    intro:
      'A hands-on arts & crafts party the kids actually make things at. Pick your stations — canvas painting, sand art, slime, bracelet making and more — and our hosts guide every child through each one. Every craft is a keepsake they take home, which doubles as the party favor.',
    audience: 'Best for ages 3–13',
    heroImages: ['/images/gallery/venue-craft-station.webp', '/images/gallery/venue-painting-workshop.webp', '/images/gallery/activity-bracelet-making.webp', '/images/gallery/venue-activity-setup.webp'],
    highlightsTitle: 'What Makes It Special',
    highlights: [
      { emoji: '🎨', title: 'Mix & Match Stations', desc: 'Build the perfect party from our full craft menu — as many stations as your group and time allow.' },
      { emoji: '🙌', title: 'Hands-On Hosts', desc: 'We don’t just set up and step back — a host runs every station so parents can relax.' },
      { emoji: '🎁', title: 'Take-Home Keepsakes', desc: 'Every craft is finished and packed to go home. No goodie bags needed.' },
      { emoji: '🧼', title: 'Zero Cleanup', desc: 'We bring every supply, cover the surfaces, and pack it all up when the party ends.' },
    ],
    faqs: [
      { q: 'Which crafts can we choose?', a: 'Any mix from our menu — canvas painting, sand art, slime, seashell decorating, bracelet making, canvas bag and trucker hat bars, and more. We’ll suggest a combination based on the birthday child’s age and your group size.' },
      { q: 'What ages is an arts & crafts party good for?', a: 'Roughly ages 3–13. Younger kids love sand art, slime, and decorating; older kids lean into painting and jewelry making. We tailor the stations to the age group.' },
      { q: 'Do you come to us or do we come to you?', a: 'Either. We bring the whole party to your home anywhere on Long Island, or you can host at our private studio in Speonk. Same crafts, same hosts, your choice of place.' },
    ],
    relatedSlugs: ['slime-party', 'balloon-dog-painting-party', 'canvas-tote-activation'],
    venue: 'both',
    ctaHeading: 'Ready to Get Crafty?',
    serviceType: 'Kids arts and crafts party',
  },

  // ── Slime ──
  {
    slug: 'slime-party',
    name: 'Slime Party',
    eyebrow: 'Kids Craft Party · Long Island',
    h1Accent: 'Slime',
    metaTitle: 'Kids Slime Party — Long Island Mobile & Studio | Host Hampton',
    metaDescription:
      'A gooey, glittery slime party for kids. Every guest mixes, stretches, and customizes their own slime to take home. At your house across Long Island or at our Speonk studio.',
    keywords: ['slime party', 'kids slime party near me', 'slime birthday party Long Island', 'mobile slime party', 'DIY slime party kids'],
    intro:
      'The messiest fun without the mess at home. Every guest mixes, stretches, and customizes their own slime — glitter, charms, colors, scents — and takes it home in its own container. We bring everything and handle the cleanup.',
    audience: 'Best for ages 5–13',
    heroImages: ['/images/slime-party-1.jpg', '/images/slime-party-2.jpg', '/images/slime-party-3.jpg', '/images/slime-party-4.jpg'],
    highlightsTitle: 'What’s Included',
    highlights: [
      { emoji: '🟢', title: 'Make-Your-Own Slime', desc: 'Each kid builds their own batch — clear, butter, cloud, or glitter — start to finish.' },
      { emoji: '✨', title: 'Mix-Ins Galore', desc: 'Glitter, foam beads, charms, and scents to make every slime one of a kind.' },
      { emoji: '🫙', title: 'Take-Home Containers', desc: 'Every slime goes home sealed and labeled — the party favor is built in.' },
      { emoji: '🧼', title: 'We Handle the Mess', desc: 'Surface covers, aprons, and full cleanup included. Your space goes back to normal.' },
    ],
    faqs: [
      { q: 'Is the slime safe and non-toxic?', a: 'Yes — we use kid-safe, non-toxic materials, and our hosts supervise every step. We can accommodate common sensitivities; just let us know when you book.' },
      { q: 'Does the slime stain or make a mess?', a: 'We come prepared with surface covers and aprons, and our activated slime is designed not to stain. We pack up and clean everything at the end.' },
      { q: 'Can we do slime at home?', a: 'Absolutely. We bring the full slime station to your home anywhere on Long Island, or you can host at our Speonk studio.' },
    ],
    relatedSlugs: ['squishy-party', 'arts-and-crafts-party', 'balloon-dog-painting-party'],
    venue: 'both',
    ctaHeading: 'Ready to Make Some Slime?',
    serviceType: 'Kids slime party',
  },

  // ── Fluid / drip-paint balloon dog ──
  {
    slug: 'balloon-dog-painting-party',
    name: 'Balloon Dog Painting Party',
    eyebrow: 'Signature Craft · Long Island',
    h1Accent: 'Balloon Dog',
    metaTitle: 'Drip-Paint Balloon Dog Party — Fluid Art for Kids | Host Hampton',
    metaDescription:
      'Our signature: pour and drip fluid paint over a balloon-dog figure for a glossy, one-of-a-kind sculpture. A viral-worthy craft party at your home on Long Island or our Speonk studio.',
    keywords: ['balloon dog painting party', 'drip paint balloon dog', 'fluid art party kids', 'paint pour party Long Island', 'balloon dog craft'],
    intro:
      'Our signature craft — and the one everyone posts. Kids pour and drip vibrant fluid paint over a balloon-dog figure, watching the colors marble into a glossy, one-of-a-kind sculpture they take home. Equal parts art, science, and total wow.',
    audience: 'Best for ages 6–14',
    heroImages: ['/images/gallery/card-painting-party.webp', '/images/gallery/venue-craft-station.webp', '/images/gallery/venue-painting-workshop.webp', '/images/gallery/outdoor-party-setup.webp'],
    highlightsTitle: 'What Makes It Special',
    highlights: [
      { emoji: '🐩', title: 'Signature Drip Art', desc: 'Pour and drip fluid paint over a balloon-dog figure — no two ever come out the same.' },
      { emoji: '📸', title: 'Made for Photos', desc: 'The glossy, marbled results are a showstopper — and a hit on social.' },
      { emoji: '🎁', title: 'Take-Home Sculpture', desc: 'Each finished balloon dog dries and goes home as the keepsake favor.' },
      { emoji: '🧼', title: 'Mess Fully Managed', desc: 'Drop cloths, aprons, and cleanup included — we come ready for the drips.' },
    ],
    faqs: [
      { q: 'What exactly is a drip-paint balloon dog?', a: 'A balloon-dog-shaped figure that kids coat by pouring and dripping fluid acrylic paint over it. The colors marble together into a glossy, one-of-a-kind sculpture — think fluid-art pour painting, but on a fun 3D shape.' },
      { q: 'How long does the paint take to dry?', a: 'They’re touch-dry by the end of most parties. We send each one home on a tray or in packaging so it finishes drying safely.' },
      { q: 'Is it messy?', a: 'It’s gloriously drippy — which is why we bring drop cloths and aprons and handle all the cleanup. Great outdoors or in a garage/kitchen space.' },
    ],
    relatedSlugs: ['arts-and-crafts-party', 'slime-party', 'canvas-tote-activation'],
    venue: 'both',
    ctaHeading: 'Ready to Drip & Pour?',
    serviceType: 'Fluid art / balloon dog painting party',
  },

  // ── Spa ──
  {
    slug: 'spa-party',
    name: 'Spa Party',
    eyebrow: 'Kids Spa Party · Long Island',
    h1Accent: 'Spa',
    metaTitle: 'Kids Spa Party — Mini Mani, Facials & Pampering | Host Hampton',
    metaDescription:
      'A pampering kids spa party — mini manicures, face masks, robes, and glam. At your home across Long Island or our Speonk studio. Fully hosted, fully relaxing (for the parents too).',
    keywords: ['kids spa party', 'spa birthday party Long Island', 'mobile spa party kids', 'mani pedi party kids', 'pamper party Hamptons'],
    intro:
      'A little luxury for the birthday crew. Mini manicures, gentle face masks, cozy robes, and a glam station — our hosts run a calm, pampering spa experience that makes every kid feel like a VIP.',
    audience: 'Best for ages 5–13',
    heroImages: ['/images/gallery/spa-party-1.webp', '/images/gallery/spa-party-2.webp', '/images/theme-spa.webp', '/images/gallery/venue-party-setup-3.webp'],
    highlightsTitle: 'What’s Included',
    highlights: [
      { emoji: '💅', title: 'Mini Manicures', desc: 'Kid-safe polish, nail art, and a real pampering moment for every guest.' },
      { emoji: '🧖', title: 'Face Masks & Glow', desc: 'Gentle, kid-friendly face masks and a fresh-faced glow-up.' },
      { emoji: '🧴', title: 'Robes & Spa Vibes', desc: 'Cozy robes, soft music, and a calm, styled spa setup.' },
      { emoji: '💖', title: 'Fully Hosted', desc: 'Our team runs every station — setup and cleanup included.' },
    ],
    faqs: [
      { q: 'Are the products kid-safe?', a: 'Yes — we use gentle, kid-appropriate polishes and masks. Tell us about any allergies or sensitivities when you book and we’ll adjust.' },
      { q: 'Can we add crafts to a spa party?', a: 'Definitely — lip gloss making, perfume blending, and bracelet stations pair beautifully with a spa theme. Mix and match.' },
      { q: 'Home or studio?', a: 'Both. We bring the full spa setup to your home anywhere on Long Island, or host it at our Speonk studio.' },
    ],
    relatedSlugs: ['arts-and-crafts-party', 'glow-party', 'mermaid-party'],
    venue: 'both',
    ctaHeading: 'Ready for Some Pampering?',
    serviceType: 'Kids spa party',
  },

  // ── Toddler ──
  {
    slug: 'toddler-party',
    name: 'Toddler Party',
    eyebrow: 'Toddler Party · Long Island',
    h1Accent: 'Toddler',
    metaTitle: 'Toddler Birthday Party — Sensory Play & Crafts | Host Hampton',
    metaDescription:
      'A gentle, age-perfect toddler birthday party — sensory play, simple crafts, and safe, soft setups for ages 2–4. At your home on Long Island or our Speonk studio.',
    keywords: ['toddler birthday party', 'toddler party Long Island', '2 year old birthday party ideas', 'sensory party toddlers', 'first birthday and toddler party near me'],
    intro:
      'Made for the littlest guests. Soft sensory play, simple hands-on crafts, and a calm, safe setup paced just right for ages 2–4. Big fun, small mess, and a host who keeps it gentle and easy.',
    audience: 'Best for ages 2–4',
    heroImages: ['/images/theme-toddler.webp', '/images/gallery/toddler-sensory.webp', '/images/gallery/venue-activity-setup.webp', '/images/gallery/venue-party-setup-2.webp'],
    highlightsTitle: 'What’s Included',
    highlights: [
      { emoji: '🧸', title: 'Sensory Play', desc: 'Safe, tactile sensory bins and activities sized for tiny hands.' },
      { emoji: '🎨', title: 'Simple Crafts', desc: 'Easy, no-fail crafts toddlers can do with a little grown-up help.' },
      { emoji: '🛟', title: 'Safe & Soft Setup', desc: 'Gentle, padded, low-to-the-ground stations with careful supervision.' },
      { emoji: '⏱️', title: 'Right-Sized Timing', desc: 'A pace built for short attention spans — with room for snacks and naps.' },
    ],
    faqs: [
      { q: 'Is this good for a 1st or 2nd birthday?', a: 'Yes — it’s built for ages 2–4, and works beautifully for a 1st birthday with parents helping. For milestone 1st birthdays, ask about our first-birthday options too.' },
      { q: 'Do parents stay and help?', a: 'For toddlers, yes — it’s a lap-and-help age, and our hosts guide both kids and grown-ups through each activity.' },
      { q: 'Can you come to our house?', a: 'Of course. We bring the toddler setup to your home anywhere on Long Island, or you can host at our Speonk studio.' },
    ],
    relatedSlugs: ['arts-and-crafts-party', 'squishy-party', 'spa-party'],
    venue: 'both',
    ctaHeading: 'Plan a Perfect Toddler Party',
    serviceType: 'Toddler birthday party',
  },

  // ── Shower venue (studio-hosted) ──
  {
    slug: 'shower-venue',
    name: 'Baby & Bridal Shower Venue',
    eyebrow: 'Private Shower Venue · The Hamptons',
    h1Accent: 'Shower Venue',
    metaTitle: 'Baby & Bridal Shower Venue — Speonk, Hamptons | Host Hampton',
    metaDescription:
      'A private, beautifully styled shower venue in Speonk on the East End. Baby showers, bridal showers, and celebrations with an optional craft or activity bar. Book your date with a simple deposit.',
    keywords: ['baby shower venue Long Island', 'bridal shower venue Hamptons', 'shower venue Speonk', 'private party venue East End', 'shower venue near me'],
    intro:
      'A private, styled space for your baby or bridal shower on the East End. Bring your vision — we provide the beautiful setting, flexible layout, and an optional craft or activity bar (permanent jewelry, canvas totes, and more) to make it memorable. Elegant, intimate, and entirely yours.',
    audience: 'Baby showers · Bridal showers · Milestone celebrations',
    heroImages: ['/images/gallery/venue-party-setup-1.webp', '/images/gallery/venue-party-setup-4.webp', '/images/gallery/venue-party-setup-5.webp', '/images/gallery/venue-party-setup-6.webp'],
    highlightsTitle: 'Why Host Your Shower Here',
    highlights: [
      { emoji: '🥂', title: 'Private & Exclusive', desc: 'A beautifully styled studio that’s all yours — no shared spaces, no outside noise.' },
      { emoji: '🎀', title: 'Flexible Layout', desc: 'Style it your way — bring your own decor and caterer, or add our touches.' },
      { emoji: '💎', title: 'Optional Activity Bar', desc: 'Add permanent jewelry, a canvas tote bar, or a craft station as a memorable guest activity.' },
      { emoji: '🧹', title: 'Setup & Cleanup Handled', desc: 'You enjoy the day — we handle the space before and after.' },
    ],
    faqs: [
      { q: 'How many guests fit?', a: 'Our studio comfortably hosts intimate to mid-size showers. Tell us your headcount and we’ll confirm the right layout and timing.' },
      { q: 'Can we bring our own food and decor?', a: 'Yes — bring your caterer and decor, or ask us about add-ons. The space is flexible and yours to style.' },
      { q: 'What activities can we add?', a: 'Popular add-ons include a permanent jewelry bar, canvas tote decorating, and craft stations — a lovely keepsake activity for shower guests.' },
    ],
    relatedSlugs: ['canvas-tote-activation', 'arts-and-crafts-party'],
    venue: 'studio',
    ctaHeading: 'Book Your Shower Date',
    serviceType: 'Private shower venue rental',
  },

  // ── Mermaid ──
  {
    slug: 'mermaid-party',
    name: 'Mermaid Party',
    eyebrow: 'Themed Craft Party · Long Island',
    h1Accent: 'Mermaid',
    metaTitle: 'Mermaid Birthday Party — Under-the-Sea Crafts | Host Hampton',
    metaDescription:
      'An under-the-sea mermaid party with seashell decorating, sand art, shimmer glam, and ocean crafts. At your home across Long Island or our Speonk studio.',
    keywords: ['mermaid party', 'mermaid birthday party Long Island', 'under the sea party kids', 'mermaid craft party near me', 'ocean theme party kids'],
    intro:
      'Dive into an under-the-sea celebration. Seashell decorating, sand art, shimmer glam, and ocean-inspired crafts — all styled in mermaid colors and run by our hosts. Perfect for beach-house and shore-town birthdays.',
    audience: 'Best for ages 4–12',
    heroImages: ['/images/gallery/venue-craft-station.webp', '/images/gallery/venue-activity-setup.webp', '/images/gallery/outdoor-party-setup.webp', '/images/theme-spa.webp'],
    highlightsTitle: 'What’s Included',
    highlights: [
      { emoji: '🐚', title: 'Seashell Decorating', desc: 'Glam real seashells with gems, paint, and shimmer to take home.' },
      { emoji: '🏖️', title: 'Sand Art', desc: 'Layer ocean-colored sand into bottles and keepsakes — mess-free.' },
      { emoji: '✨', title: 'Mermaid Glam', desc: 'Shimmer, hair tinsel, and mermaid-color face gems for the full look.' },
      { emoji: '🎨', title: 'Ocean Crafts', desc: 'Under-the-sea themed making, styled in mermaid colors throughout.' },
    ],
    faqs: [
      { q: 'What crafts come with a mermaid party?', a: 'Seashell decorating, sand art, and shimmer glam are the core — and you can add canvas painting, bracelet making, or slime in ocean colors.' },
      { q: 'Is it good for a beach-house party?', a: 'Perfectly — the seashell and sand-art stations are a natural fit for shore-town and beach-house birthdays across the East End and South Shore.' },
      { q: 'Home or studio?', a: 'Both. We bring the mermaid setup to your home anywhere on Long Island, or host at our Speonk studio.' },
    ],
    relatedSlugs: ['spa-party', 'arts-and-crafts-party', 'squishy-party'],
    venue: 'both',
    ctaHeading: 'Ready to Dive In?',
    serviceType: 'Mermaid themed kids party',
  },

  // ── Squishy ──
  {
    slug: 'squishy-party',
    name: 'Squishy Party',
    eyebrow: 'Kids Craft Party · Long Island',
    h1Accent: 'Squishy',
    metaTitle: 'Squishy Party — DIY Squishies & Sensory Crafts | Host Hampton',
    metaDescription:
      'A DIY squishy party where kids make and decorate their own squishies and sensory toys. Soft, satisfying, take-home fun — at your house on Long Island or our Speonk studio.',
    keywords: ['squishy party', 'DIY squishy party kids', 'squishy making party', 'sensory craft party Long Island', 'squishmallow style party near me'],
    intro:
      'Soft, squishy, and endlessly satisfying. Kids make and decorate their own squishies and sensory toys — foam, air-dry, and puff crafts they can squeeze all the way home. A fresh twist on the slime-and-sensory craze.',
    audience: 'Best for ages 5–12',
    heroImages: ['/images/slime-party-3.jpg', '/images/gallery/venue-craft-station.webp', '/images/slime-party-1.jpg', '/images/gallery/venue-activity-setup.webp'],
    highlightsTitle: 'What’s Included',
    highlights: [
      { emoji: '🧽', title: 'Make-Your-Own Squishies', desc: 'Kids craft and paint their own squishies and sensory toys from scratch.' },
      { emoji: '🎨', title: 'Decorate & Personalize', desc: 'Puff paint, colors, and characters to make each one unique.' },
      { emoji: '🫧', title: 'Satisfying Sensory Fun', desc: 'Soft, squeezable, and calming — a sensory-friendly favorite.' },
      { emoji: '🎁', title: 'Take-Home Squishy', desc: 'Every creation goes home as the party favor.' },
    ],
    faqs: [
      { q: 'What is a squishy party?', a: 'Kids make and decorate their own squishy, squeezable sensory toys — using foam, air-dry, and puff-paint crafts. It’s a hands-on, take-home twist on the squishy/sensory trend.' },
      { q: 'How is it different from a slime party?', a: 'Slime is gooey and mix-based; squishies are soft, moldable toys kids build and paint. Many families book both stations together.' },
      { q: 'Can you host at our home?', a: 'Yes — we bring the full squishy station to your home anywhere on Long Island, or you can host at our Speonk studio.' },
    ],
    relatedSlugs: ['slime-party', 'arts-and-crafts-party', 'toddler-party'],
    venue: 'both',
    ctaHeading: 'Ready to Get Squishy?',
    serviceType: 'DIY squishy craft party',
  },

  // ── Canvas tote activation (brand / corporate / event) ──
  {
    slug: 'canvas-tote-activation',
    name: 'Canvas Tote Activation',
    eyebrow: 'Brand & Event Activation · NY / Long Island',
    h1Accent: 'Tote',
    metaTitle: 'Canvas Tote Bar Activation — Brand & Event Experiences | Host Hampton',
    metaDescription:
      'A custom canvas tote bar activation for brand launches, corporate events, pop-ups, and private parties. Guests personalize a tote with patches, paint & press — on-site anywhere in NY & Long Island.',
    keywords: ['canvas tote activation', 'tote bag bar event', 'brand activation Long Island', 'corporate event craft station NYC', 'customization bar pop up'],
    intro:
      'An interactive, on-brand craft bar your guests will actually remember. Attendees personalize a premium canvas tote — iron-on patches, paint, and press — as a wearable takeaway. Perfect for brand launches, corporate events, pop-ups, storefronts, and private parties. We bring the full station and staff to your location.',
    audience: 'Brand launches · Corporate events · Pop-ups · Private parties',
    heroImages: ['/images/gallery/product-pouches-1.webp', '/images/gallery/product-pouches-2.webp', '/images/gallery/card-trucker-hat-bar.webp', '/images/gallery/venue-craft-station.webp'],
    highlightsTitle: 'Why It Works as an Activation',
    highlights: [
      { emoji: '👜', title: 'Wearable Takeaway', desc: 'Guests leave wearing your brand — a tote that keeps working long after the event.' },
      { emoji: '🎨', title: 'On-Brand Customization', desc: 'Custom patches, colors, and designs matched to your brand or theme.' },
      { emoji: '🧑‍🎨', title: 'Fully Staffed On-Site', desc: 'Our team brings the station, runs the bar, and keeps the line moving.' },
      { emoji: '📸', title: 'Content-Ready Moment', desc: 'A styled, hands-on station that draws a crowd and earns social posts.' },
    ],
    faqs: [
      { q: 'Where can you run a tote activation?', a: 'On-site at your venue anywhere in New York and Long Island — offices, storefronts, event spaces, pop-ups, and private homes. We bring everything.' },
      { q: 'Can it be branded to our company?', a: 'Yes — we coordinate custom patches, colors, and designs to match your brand or campaign. Ask us about lead times for custom pieces.' },
      { q: 'How many guests can you handle?', a: 'We scale the number of stations and staff to your expected headcount and event window. Share your guest count and we’ll spec it out.' },
    ],
    relatedSlugs: ['arts-and-crafts-party', 'shower-venue'],
    venue: 'mobile',
    ctaHeading: 'Plan Your Brand Activation',
    serviceType: 'Brand / event craft activation',
  },
]

export function getCraftParty(slug: string): CraftParty | undefined {
  return CRAFT_PARTIES.find(c => c.slug === slug)
}

/** Display name for a related slug, including the bespoke /glow-party page. */
export function craftDisplayName(slug: string): string {
  if (slug === 'glow-party') return 'Glow Party'
  return getCraftParty(slug)?.name ?? slug
}
