/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // ESLint was newly added (.eslintrc.json) with pre-existing lint debt across
  // the codebase. Keep `next build` (and the deploy build) from failing on it;
  // lint runs separately in CI as a non-blocking report until the debt clears.
  eslint: { ignoreDuringBuilds: true },
  images: {
    domains: ['ychnlroczjhwimouecxz.supabase.co'],
    formats: ['image/webp'],
  },
  async redirects() {
    return [
      // cm-cheer pages are retired but kept in the repo as a template. Redirect
      // (temporary) to the fundraiser page instead of serving/deleting them.
      { source: '/cm-cheer', destination: '/fundraiser', permanent: false },
      { source: '/cm-cheer/order', destination: '/fundraiser', permanent: false },
      { source: '/cm-cheer/orders', destination: '/fundraiser', permanent: false },

      // `/vendor-registration` is the SPRING Market vendor form. It stayed live
      // and indexable long after that market passed, still selling a $46.35
      // booth for an event in March, because the market's name was hard-coded
      // into the page rather than read from a registry. Two real vendors paid
      // through it.
      //
      // Point it at the current market's form. Temporary (307), not permanent:
      // the destination changes every year, and a 301 would be cached in
      // browsers and search indexes long after this market is over.
      { source: '/vendor-registration', destination: '/christmas-market/vendors', permanent: false },

      // ── Previous-site URLs, from the GSC "Not found (404)" export 2026-09-22 ──
      //
      // 44 URLs from the pre-Next site still carry inbound links and were still
      // being crawled as recently as 2026-09-01. These are PERMANENT (301): the
      // old site is gone and is not coming back, so we want the equivalence
      // recorded in the index rather than re-crawled forever.
      //
      // Only mapped where a GENUINE equivalent exists. The ~20 dead
      // `/gift-shop/p/*` clothing products (white-fringe-sweater, leopard-
      // slippers, witch-hat…) are deliberately NOT redirected — that retail line
      // no longer exists, and pointing them at an unrelated page is a soft-404
      // that Google discards anyway while costing a real visitor a wasted click.
      // A 404 is the honest, correct answer for a page with no successor.
      { source: '/home', destination: '/', permanent: true },
      { source: '/calendar-of-events', destination: '/events', permanent: true },
      { source: '/party-services', destination: '/party-packages', permanent: true },
      { source: '/privacy-policy-sms', destination: '/privacy-policy', permanent: true },
      { source: '/party-contract', destination: '/terms-of-service', permanent: true },
      { source: '/thank-you', destination: '/', permanent: true },

      // The old store sold workshops and ticketed nights (embroidery workshop,
      // bitchy bingo, moms-in-the-morning, February break drop-offs) — that is
      // what `/events` is now. Safe to wildcard: no `/store` route exists.
      { source: '/store', destination: '/events', permanent: true },
      { source: '/store/p/:slug*', destination: '/events', permanent: true },

      // `/classes` has no [slug] route, so this wildcard shadows no real page —
      // but `:slug*` matches ZERO segments, so it matched `/classes` itself and
      // redirected it to `/classes`: an infinite loop, and GSC's "Redirect
      // error". `:slug+` requires at least one segment.
      //
      // Destination is `/events`, not `/classes`: `/classes` is itself a
      // redirect now, so pointing here would make every old class URL a
      // two-hop chain. Send it to the page that answers with a 200.
      { source: '/classes/:slug+', destination: '/events', permanent: true },

      // ── Route-level redirect stubs, moved here from their page.tsx ──
      //
      // These three paths each had a `page.tsx` whose whole body was a
      // `redirect()`/`permanentRedirect()` call. On a statically rendered page
      // that produces the redirect STATUS with NO `Location` header — a dead
      // end for a browser and a crawler alike, and `s-maxage=31536000` meant it
      // was cached that way for a year. A redirect declared here emits the
      // header correctly. The stub pages stay in the tree (unreachable, since
      // these rules run before routing) so `STATIC_ROUTE_PATTERNS` in
      // `lib/content/slugSafety.ts` keeps matching the filesystem.
      { source: '/classes', destination: '/events', permanent: true },
      { source: '/party-add-ons', destination: '/kids-party-menu', permanent: true },
      { source: '/esm-sharks/order', destination: '/esm-sharks', permanent: false },

      // The spring market is over and the vendor form already points at the
      // current one. Send the market's own old URLs to the events listing
      // rather than to a specific market that will itself expire.
      { source: '/spring-market', destination: '/events', permanent: true },

      // NOTE: `/events/:slug` is a LIVE dynamic route backed by the `events`
      // table — a wildcard here would break every real event page on the site.
      // Only the specific dead slugs from the export are listed, one by one.
      { source: '/events/spring-market', destination: '/events', permanent: true },
      { source: '/events/grand-opening', destination: '/events', permanent: true },
      { source: '/events/halloween-celebration', destination: '/events', permanent: true },
      { source: '/events/girls-night-out', destination: '/events', permanent: true },
      { source: '/events/hang-out-with-ms-rachel', destination: '/events', permanent: true },
      { source: '/events/chunky-pumpkins-workshop', destination: '/events', permanent: true },
      { source: '/events/cake-decorating-with-piping-plover', destination: '/events', permanent: true },
      { source: '/events/drop-off-design-your-own-beach-bag-keychains', destination: '/events', permanent: true },
    ]
  },
}

module.exports = nextConfig
