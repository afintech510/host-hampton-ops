/**
 * seed_agent_memory.js
 * Seeds agent_memory table from brand_context.md data.
 * Run on VPS: node /tmp/seed_agent_memory.js
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const memories = [

  // ── BRAND NAMESPACE ─────────────────────────────────────────────

  {
    namespace: 'brand',
    key: 'voice',
    description: 'Brand tone, style, core identity, and language rules for all agents',
    value: {
      tone: 'Upbeat, glamorous, accommodating, magical, modern, chic',
      style: 'Focus on high-end styling and stress-free experiences. Use descriptive premium words.',
      persona: 'Sound like a high-end yet highly approachable local event planner.',
      founders: 'Founded by Manorville residents Adam and Allie Larkin.',
      core_values: {
        local_family_owned: 'Always feel locally invested and neighborly.',
        parent_centric: 'Let us handle the details while you relax and enjoy the celebration. Highlight Coffee Bar, Open Fridge, Party Helpers.',
        child_centric: 'Create magical, immersive experiences where children feel like superstars.',
        community_centric: 'Foster local connections for Hamptons/Long Island families through workshops, mom meetups, vendor pop-ups.'
      },
      preferred_words: ['unforgettable', 'fabulous', 'pampering', 'exclusive', 'picture-perfect', 'beautiful', 'real', 'genuine'],
      forbidden_words: ['amazing', 'incredible', 'game-changer', 'seamless', 'effortless'],
      business_info: {
        name: 'Host Hampton',
        address: '295 Montauk Hwy, Suite 7, Speonk, NY 11972',
        phone: '(631) 998-9325',
        website: 'hosthampton.com',
        venue_size: '1,500 sq ft modern event space'
      }
    }
  },

  {
    namespace: 'brand',
    key: 'hashtags',
    description: 'Approved hashtag sets by category for social posts',
    value: {
      primary: ['#HostHampton', '#HamptonsParties', '#SpeonkNY', '#LongIslandEvents'],
      audience: ['#HamptonsMoms', '#PartyRoomRental', '#KidsPartiesLI'],
      services: ['#PermanentJewelryLI', '#HamptonsPopUp']
    }
  },

  // ── SERVICES NAMESPACE ──────────────────────────────────────────

  {
    namespace: 'services',
    key: 'packages',
    description: 'Full-service hosted party package tiers with pricing and inclusions',
    value: {
      mini_party:      { name: 'Mini-Party Package', price: 650,  duration: '90 min',  guests: 7,  includes: [] },
      my_fav_10:       { name: 'My Fav 10',          price: 800,  duration: '2 hours', guests: 10, includes: [] },
      dazzling_dozen:  { name: 'Dazzling Dozen',     price: 1045, duration: '2 hours', guests: 12, includes: ['Balloon Tower', 'Goody Bags'] },
      fab_15:          { name: 'Fab 15',             price: 1295, duration: '2 hours', guests: 15, includes: ['Balloon Tower', 'Goody Bags', '$125 add-on credit'] },
      all_out:         { name: 'ALL OUT',            price: 1850, duration: '2 hours', guests: 15, includes: ['Balloon Tower', 'Premium Goody Bags', 'Photo Booth', '$500 add-on credit'] },
      additional_guest_fee: '$35–$45 per guest depending on tier'
    }
  },

  {
    namespace: 'services',
    key: 'themes',
    description: 'All hosted party themes with pricing and description',
    value: {
      glow_party:        { price: 950, description: 'Black lights, glow face painting, neon favors, dance music' },
      custom_theme:      { price: 925, description: 'Fully personalized design and activities' },
      kpop_demon_hunter: { price: 900, description: 'Neon lights, glow stick decorating, supernatural/fierce style' },
      slime_party:       { price: 900, description: 'Custom slime creations with add-ins' },
      trucker_hat_party: { price: 900, description: 'Designing custom trucker hats with iron-on patches' },
      swiftie_party:     { price: 850, description: 'Karaoke, friendship bracelets, hair tinsel, sparkle' },
      spa_party:         { price: 850, description: 'Ultimate pampering, manicures, robes, hair/makeup' },
      barbie_party:      { price: 850, description: 'Fashion, glam, pink decor' },
      unicorn_party:     { price: 850, description: 'Sparkles, rainbows, unicorn crafts' },
      race_car_party:    { price: 850, description: 'High-energy, fast-paced racing vibes' },
      toddler_party:     { price: 850, description: 'Safe, colorful soft play setup' },
      sweets_n_treats:   { price: 800, description: 'Sugary celebration focused on sweet treats' }
    }
  },

  {
    namespace: 'services',
    key: 'rentals',
    description: 'DIY room and studio rental options with pricing',
    value: {
      weekday_3hr:              { price: 450,  description: '3hr Weekday Party Room Rental' },
      weekend_3hr:              { price: 575,  description: '3hr Weekend Party Room Rental' },
      exclusive_12hr:           { price: 975,  description: '12hr Exclusive Rental' },
      studio_per_hour:          { price: 75,   description: 'Studio Rental — photography, beauty services, workshops, tutoring' },
      additional_hour_weekday:  { price: 75 },
      additional_hour_weekend:  { price: 100 },
      security_deposit:         { price: 500,  description: 'Refundable security deposit' },
      use_cases: ['baby showers', 'intimate celebrations', 'DIY party room', 'full-service hosted events']
    }
  },

  {
    namespace: 'services',
    key: 'addons',
    description: 'All available add-ons and upsell items with pricing',
    value: {
      decor: {
        double_arch_backdrop_and_balloon_arches: 250,
        leaning_balloon_tower_with_number: 185,
        balloon_garland_6ft: 150,
        balloon_tower_6ft: 120,
        room_setup_decor: 125,
        barbie_box: 100,
        linen_rentals: 95,
        soft_play_setup: 350
      },
      sweet_treats: {
        custom_treat_table: 495,
        candy_wall: 200,
        sheet_cake: 110,
        half_sheet_cake: 80,
        cake_pops_per_dozen: 60,
        macarons: 45,
        chocolate_covered_pretzels_per_dozen: 30
      },
      favors: {
        premium_goody_bags: 200,
        goody_bags: 100,
        curated_gift_basket: 195
      },
      entertainment: {
        character_visit: 395,
        face_painter: 295,
        cake_smash_photoshoot: 250,
        full_cleanup_service: 125,
        party_helper_per_person: 25,
        garbage_service: 35
      },
      permanent_jewelry: {
        mommy_and_me_bracelet_set: 100,
        note: 'Also available as standalone service or add-on; boutique features Stella Bella Beauti'
      }
    }
  },

  {
    namespace: 'services',
    key: 'catering',
    description: 'All food and beverage options with pricing',
    value: {
      beverages: {
        open_fridge: 125,
        sodas_and_seltzers: 100,
        coffee_bar: 75
      },
      pizza_and_snacks: {
        pizza_party_spread_per_person: 10,
        assorted_pies_per_person: 8,
        large_cheese_pizza: 25,
        gf_personal_pizza: 15,
        specialty_pizza: 35,
        popcorn_bar: 85,
        dunkin_donuts_munchkins: 25
      },
      hot_food: {
        chicken_parmigiana: 125,
        pasta_tray: 120,
        chicken_fingers_and_fries: 100,
        mozzarella_sticks: 50,
        garlic_knots: 35
      },
      cold_trays: {
        antipasto_salad: 85,
        fruit_platter: 75,
        salad_tray: 60,
        bagel_platter: 50
      }
    }
  },

  {
    namespace: 'services',
    key: 'activities',
    description: 'Standard and premium activities available at parties',
    value: {
      standard_included: [
        'DIY Sunglasses', 'Barbie Fashion Show', 'Glitter Tattoos', 'Glittery Makeup',
        'Hair Makeover', 'Hair Tinsel/Beaded Braids', 'Kiddie Karaoke',
        'Make Your Own Bracelets', 'Unicorn Craft'
      ],
      premium_with_select_packages: [
        'Canvas Painting', 'Custom Mini-Pouch', 'Donut/Fake Cake Decorating',
        'Make Your Own Nail Polish/Slime', 'Manicure', 'Photo Booth',
        'Sand Art', 'Scrapbooking', 'Trucker Hat Bar'
      ]
    }
  },

  // ── CAMPAIGNS NAMESPACE ─────────────────────────────────────────

  {
    namespace: 'campaigns',
    key: 'target_segments',
    description: 'Primary audience segments and how to reach them',
    value: {
      toddler_parents: {
        description: 'Parents/Moms of Toddlers',
        reach_via: 'Weekday morning events, toddler parties, soft play',
        key_offers: ["Moms in the Morning $10", "Toddler Party $850", "Soft Play Setup add-on $350"]
      },
      kids_tweens_parents: {
        description: 'Parents of Kids/Tweens ages 5–12',
        reach_via: 'Themed birthday packages, Instagram, Facebook, local school groups',
        key_offers: ['All party themes $800–$950', 'Package tiers $650–$1,850', 'Character Visit $395 upsell']
      },
      local_adult_women: {
        description: 'Local Adult Women',
        reach_via: 'Evening craft events, permanent jewelry promos, medium readings, Girls Night Out',
        key_offers: ['Girls Night Out $25+', 'Permanent Jewelry', 'Sip & Script workshops $65–75', 'Spirit Medium $50']
      },
      local_vendors_community: {
        description: 'Local Vendors and Community Organizations',
        reach_via: 'Venue rental marketing, Nextdoor, local business groups',
        key_offers: ['Studio Rental $75/hr', 'Exclusive Rental $975', 'Fundraiser/pop-up venue']
      }
    }
  },

  // ── SERVICES — BOOKING LINKS ────────────────────────────────────

  {
    namespace: 'services',
    key: 'booking_links',
    description: 'HoneyBook booking/inquiry links for each service category',
    value: {
      kids_party:     'https://hosthampton.com/book',
      room_rental:    'https://hosthampton.com/book',
      studio_rental:  'https://hosthampton.com/book',
      jewelry:        'https://hosthampton.com/book',
      events:         'https://hosthampton.com/book',
      general:        'https://hosthampton.com/book',
      note: 'Placeholder URLs — update with live HoneyBook project links when available'
    }
  },

  {
    namespace: 'campaigns',
    key: 'recurring',
    description: 'Evergreen and recurring event campaigns',
    value: {
      moms_in_the_morning: {
        price: 10,
        description: 'Open soft play for toddlers with unlimited coffee and mom talk.',
        cadence: 'Recurring weekday mornings',
        audience: 'toddler_parents',
        effectiveness: 'Highly effective for local community building'
      },
      girls_night_out: {
        price_from: 25,
        description: 'Adult-focused craft nights (painting, crafts). 10% off Permanent Jewelry during event.',
        cadence: 'Regular evening events',
        audience: 'local_adult_women'
      },
      specialty_workshops: {
        examples: [
          'Spirit Medium Kayla Group Reading — $50',
          'Sip & Script Modern Calligraphy (BYOB) — $65–75',
          'Character Meet-and-Greets (e.g. Ms. Rachel)',
          'Seasonal holiday celebrations',
          "Galentine's events"
        ],
        audience: 'local_adult_women + community'
      },
      fundraisers_and_popups: {
        description: 'Host Hampton as community hub for LI/Hamptons fundraising and local vendor pop-ups.',
        audience: 'local_vendors_community',
        note: 'Leverages space as central community pillar'
      }
    }
  }

]

async function seed() {
  console.log(`Seeding ${memories.length} agent_memory entries...`)

  for (const mem of memories) {
    const { error } = await supabase
      .from('agent_memory')
      .upsert(
        {
          namespace: mem.namespace,
          key: mem.key,
          value: mem.value,
          description: mem.description,
          updated_by: 'HAMPTON',
          version: 1
        },
        { onConflict: 'namespace,key' }
      )

    if (error) {
      console.error(`  ✗ ${mem.namespace}.${mem.key}: ${error.message}`)
    } else {
      console.log(`  ✓ ${mem.namespace}.${mem.key}`)
    }
  }

  console.log('\nDone.')
}

seed().catch(console.error)
