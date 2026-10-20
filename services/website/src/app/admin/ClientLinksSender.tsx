'use client'

import { useEffect, useState } from 'react'
import {
  CLIENT_LINK_KINDS, EMAIL_BODY_MAX_LENGTH, SMS_BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH,
  checkPlaceholders, clientLinkLabel, defaultEmailBody, defaultEmailSubject, defaultSmsBody, isStudioRentalBooking,
  type ClientLinkKind,
} from '@/lib/clientLinks'

export interface ClientLinksBooking {
  id: string
  booking_ref?: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  child_name: string | null
  event_type?: string | null
  party_type?: string | null
  /** From the detail GET: does this party have an invitation to send? */
  invitation_status?: 'none' | 'archived' | 'ready' | 'unknown'
}

const LINK_HINTS: Record<ClientLinkKind, string> = {
  invite: 'the link they share with guests, plus their RSVP page',
  planner: 'pick theme, add-ons, guest count',
  invoice: 'the printable quote / invoice',
  portal: 'party details and payments',
}

const STUDIO_LINK_HINTS: Partial<Record<ClientLinkKind, string>> = {
  planner: 'the studio rental page: times, add-ons, guest count, pay',
  portal: 'opens the studio rental page too',
}

/**
 * "Send links to client" — pick the links, pick email and/or text, then Send
 * the default wording or Preview / edit it first.
 *
 * The wording is built by `lib/clientLinks.ts`, the module the route checks it
 * with, and holds `{placeholders}` rather than links: the route mints each link
 * at the moment it sends, so a preview never creates a live sign-in link.
 */
export default function ClientLinksSender({
  booking, headers, onSent,
}: {
  booking: ClientLinksBooking
  headers: HeadersInit
  onSent?: () => void
}) {
  const hasEmail = !!booking.contact_email
  const hasPhone = !!booking.contact_phone
  const inviteReady = booking.invitation_status === 'ready' || booking.invitation_status === 'unknown'

  const [links, setLinks] = useState<ClientLinkKind[]>(() => (booking.invitation_status === 'ready' ? ['invite'] : []))
  const [viaEmail, setViaEmail] = useState(hasEmail)
  const [viaSms, setViaSms] = useState(hasPhone)
  const [editing, setEditing] = useState(false)
  const [edited, setEdited] = useState(false)
  const [subject, setSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  function resetText(kinds: ClientLinkKind[] = links) {
    setSubject(defaultEmailSubject(booking, kinds))
    setEmailBody(defaultEmailBody(booking, kinds))
    setSmsBody(defaultSmsBody(booking, kinds))
    setEdited(false)
  }

  // Untouched wording follows the ticked links; edited wording is left alone.
  useEffect(() => {
    if (!edited) resetText(links)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links.join(',')])

  function toggleLink(k: ClientLinkKind) {
    setResult(null)
    setLinks(cur => (cur.includes(k) ? cur.filter(x => x !== k) : CLIENT_LINK_KINDS.filter(x => x === k || cur.includes(x))))
  }

  const problems = [
    ...(viaEmail ? checkPlaceholders(emailBody, links, 'email') : []),
    ...(viaSms ? checkPlaceholders(smsBody, links, 'text') : []),
    ...(viaEmail && !subject.trim() ? ['The email needs a subject.'] : []),
  ]
  const canSend = links.length > 0 && (viaEmail || viaSms) && problems.length === 0 && !sending

  async function send() {
    if (!canSend) return
    const what = links.map(k => clientLinkLabel(k, booking)).join(' + ')
    const targets = [
      viaEmail ? `email ${booking.contact_email}` : null,
      viaSms ? `text ${booking.contact_phone}` : null,
    ].filter(Boolean).join(' and ')
    if (!confirm(`Send ${what} to ${booking.contact_name || 'the customer'} by ${targets}?`)) return

    setSending(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/parties/${booking.id}`, {
        method: 'POST',
        headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_client_links', confirm: true,
          links, email: viaEmail, sms: viaSms,
          emailSubject: subject, emailBody, smsBody,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const via: string[] = data.sentVia || []
        const failed: string[] = data.failures || []
        setResult({ ok: failed.length === 0, message: `Sent via ${via.join(' + ')}.${failed.length ? ` ${failed.join(' ')}` : ''}` })
        onSent?.()
      } else {
        setResult({ ok: false, message: data.error || 'Failed to send' })
      }
    } catch (err) {
      setResult({ ok: false, message: `Failed to send: ${err}` })
    } finally {
      setSending(false)
    }
  }

  const box = 'w-full border rounded-lg px-3 py-2 text-sm font-sans'

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-gray-500 mb-1">Links</p>
        <div className="space-y-1">
          {CLIENT_LINK_KINDS.map(k => {
            const blocked = k === 'invite' && !inviteReady
            return (
              <label key={k} className={`flex items-start gap-2 text-sm ${blocked ? 'opacity-40' : ''}`}>
                <input
                  type="checkbox"
                  checked={links.includes(k)}
                  disabled={blocked}
                  onChange={() => toggleLink(k)}
                  className="accent-[#1a2744] mt-1"
                />
                <span>
                  {clientLinkLabel(k, booking)}
                  <span className="text-xs text-gray-400">
                    {' '}— {blocked
                      ? booking.invitation_status === 'archived' ? 'invitation is archived' : 'no invitation yet (create it above)'
                      : (isStudioRentalBooking(booking) && STUDIO_LINK_HINTS[k]) || LINK_HINTS[k]}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-1">Send by</p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className={`flex items-center gap-1.5 ${hasEmail ? '' : 'opacity-40'}`} title={booking.contact_email || 'No email on file'}>
            <input type="checkbox" checked={viaEmail} disabled={!hasEmail} onChange={e => { setViaEmail(e.target.checked); setResult(null) }} className="accent-[#1a2744]" />
            Email
          </label>
          <label className={`flex items-center gap-1.5 ${hasPhone ? '' : 'opacity-40'}`} title={booking.contact_phone || 'No phone on file'}>
            <input type="checkbox" checked={viaSms} disabled={!hasPhone} onChange={e => { setViaSms(e.target.checked); setResult(null) }} className="accent-[#1a2744]" />
            Text
          </label>
        </div>
      </div>

      {editing && (
        <div className="bg-gray-50 border rounded-lg p-3 space-y-3">
          <p className="text-[11px] text-gray-500">
            Words in braces — {'{invite}'}, {'{rsvps}'}, {'{planner}'}, {'{invoice}'}, {'{portal}'} — become the real links when you send.
          </p>
          {viaEmail && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#1a2744]">Email to {booking.contact_email}</label>
              <input
                type="text"
                value={subject}
                maxLength={SUBJECT_MAX_LENGTH}
                onChange={e => { setSubject(e.target.value); setEdited(true); setResult(null) }}
                className={box}
                placeholder="Subject"
              />
              <textarea
                value={emailBody}
                maxLength={EMAIL_BODY_MAX_LENGTH}
                rows={12}
                onChange={e => { setEmailBody(e.target.value); setEdited(true); setResult(null) }}
                className={box}
              />
            </div>
          )}
          {viaSms && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#1a2744]">Text to {booking.contact_phone}</label>
              <textarea
                value={smsBody}
                maxLength={SMS_BODY_MAX_LENGTH}
                rows={6}
                onChange={e => { setSmsBody(e.target.value); setEdited(true); setResult(null) }}
                className={box}
              />
              <p className="text-[11px] text-gray-400">{smsBody.length} characters before links (each link adds about 100–150).</p>
            </div>
          )}
          {!viaEmail && !viaSms && <p className="text-xs text-gray-500">Tick Email or Text to see the message.</p>}
          {edited && (
            <button type="button" onClick={() => resetText()} className="text-xs underline text-[#1a2744]/70">
              Reset to the default wording
            </button>
          )}
        </div>
      )}

      {problems.length > 0 && links.length > 0 && (
        <ul className="text-xs text-red-600 space-y-0.5">
          {problems.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setEditing(e => !e)}
          disabled={links.length === 0}
          className="border-2 border-[#1a2744]/40 text-[#1a2744] py-2 rounded-lg text-sm font-medium hover:bg-[#1a2744]/5 disabled:opacity-50"
        >
          {editing ? 'Hide preview' : 'Preview / edit'}
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="bg-[#1a2744] text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>

      {result && <p className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</p>}
    </div>
  )
}
