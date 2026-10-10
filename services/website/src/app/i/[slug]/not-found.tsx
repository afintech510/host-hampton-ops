/**
 * The ONE page an unavailable invitation gets (spec §7.1).
 *
 * Identical for an unknown slug, an archived or cancelled party, a switched-off
 * feature and a throttled request, so the page cannot be used to learn which
 * slugs exist. No site chrome (it is gated off under `/i/`), no link to the site.
 * The 404 status comes from `notFound()`.
 */
export default function InviteNotFound() {
  return (
    <div className="hh-inv-col mt-24 text-center">
      <h1 className="text-2xl font-semibold">This invitation isn&apos;t available</h1>
      <p className="mt-3 text-sm text-white/70">
        The link may have been mistyped or copied incompletely. Try opening it again from the message you were sent, or ask
        the host to send it again.
      </p>
    </div>
  )
}
