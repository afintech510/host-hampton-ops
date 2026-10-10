/**
 * The RSVP area of the public page. PLACEHOLDER (P05): the two buttons are drawn
 * and DISABLED. P06 replaces this file with the real three-screen flow, which
 * is a client component that posts to `/api/i/[slug]/rsvp`.
 *
 * It takes no counts and shows none (D15): the public page never says how many
 * guests have answered.
 */

export default function RsvpIsland(_props: { slug: string }) {
  return (
    <section aria-label="RSVP" className="mt-6 grid grid-cols-1 gap-3">
      <button
        type="button"
        disabled
        className="w-full rounded-full bg-white/90 px-6 py-3.5 text-base font-semibold text-[#1b0630] opacity-60"
      >
        Yes, we&apos;ll be there
      </button>
      <button
        type="button"
        disabled
        className="w-full rounded-full border border-white/40 px-6 py-3.5 text-base font-semibold text-white opacity-60"
      >
        Can&apos;t make it
      </button>
      <p className="text-center text-xs text-white/60">RSVP opens very soon.</p>
    </section>
  )
}
