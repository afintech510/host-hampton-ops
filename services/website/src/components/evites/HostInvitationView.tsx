import type { ReactNode } from 'react'
import type { HostPayload, HostRsvp } from '@/lib/evites/hostView'
import {
  adultLabel,
  adultsLine,
  kidsLine,
  overCap,
  shareGate,
  stateBanner,
  type BannerTone,
  type HostFormState,
} from '@/lib/evites/hostUi'

/**
 * The host page, drawn from a payload and a form state (spec §7.2). No hooks and no network:
 * `HostInvitation` owns both, so every state can be server-rendered in the repo's node-only
 * jest and read as text - the Share panel's disabled states in particular.
 *
 * Copy is the host's, in the host's voice. Nothing here says who it is from; customer
 * messages are signed by Allie where they are signed at all.
 */

const CARD = 'bg-white rounded-xl shadow-sm p-5 md:p-6'
const H2 = 'font-display text-lg text-[#1a2744] mb-3'
const LABEL = 'block text-sm font-medium text-[#1a2744] mb-1'
const INPUT =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-[#1a2744] outline-none focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent'
const BTN =
  'flex min-h-[2.75rem] w-full items-center justify-center rounded-lg bg-[#1a2744] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2a3754] transition-colors'
const BTN_2 =
  'flex min-h-[2.75rem] w-full items-center justify-center rounded-lg border border-[#1a2744] px-4 py-2.5 text-sm font-medium text-[#1a2744] hover:bg-gray-50 transition-colors'
const OFF = 'opacity-40 cursor-not-allowed pointer-events-none'

const BANNER_STYLE: Record<BannerTone, string> = {
  preview: 'bg-amber-50 border-amber-200 text-amber-900',
  soon: 'bg-sky-50 border-sky-200 text-sky-900',
  live: 'bg-green-50 border-green-200 text-green-900',
  updating: 'bg-blue-50 border-blue-200 text-blue-900',
  done: 'bg-purple-50 border-purple-200 text-purple-900',
}

export interface HostViewProps {
  data: HostPayload
  /** The server-drawn web canvas, already inside its scaling frame. */
  preview: ReactNode
  form: HostFormState
  dirty: boolean
  saving: boolean
  /** A refused save, with the field it names. */
  formError: { field: string | null; message: string } | null
  saved: boolean
  copied: boolean
  /** Event handlers; absent in static renders. */
  on?: {
    form?: (patch: Partial<HostFormState>) => void
    save?: () => void
    share?: (kind: 'invite' | 'reshare') => void
    copy?: () => void
    download?: () => void
  }
}

function FieldError({ error, field }: { error: HostViewProps['formError']; field: string }) {
  if (!error || error.field !== field) return null
  return (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {error.message}
    </p>
  )
}

function SharePanel({ props }: { props: HostViewProps }) {
  const { data, on } = props
  const gate = shareGate(data.state, data.renderFresh)
  const off = gate.enabled ? '' : OFF
  return (
    <section aria-label="Share your invitation" className={CARD}>
      <h2 className={H2}>Share your invitation</h2>
      {gate.message && (
        <p role="status" className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {gate.message}
        </p>
      )}
      <div className="space-y-2.5">
        <button type="button" data-share="text" disabled={!gate.enabled} onClick={() => on?.share?.('invite')} className={`${BTN} ${off}`}>
          Text My Invitation
        </button>
        <button type="button" data-share="copy" disabled={!gate.enabled} onClick={() => on?.copy?.()} className={`${BTN_2} ${off}`}>
          {props.copied ? 'Link copied!' : 'Copy link'}
        </button>
        {gate.enabled && data.images.invite ? (
          // `download` is ignored for a cross-origin image (the file lives on the storage
          // host), so this opens the picture in a new tab to save: fine for the MVP.
          <a
            data-share="download"
            href={data.images.invite}
            download="invitation.jpg"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => on?.download?.()}
            className={BTN_2}
          >
            Download image
          </a>
        ) : (
          <span data-share="download" aria-disabled="true" className={`${BTN_2} ${OFF}`}>
            Download image
          </span>
        )}
        <button type="button" data-share="reshare" disabled={!gate.enabled} onClick={() => on?.share?.('reshare')} className={`${BTN_2} ${off}`}>
          Re-share with people who haven&apos;t answered
        </button>
      </div>
      <p className="mt-4 text-sm">
        {/* A plain anchor, NOT next/link: a client-side navigation would skip GA's `/i/` URL cleaning. */}
        <a href={data.url} target="_blank" rel="noopener noreferrer" className="text-[#1a2744] underline">
          See what your guests see
        </a>
      </p>
    </section>
  )
}

function CustomizeForm({ props }: { props: HostViewProps }) {
  const { data, form, on, formError } = props
  const set = (patch: Partial<HostFormState>) => on?.form?.(patch)
  const { min, max } = data.deadlineRange
  return (
    <section aria-label="Customize" className={CARD}>
      <h2 className={H2}>Customize</h2>
      <p className="mb-4 text-sm text-gray-500">All optional. Changes redraw your invitation, which takes about a minute.</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          on?.save?.()
        }}
      >
        <div>
          <label htmlFor="hi-host-note" className={LABEL}>
            A note to your guests
          </label>
          <textarea
            id="hi-host-note"
            maxLength={140}
            rows={2}
            value={form.hostNote}
            onChange={(e) => set({ hostNote: e.target.value })}
            className={INPUT}
          />
          <p className="mt-0.5 text-xs text-gray-400">{form.hostNote.length}/140</p>
          <FieldError error={formError} field="host_note" />
        </div>

        <div>
          <label htmlFor="hi-gift-note" className={LABEL}>
            Gift note
          </label>
          <textarea
            id="hi-gift-note"
            maxLength={140}
            rows={2}
            value={form.giftNote}
            onChange={(e) => set({ giftNote: e.target.value })}
            placeholder="For example: no gifts, please"
            className={INPUT}
          />
          <p className="mt-0.5 text-xs text-gray-400">{form.giftNote.length}/140</p>
          <FieldError error={formError} field="gift_note" />
        </div>

        <div>
          <label htmlFor="hi-deadline" className={LABEL}>
            Please RSVP by
          </label>
          <div className="flex gap-2">
            <input
              id="hi-deadline"
              type="date"
              min={min}
              max={max ?? undefined}
              value={form.rsvpDeadline}
              onChange={(e) => set({ rsvpDeadline: e.target.value })}
              className={INPUT}
            />
            {form.rsvpDeadline && (
              <button type="button" onClick={() => set({ rsvpDeadline: '' })} className="shrink-0 px-2 text-sm text-[#1a2744] underline">
                Clear
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">Shown on the page as a reminder. Guests can still answer after it.</p>
          <FieldError error={formError} field="rsvp_deadline" />
        </div>

        <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-[#1a2744]">&ldquo;Any questions?&rdquo; line</legend>
          <label className="flex items-center gap-2 text-sm text-[#1a2744]">
            <input
              type="checkbox"
              checked={form.showHostContact}
              onChange={(e) => set({ showHostContact: e.target.checked })}
              className="h-5 w-5"
            />
            Show it on the invitation
          </label>
          <FieldError error={formError} field="show_host_contact" />
          <div>
            <label htmlFor="hi-contact-name" className={LABEL}>
              Name
            </label>
            <input
              id="hi-contact-name"
              type="text"
              maxLength={40}
              value={form.hostContactName}
              onChange={(e) => set({ hostContactName: e.target.value })}
              className={INPUT}
            />
            <FieldError error={formError} field="host_contact_name" />
          </div>
          <div>
            <label htmlFor="hi-contact-phone" className={LABEL}>
              Phone
            </label>
            <input
              id="hi-contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.hostContactPhone}
              onChange={(e) => set({ hostContactPhone: e.target.value })}
              className={INPUT}
            />
            <p className="mt-0.5 text-xs text-gray-400">Leave the name and phone blank to use the studio&apos;s. This is printed on the invitation picture.</p>
            <FieldError error={formError} field="host_contact_phone" />
          </div>
        </fieldset>

        {formError && !formError.field && (
          <p role="alert" className="text-sm text-red-600">
            {formError.message}
          </p>
        )}
        <button type="submit" disabled={!props.dirty || props.saving} className={`${BTN} ${props.dirty && !props.saving ? '' : 'opacity-50'}`}>
          {props.saving ? 'Saving…' : 'Save changes'}
        </button>
        {props.saved && !props.dirty && (
          <p role="status" className="text-center text-sm text-green-700">
            Saved. We&apos;re redrawing your invitation.
          </p>
        )}
      </form>
    </section>
  )
}

function names(r: HostRsvp): string {
  return r.children.map((c) => c.first_name).join(', ')
}

function RsvpList({ props }: { props: HostViewProps }) {
  const { data } = props
  const s = data.summary
  const yes = data.rsvps.filter((r) => r.status === 'yes').slice().reverse()
  const no = data.rsvps.filter((r) => r.status === 'no').slice().reverse()
  const over = overCap(s.kidsYes, s.cap)
  return (
    <section aria-label="RSVPs" className={CARD}>
      <h2 className={H2}>RSVPs</h2>

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className={`rounded-lg px-3 py-2 ${over ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-[#1a2744]'}`}>
          <p data-summary="kids" className="font-semibold">
            {kidsLine(s.kidsYes, s.cap)}
          </p>
          {over && <p className="text-xs">That&apos;s more than the guest count on your booking.</p>}
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-[#1a2744]">
          <p data-summary="adults" className="font-semibold">
            {adultsLine(s.adultsYes, s.adultsPlus)}
          </p>
          {s.adultsPlus && <p className="text-xs">&ldquo;2+&rdquo; counts as 2.</p>}
        </div>
      </div>

      {s.allergies.length > 0 && (
        <div data-summary="allergies" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
          <p className="font-semibold">Food allergies to plan for</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {s.allergies.map((a, i) => (
              <li key={i}>
                {a.children.length > 0 ? a.children.join(', ') : a.parent}
                {a.children.length > 0 && <span className="text-red-700"> (guest of {a.parent})</span>}
                {a.note ? `: ${a.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {yes.length === 0 ? (
        <p data-rsvps="empty" className="text-sm text-gray-500">
          No answers yet. They will appear here as guests reply.
        </p>
      ) : (
        <ul data-rsvps="yes" className="divide-y divide-gray-100">
          {yes.map((r, i) => (
            <li key={i} className="py-3 text-sm">
              <p className="font-medium text-[#1a2744]">{r.parent_name}</p>
              <p className="text-gray-600">
                {names(r)} &middot; {adultLabel(r.adult_count)}
              </p>
              {r.has_allergy && <p className="mt-0.5 text-red-700">Allergy{r.allergy_note ? `: ${r.allergy_note}` : ''}</p>}
              {r.note_to_honoree && (
                <p className="mt-1 whitespace-pre-line rounded-lg bg-[#F6F1EB] px-3 py-2 text-[#1a2744]">
                  {data.facts.honoreeName ? `Note for ${data.facts.honoreeName}: ` : 'Note for the birthday child: '}
                  {r.note_to_honoree}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {no.length > 0 && (
        <div data-rsvps="no" className="mt-5">
          <h3 className="mb-1.5 text-sm font-semibold text-[#1a2744]">Can&apos;t make it ({no.length})</h3>
          <ul className="space-y-0.5 text-sm text-gray-600">
            {no.map((r, i) => (
              <li key={i}>{r.parent_name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export function HostInvitationView(props: HostViewProps) {
  const { data } = props
  const banner = stateBanner(data.state, data.renderFresh)
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:py-14">
      <p className="mb-1 text-sm">
        <a href="/my-booking" className="text-[#1a2744] underline">
          &larr; Back to my booking
        </a>
      </p>
      <h1 className="font-display text-2xl text-[#1a2744] mb-4">Your invitation</h1>

      <div role="status" data-banner={banner.tone} className={`mb-6 rounded-xl border px-4 py-3 ${BANNER_STYLE[banner.tone]}`}>
        <p className="font-semibold">{banner.title}</p>
        <p className="mt-0.5 text-sm">{banner.body}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
        <div>
          <div className={`${CARD} !p-3`}>{props.preview}</div>
          <section aria-label="Party details" className="mt-3 rounded-xl bg-white px-4 py-3 text-sm shadow-sm text-[#1a2744]">
            <p className="font-semibold">{data.facts.dateLine}</p>
            <p className="text-gray-600">{data.facts.placeLine}</p>
            {data.facts.hostContactLine && <p className="mt-1 text-gray-500">{data.facts.hostContactLine}</p>}
          </section>
        </div>
        <div className="space-y-6">
          <SharePanel props={props} />
          <CustomizeForm props={props} />
        </div>
      </div>

      <div className="mt-6">
        <RsvpList props={props} />
      </div>
    </div>
  )
}
