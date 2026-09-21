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
    ]
  },
}

module.exports = nextConfig
