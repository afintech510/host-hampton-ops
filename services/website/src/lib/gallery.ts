/**
 * The photo gallery: every image on /gallery and the homepage strip.
 *
 * Real photos from our own parties and the studio (Allie's phone, curated
 * 2026-09 → 2026-10). Two rules for adding one:
 *
 *  - No identifiable customer children. A child seen from behind, or a shot
 *    cropped to hands and the table, is fine; a face is not, unless the parent
 *    has said yes. Several shots here are deliberately cropped for that reason.
 *  - Convert to WebP with the metadata DROPPED (iPhone originals carry GPS,
 *    and some were taken at customers' homes). ~1200px on the long edge.
 *
 * `w`/`h` are the file's real pixel size so the masonry grid reserves the right
 * space before the image loads.
 */

export type GalleryCategory = 'studio' | 'at-home' | 'spa' | 'crafts' | 'events'

export const GALLERY_CATEGORIES: { id: GalleryCategory; label: string }[] = [
  { id: 'studio',  label: 'Studio Parties' },
  { id: 'at-home', label: 'At-Home Parties' },
  { id: 'spa',     label: 'Spa Parties' },
  { id: 'crafts',  label: 'Crafts & Activities' },
  { id: 'events',  label: 'Events & Classes' },
]

export interface GalleryPhoto {
  src: string
  alt: string
  category: GalleryCategory
  w: number
  h: number
}

const g = (file: string) => `/images/gallery/${file}.webp`

export const GALLERY_PHOTOS: GalleryPhoto[] = [
  // ── Studio parties ──
  { src: g('barbie-setup'),                       alt: 'Barbie birthday party table set in the Host Hampton studio',              category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-disco-birthday-table'), alt: 'Disco ball birthday table runner with party favors',                      category: 'studio',  w: 900,  h: 1200 },
  { src: g('venue-construction-party'),           alt: 'Construction themed birthday party setup in the studio',                 category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-luau-table'),          alt: 'Luau themed party table with tropical leaves and flowers',               category: 'studio',  w: 900,  h: 1200 },
  { src: g('kpop-setup'),                         alt: 'K-pop themed party backdrop and candy cart',                             category: 'studio',  w: 900,  h: 1211 },
  { src: g('barbie-photo-booth'),                 alt: 'Barbie light-up photo booth at a studio party',                          category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-birthday-welcome-sign'), alt: 'Chalkboard birthday welcome sign at the studio door',                   category: 'studio',  w: 900,  h: 1200 },
  { src: g('venue-party-setup-5'),                alt: 'Construction party table with hard hats and a blue balloon garland',     category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-sensory-tables'),      alt: 'Studio set up with sensory play tables for a toddler party',             category: 'studio',  w: 900,  h: 1200 },
  { src: g('venue-activity-setup'),               alt: 'Neon Happy Birthday sign in the party studio',                           category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-cupcake-decorating'),  alt: 'Cupcake decorating table with piping bags and flamingo toppers',         category: 'studio',  w: 1200, h: 800 },
  { src: g('venue-party-setup-6'),                alt: 'Low party table with floor cushions and striped plates',                 category: 'studio',  w: 900,  h: 1211 },
  { src: g('glow-accessories'),                   alt: 'Glow party accessories: star glasses and light-up favors',               category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-personalized-coloring-pages'), alt: 'Personalized birthday coloring pages for party guests',         category: 'studio',  w: 900,  h: 1200 },
  { src: g('venue-party-setup-1'),                alt: 'Studio party room with play tables and decorations',                     category: 'studio',  w: 800,  h: 1076 },
  { src: g('toddler-sensory'),                    alt: 'Toddler sensory bin table with trucks',                                  category: 'studio',  w: 900,  h: 1211 },
  { src: g('gallery-studio-party-snack-spread'),  alt: 'Party snack spread with chips, crackers and dips',                        category: 'studio',  w: 900,  h: 1200 },
  { src: g('venue-party-setup-3'),                alt: 'Puppy party favors and treats on the dessert table',                     category: 'studio',  w: 800,  h: 1076 },

  // ── At-home (mobile) parties ──
  { src: g('mobile-party-tent-tables'),           alt: 'Backyard party tent with pink tables set for a kids birthday party',     category: 'at-home', w: 1200, h: 1600 },
  { src: g('mobile-party-outdoor-table'),         alt: 'Low picnic table with pink cushions set up on a backyard lawn',          category: 'at-home', w: 900,  h: 1200 },
  { src: g('mobile-party-bracelet-station'),      alt: 'Bracelet making station with beads, charms and cords at a mobile party', category: 'at-home', w: 900,  h: 1200 },
  { src: g('outdoor-party-setup'),                alt: 'Outdoor party table with purple runner and paper fans',                  category: 'at-home', w: 900,  h: 1211 },
  { src: g('mobile-party-jelly-bag-craft'),       alt: 'Personalized jelly bag craft decorated with letter charms',              category: 'at-home', w: 1200, h: 1600 },
  { src: g('activity-bracelet-making'),           alt: 'Bracelet making table set up outdoors',                                  category: 'at-home', w: 900,  h: 1211 },
  { src: g('mobile-party-favor-detail'),          alt: 'Party favor tray with a personalized bag charm',                         category: 'at-home', w: 1200, h: 1600 },

  // ── Spa parties ──
  { src: g('mobile-spa-outdoor-table'),           alt: 'Outdoor spa party table with mirrors and cushions on the lawn',          category: 'spa',     w: 900,  h: 1200 },
  { src: g('mobile-spa-nail-station'),            alt: 'Mobile spa party nail station with polish rack and nail dryer',          category: 'spa',     w: 1200, h: 1600 },
  { src: g('spa-party-1'),                        alt: 'Pink spa party tables set in the studio',                                category: 'spa',     w: 900,  h: 1211 },
  { src: g('mobile-spa-table-setting'),           alt: 'Spa party table set with mirrors, spa headbands and pink towels',        category: 'spa',     w: 1200, h: 1600 },
  { src: g('gallery-spa-mini-manicure'),          alt: 'A young guest getting a mini manicure at the studio nail bar',           category: 'spa',     w: 900,  h: 1200 },
  { src: g('mobile-spa-glam-vanity'),             alt: 'Glam vanity with light-up mirror and birthday letter board',             category: 'spa',     w: 1200, h: 1600 },
  { src: g('mobile-spa-glam-detail'),             alt: 'Spa party lip gloss and sponges on a sparkle tablecloth',                category: 'spa',     w: 1200, h: 1600 },

  // ── Crafts & activities ──
  { src: g('gallery-activity-fairy-garden-craft'), alt: 'Fairy garden craft with moss, fences and tiny birdhouses',              category: 'crafts',  w: 1200, h: 1056 },
  { src: g('venue-painting-workshop'),            alt: 'Canvas painting party table with easels and paint',                      category: 'crafts',  w: 900,  h: 1211 },
  { src: g('patch-bar-display'),                  alt: 'Patch bar display of chenille and embroidered patches',                  category: 'crafts',  w: 900,  h: 1200 },
  { src: g('gallery-activity-beading-table'),     alt: 'Beading craft table with bowls of beads and charms',                     category: 'crafts',  w: 900,  h: 1200 },
  { src: g('donut-decorating'),                   alt: 'Donut decorating activity with icing and sprinkles',                     category: 'crafts',  w: 900,  h: 1211 },
  { src: g('gallery-activity-sand-art-station'),  alt: 'Sand art station with bowls of colored sand',                            category: 'crafts',  w: 900,  h: 1200 },
  { src: g('gallery-activity-cookie-decorating'), alt: 'Cookie decorating table with icing bags',                                category: 'crafts',  w: 900,  h: 1200 },
  { src: g('product-pouches-1'),                  alt: 'Personalized canvas pouches decorated with letter patches',              category: 'crafts',  w: 800,  h: 1076 },
  { src: g('gallery-activity-patch-bar-table'),   alt: 'Table runner covered in patches and pins for a patch bar',               category: 'crafts',  w: 900,  h: 1200 },
  { src: g('gallery-activity-kids-craft-table'),  alt: 'Kids craft table with paper, pom-poms and markers',                      category: 'crafts',  w: 1200, h: 585 },
  { src: g('venue-craft-station'),                alt: 'Decorate-a-house craft station',                                         category: 'crafts',  w: 900,  h: 1211 },
  { src: g('gallery-activity-bucket-painting'),   alt: 'Bucket painting craft with paint brushes',                               category: 'crafts',  w: 1200, h: 900 },
  { src: g('patch-pouch-personalized'),           alt: 'Pink pouch personalized with rainbow, star and letter patches',          category: 'crafts',  w: 1200, h: 1600 },
  { src: g('gallery-activity-fairy-garden-supplies'), alt: 'Fairy garden craft supplies: moss, gems and birdhouses',             category: 'crafts',  w: 1200, h: 900 },
  { src: g('gallery-activity-birthday-banner-craft'), alt: 'Happy Birthday banner craft kit laid out on the table',              category: 'crafts',  w: 900,  h: 1200 },
  { src: g('venue-party-setup-2'),                alt: 'Painting party easels lined up on a red table',                          category: 'crafts',  w: 800,  h: 1076 },
  { src: g('gallery-activity-decorated-cupcakes'), alt: 'Holiday decorated cupcakes',                                            category: 'crafts',  w: 900,  h: 1200 },
  { src: g('gallery-activity-craft-supply-trays'), alt: 'Craft supply trays with pom-poms and pipe cleaners',                    category: 'crafts',  w: 900,  h: 1200 },
  { src: g('gallery-activity-pom-pom-craft-kit'), alt: 'Pom-pom, pipe cleaner and glue craft kit',                               category: 'crafts',  w: 900,  h: 1200 },
  { src: g('gallery-activity-craft-flat-lay'),    alt: 'Overhead view of a kids craft table',                                    category: 'crafts',  w: 900,  h: 1200 },

  // ── Events, classes and the studio itself ──
  { src: g('gallery-event-girls-night-out'),      alt: 'Girls Night Out event in the Host Hampton studio',                       category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-event-painted-pumpkins'),     alt: 'Painted pumpkins on hay bales for a fall event',                         category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-event-embroidery-workshop'),  alt: 'Embroidery hoop workshop in progress',                                   category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-studio-holiday-trees'),       alt: 'Disco ball Christmas trees decorating the studio',                       category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-event-fitness-class'),        alt: 'Fitness class in the open studio space',                                 category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-studio-storefront'),          alt: 'Host Hampton storefront on Montauk Highway in Speonk',                    category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-studio-shop-interior'),       alt: 'Inside the Host Hampton studio and shop',                                category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-studio-exterior'),            alt: 'Host Hampton studio entrance',                                           category: 'events',  w: 900,  h: 1200 },
  { src: g('gallery-studio-coming-soon-owners'),  alt: 'The owners outside Host Hampton before opening day',                     category: 'events',  w: 900,  h: 1200 },
]

/** The homepage strip: a hand-picked spread across party types. */
export const GALLERY_HOME_PICKS: string[] = [
  g('barbie-setup'),
  g('mobile-party-tent-tables'),
  g('gallery-activity-fairy-garden-craft'),
  g('mobile-spa-outdoor-table'),
  g('gallery-studio-disco-birthday-table'),
  g('patch-bar-display'),
  g('venue-construction-party'),
  g('mobile-spa-nail-station'),
]
