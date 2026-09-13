/**
 * The booking audit log, written once.
 *
 * `booking_modifications` is the "what happened to this party" trail the admin
 * panel renders and the Lead Thread Workspace folds into its timeline. Thirteen
 * places in the admin surface inserted into it with the error discarded, so a
 * refused audit row was indistinguishable from one that was written — on the
 * table whose entire job is to say what happened.
 *
 * It is deliberately NOT fatal. Losing the audit line for a payment that really
 * was recorded is a smaller problem than refusing the payment because the audit
 * line failed, so this reports and returns rather than throwing. What it must
 * not do is stay silent (rule 19).
 *
 * `modified_by` takes `adminActorId(req)` — `admin:<email>` from a signed
 * `hh_admin` session, or the historical anonymous `'ADMIN'` on the shared
 * password. Migration 047 relaxed `booking_modifications_modified_by_check` to
 * permit both; before it, the CHECK was `IN ('customer','admin','system')` and
 * would have refused every one of them, including the capitalised `'ADMIN'`.
 */

type MinimalClient = { from: (table: string) => any }

export async function logBookingChange(
  supabase: MinimalClient,
  opts: {
    bookingId: string
    actor: string
    summary: string
    newData?: Record<string, unknown> | null
  },
): Promise<boolean> {
  const row: Record<string, unknown> = {
    booking_id: opts.bookingId,
    modified_by: opts.actor,
    change_summary: opts.summary,
  }
  if (opts.newData !== undefined && opts.newData !== null) row.new_data = opts.newData

  const { error } = await supabase.from('booking_modifications').insert(row)
  if (error) {
    console.error(
      `BOOKING AUDIT ROW NOT WRITTEN for ${opts.bookingId} ("${opts.summary}"): ${error.message} ` +
        '— the change happened but the history will not show it.',
    )
    return false
  }
  return true
}
