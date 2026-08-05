/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
    ]
  },
}

module.exports = nextConfig
