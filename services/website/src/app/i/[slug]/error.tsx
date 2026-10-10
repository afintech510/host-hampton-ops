'use client'

/**
 * A read failed (spec §4, §7.1): Supabase blipped, or the payments read did. It
 * is a 500 and it SAYS try again. It is never mis-stated as "not available",
 * which a guest would take for a cancelled party, and never as a preview.
 *
 * The error object is not shown or logged to the browser.
 */
export default function InviteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="hh-inv-col mt-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-sm text-white/70">Please try again in a moment.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 rounded-full bg-white/90 px-6 py-3 text-sm font-semibold text-[#1b0630]"
      >
        Try again
      </button>
    </div>
  )
}
