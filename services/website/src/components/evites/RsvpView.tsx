import type { Dispatch } from 'react'
import { MAX_CHILDREN, ALLERGY_NOTE_MAX, CHILD_NAME_MAX, NOTE_TO_HONOREE_MAX, PARENT_NAME_MAX } from '@/lib/evites/screens'
import type { ClubOffer, FlowAction, FlowState } from '@/lib/evites/rsvpFlow'

/**
 * The three RSVP screens, drawn from a `FlowState` (the pure reducer in
 * `lib/evites/rsvpFlow.ts`). No hooks and no network: `RsvpIsland` owns both, so
 * every screen can be server-rendered in the repo's node-only jest and read as text.
 *
 * Screens 1 and 2 say nothing about offers or marketing (spec §7.5, HANDOFF §3):
 * the Birthday Club exists only on screen 3, below a divider.
 *
 * Built for a thumb at 375 px: every control is at least 48 px tall, text is 16 px
 * (iOS does not zoom a focused 16 px field), and nothing scrolls sideways.
 */

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

const BTN_PRIMARY =
  'flex min-h-[3rem] w-full items-center justify-center rounded-full bg-white px-6 py-3 text-base font-semibold text-[#1b0630] disabled:opacity-60'
const BTN_SECONDARY =
  'flex min-h-[3rem] w-full items-center justify-center rounded-full border border-white/40 px-6 py-3 text-base font-semibold text-white disabled:opacity-60'
const BTN_LINK = 'min-h-[3rem] px-2 text-base font-semibold text-white underline underline-offset-4'
const INPUT =
  'min-h-[3rem] w-full rounded-xl bg-white px-4 py-3 text-base text-[#1b0630] placeholder-[#1b0630]/40 outline-none focus:ring-2 focus:ring-[#c9a0ff]'
const LABEL = 'mb-1.5 block text-sm font-semibold text-white'
const SEGMENT = 'min-h-[3rem] flex-1 rounded-xl border px-3 py-2 text-base font-semibold'

function segment(active: boolean): string {
  return `${SEGMENT} ${active ? 'border-white bg-white text-[#1b0630]' : 'border-white/40 text-white'}`
}

interface ViewProps {
  state: FlowState
  dispatch: Dispatch<FlowAction>
  /** Called when a button commits to a network round trip. */
  onSubmit: () => void
  onSaveExtras: () => void
  onLeaveClub: () => void
  /** `/i/<slug>/cal`. */
  calendarUrl: string
  /** The birthday child's first name, or null. */
  honoree: string | null
  /** The current consent wording from the database, or null (the club card is hidden). */
  club: ClubOffer | null
}

function ErrorLine({ state, field }: { state: FlowState; field: string }) {
  if (!state.error || state.error.field !== field) return null
  return (
    <p role="alert" className="mt-1.5 text-sm font-medium text-[#ffb4c8]">
      {state.error.message}
    </p>
  )
}

function FormError({ state }: { state: FlowState }) {
  // A message that belongs to no field (a network failure, a full list, a closed party).
  if (!state.error || state.error.field !== null) return null
  return (
    <p role="alert" className="rounded-xl bg-[#ffb4c8]/15 px-4 py-3 text-sm font-medium text-[#ffd6e1]">
      {state.error.message}
    </p>
  )
}

// ---------------------------------------------------------------- screen 1

function StartScreen({ state, dispatch }: ViewProps) {
  return (
    <section aria-label="RSVP" className="mt-6 grid grid-cols-1 gap-3" data-screen="1">
      {state.editing && <p className="text-center text-base font-semibold">Update your RSVP</p>}
      <button type="button" className={BTN_PRIMARY} onClick={() => dispatch({ type: 'choose', choice: 'yes' })}>
        Yes, we&apos;ll be there
      </button>
      <button type="button" className={BTN_SECONDARY} onClick={() => dispatch({ type: 'choose', choice: 'no' })}>
        Can&apos;t make it
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- screen 2

function Honeypot({ state, dispatch }: ViewProps) {
  // Off-screen, out of the tab order and hidden from assistive tech: a person never meets it.
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
      <label>
        Website
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={state.website}
          onChange={(e) => dispatch({ type: 'set', field: 'website', value: e.target.value })}
        />
      </label>
    </div>
  )
}

function DetailsScreen(p: ViewProps) {
  const { state, dispatch } = p
  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault()
    p.onSubmit()
  }
  const sending = state.busy
  const verb = state.saved ? 'Update my RSVP' : 'Send my RSVP'

  if (state.choice === 'no') {
    return (
      <form onSubmit={submit} noValidate aria-label="Can't make it" className="relative mt-6 grid grid-cols-1 gap-4" data-screen="2">
        <h2 className="text-lg font-bold">Sorry you can&apos;t make it</h2>
        <div>
          <label htmlFor="rsvp-parent" className={LABEL}>
            Your name
          </label>
          <input
            id="rsvp-parent"
            className={INPUT}
            type="text"
            autoComplete="name"
            maxLength={PARENT_NAME_MAX}
            value={state.parentName}
            onChange={(e) => dispatch({ type: 'set', field: 'parentName', value: e.target.value })}
          />
          <ErrorLine state={state} field="parentName" />
        </div>
        <Honeypot {...p} />
        <FormError state={state} />
        <button type="submit" className={BTN_PRIMARY} disabled={sending}>
          {sending ? 'Sending…' : 'Let them know'}
        </button>
        <button type="button" className={BTN_LINK} onClick={() => dispatch({ type: 'back' })} disabled={sending}>
          Back
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Who's coming" className="relative mt-6 grid grid-cols-1 gap-5" data-screen="2">
      <h2 className="text-lg font-bold">Who&apos;s coming?</h2>

      <fieldset className="grid grid-cols-1 gap-3">
        <legend className={LABEL}>{state.children.length > 1 ? 'Children' : 'Child'}</legend>
        {state.children.map((name, i) => (
          <div key={i}>
            <div className="flex gap-2">
              <input
                id={`rsvp-child-${i}`}
                className={INPUT}
                type="text"
                aria-label={`Child ${i + 1} first name`}
                placeholder="First name"
                autoComplete="off"
                maxLength={CHILD_NAME_MAX}
                value={name}
                onChange={(e) => dispatch({ type: 'setChild', index: i, value: e.target.value })}
              />
              {state.children.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove child ${i + 1}`}
                  className="min-h-[3rem] min-w-[3rem] rounded-xl border border-white/40 text-lg font-semibold"
                  onClick={() => dispatch({ type: 'removeChild', index: i })}
                >
                  &times;
                </button>
              )}
            </div>
            <ErrorLine state={state} field={`child-${i}`} />
          </div>
        ))}
        <ErrorLine state={state} field="children" />
        {state.children.length < MAX_CHILDREN && (
          <button type="button" className={`${BTN_LINK} text-left`} onClick={() => dispatch({ type: 'addChild' })}>
            + Add sibling
          </button>
        )}
      </fieldset>

      <div>
        <label htmlFor="rsvp-parent" className={LABEL}>
          Parent or guardian name
        </label>
        <input
          id="rsvp-parent"
          className={INPUT}
          type="text"
          autoComplete="name"
          maxLength={PARENT_NAME_MAX}
          value={state.parentName}
          onChange={(e) => dispatch({ type: 'set', field: 'parentName', value: e.target.value })}
        />
        <ErrorLine state={state} field="parentName" />
      </div>

      <fieldset>
        <legend className={LABEL}>Adults staying</legend>
        <div className="flex gap-2" role="group" aria-label="Adults staying">
          {([0, 1, 2] as const).map((n) => (
            <button key={n} type="button" aria-pressed={state.adultCount === n} className={segment(state.adultCount === n)} onClick={() => dispatch({ type: 'setAdults', value: n })}>
              {n === 2 ? '2+' : String(n)}
            </button>
          ))}
        </div>
        <ErrorLine state={state} field="adultCount" />
      </fieldset>

      <fieldset>
        <legend className={LABEL}>Food allergy?</legend>
        <div className="flex gap-2" role="group" aria-label="Food allergy">
          <button type="button" aria-pressed={state.hasAllergy === false} className={segment(state.hasAllergy === false)} onClick={() => dispatch({ type: 'setAllergy', value: false })}>
            No
          </button>
          <button type="button" aria-pressed={state.hasAllergy === true} className={segment(state.hasAllergy === true)} onClick={() => dispatch({ type: 'setAllergy', value: true })}>
            Yes
          </button>
        </div>
        <ErrorLine state={state} field="hasAllergy" />
        {state.hasAllergy === true && (
          <div className="mt-3">
            <label htmlFor="rsvp-allergy" className={LABEL}>
              Who, and what to avoid
            </label>
            <textarea
              id="rsvp-allergy"
              className={INPUT}
              rows={3}
              maxLength={ALLERGY_NOTE_MAX}
              value={state.allergyNote}
              onChange={(e) => dispatch({ type: 'set', field: 'allergyNote', value: e.target.value })}
            />
            <ErrorLine state={state} field="allergyNote" />
          </div>
        )}
      </fieldset>

      <div>
        <label htmlFor="rsvp-reminder" className={LABEL}>
          Want a reminder? <span className="font-normal text-white/70">(optional)</span>
        </label>
        <input
          id="rsvp-reminder"
          className={INPUT}
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="Email or mobile number"
          maxLength={254}
          value={state.reminderContact}
          onChange={(e) => dispatch({ type: 'set', field: 'reminderContact', value: e.target.value })}
        />
        <ErrorLine state={state} field="reminderContact" />
      </div>

      <Honeypot {...p} />
      <FormError state={state} />
      <button type="submit" className={BTN_PRIMARY} disabled={sending}>
        {sending ? 'Sending…' : verb}
      </button>
      <button type="button" className={BTN_LINK} onClick={() => dispatch({ type: 'back' })} disabled={sending}>
        Back
      </button>
    </form>
  )
}

// ---------------------------------------------------------------- screen 3

function ConfirmedScreen(p: ViewProps) {
  const { state, dispatch, club, honoree } = p
  const saved = state.saved
  const joined = !!saved && saved.club_opt_in_at !== null && saved.club_opted_out_at === null
  const noteLabel = honoree ? `Leave a note for ${honoree} (optional)` : 'Leave a note for the birthday child (optional)'

  return (
    <section aria-label="You're on the list" className="mt-6 grid grid-cols-1 gap-5" data-screen="3">
      <div className="text-center">
        <h2 className="text-2xl font-bold">You&apos;re on the list!</h2>
        {saved && (
          <p className="mt-1 text-sm text-white/80">
            {saved.children.map((c) => c.first_name).join(', ')}
            {saved.adult_count > 0 ? ` · ${saved.adult_count === 2 ? '2+' : '1'} adult${saved.adult_count === 1 ? '' : 's'}` : ''}
          </p>
        )}
      </div>

      <a href={p.calendarUrl} className={BTN_PRIMARY} rel="nofollow">
        Add to calendar
      </a>

      {saved?.reminder_email && !saved.reminder_opt_out_at && <p className="text-center text-sm text-white/80">We&apos;ll email a reminder before the party.</p>}
      {saved?.reminder_phone_e164 && <p className="text-center text-sm text-white/80">Add it to your calendar so your phone reminds you.</p>}
      {state.reminderDropped && (
        <p role="status" className="text-center text-sm text-white/80">
          We couldn&apos;t set up an email reminder for that address. Add the party to your calendar and your phone will remind you.
        </p>
      )}

      <div>
        <label htmlFor="rsvp-note" className={LABEL}>
          {noteLabel}
        </label>
        <textarea
          id="rsvp-note"
          className={INPUT}
          rows={3}
          maxLength={NOTE_TO_HONOREE_MAX}
          value={state.note}
          onChange={(e) => dispatch({ type: 'set', field: 'note', value: e.target.value })}
        />
        <ErrorLine state={state} field="note" />
      </div>

      {club && (
        <>
          <hr className="border-white/25" />
          <div className="rounded-2xl bg-white/10 p-4" aria-label="Birthday Club">
            <p className="mb-3 text-base font-bold">Birthday Club</p>
            {joined ? (
              <div className="grid gap-3">
                <p className="text-sm text-white/90">You&apos;re signed up{saved?.club_email ? ` with ${saved.club_email}` : ''}.</p>
                <button type="button" className={BTN_LINK} onClick={p.onLeaveClub} disabled={state.busy}>
                  Leave the Birthday Club
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                <label htmlFor="rsvp-club" className="flex min-h-[3rem] items-start gap-3 text-base">
                  <input
                    id="rsvp-club"
                    type="checkbox"
                    className="mt-1 h-6 w-6 shrink-0"
                    checked={state.clubChecked}
                    onChange={(e) => dispatch({ type: 'setClub', checked: e.target.checked })}
                  />
                  <span>{club.wording}</span>
                </label>
                <div>
                  <label htmlFor="rsvp-club-email" className={LABEL}>
                    Email
                  </label>
                  <input
                    id="rsvp-club-email"
                    className={INPUT}
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    value={state.clubEmail}
                    onChange={(e) => dispatch({ type: 'set', field: 'clubEmail', value: e.target.value })}
                  />
                  <ErrorLine state={state} field="clubEmail" />
                </div>
                <div>
                  <label htmlFor="rsvp-club-month" className={LABEL}>
                    Birthday month <span className="font-normal text-white/70">(optional)</span>
                  </label>
                  <select
                    id="rsvp-club-month"
                    className={INPUT}
                    value={state.birthdayMonth === null ? '' : String(state.birthdayMonth)}
                    onChange={(e) => dispatch({ type: 'setMonth', value: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">Choose a month</option>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={String(i + 1)}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-sm text-white/80">Unsubscribe anytime.</p>
              </div>
            )}
          </div>
        </>
      )}

      <FormError state={state} />
      {state.extrasSaved && (
        <p role="status" className="text-center text-sm font-semibold text-[#b9f5c8]">
          Saved. Thank you!
        </p>
      )}
      <button type="button" className={BTN_SECONDARY} onClick={p.onSaveExtras} disabled={state.busy}>
        {state.busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className={BTN_LINK} onClick={() => dispatch({ type: 'edit' })}>
        Change my RSVP
      </button>
    </section>
  )
}

function DeclinedScreen({ state, dispatch }: ViewProps) {
  return (
    <section aria-label="Thanks for letting us know" className="mt-6 grid grid-cols-1 gap-4 text-center" data-screen="2">
      <h2 className="text-xl font-bold">Thanks for letting us know</h2>
      <p className="text-sm text-white/80">{state.saved ? `We've got your answer, ${state.saved.parent_name}.` : "We've got your answer."}</p>
      <button type="button" className={BTN_LINK} onClick={() => dispatch({ type: 'edit' })}>
        Change my RSVP
      </button>
    </section>
  )
}

/** The screen the state is on. */
export default function RsvpView(props: ViewProps) {
  switch (props.state.screen) {
    case 'start':
      return <StartScreen {...props} />
    case 'details':
      return <DetailsScreen {...props} />
    case 'confirmed':
      return <ConfirmedScreen {...props} />
    case 'declined':
      return <DeclinedScreen {...props} />
  }
}

