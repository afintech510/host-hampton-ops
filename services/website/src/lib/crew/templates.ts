/**
 * Host Hampton Crew — every word a crew member is sent. Spec §6.
 *
 * - Every message signs "— Allie, Host Hampton" (customer AND crew messages are
 *   always from Allie).
 * - Pay is dollars a party. Never a level, a tier or points —
 *   `crewCopy.test.ts` renders every template and fails on those words.
 * - Plain text only. Phase 4's `lib/crew/mail.ts` wraps the email half in HTML
 *   with `escapeFields` / `mailHref`; nothing here is HTML, so nothing here is
 *   escaped (the plain-text half of an email must never be).
 * - SMS bodies aim for one segment; `smsSegmentInfo` counts them at send time.
 */

import { STUDIO_PHONE_DISPLAY } from '@/lib/studioLocation'

export const CREW_SIGNATURE = '— Allie, Host Hampton'
export const SMS_DISCLOSURE = 'Msg freq varies. Reply STOP to opt out, HELP for help.'

export interface Rendered {
  sms: string
  email: { subject: string; text: string }
  inApp: string
}

export interface PartyRef {
  theme: string        // "Glow Party"
  dayLabel: string     // "Sat Oct 31"
  timeLabel: string    // "1:30–4:30 PM"
  setupLabel?: string  // "1:00 PM"
  kids?: number | null
  url: string          // deep link into /crew
}

function r(sms: string, subject: string, text: string, inApp?: string): Rendered {
  return {
    sms: `${sms} ${CREW_SIGNATURE}`,
    email: { subject, text: `${text}\n\n${CREW_SIGNATURE}` },
    inApp: inApp ?? sms,
  }
}

const spotWord = (role: 'lead' | 'crew') => (role === 'lead' ? 'the Party Lead spot' : 'a crew spot')

export const templates = {
  smsDisclosure(firstName: string): Rendered {
    return r(
      `Hi ${firstName}! Host Hampton party alerts will come from this number. ${SMS_DISCLOSURE}`,
      'Host Hampton crew texts',
      `Hi ${firstName}, party alerts will now come by text too. ${SMS_DISCLOSURE}`,
    )
  },

  smsHelp(): Rendered {
    return r(
      `Host Hampton crew alerts. Questions? Text or call ${STUDIO_PHONE_DISPLAY}. Reply STOP to opt out.`,
      'Host Hampton crew help',
      `Questions? Text or call ${STUDIO_PHONE_DISPLAY}.`,
    )
  },

  invite(firstName: string, loginUrl: string): Rendered {
    return r(
      `Hi ${firstName}! Your Host Hampton crew account is ready: ${loginUrl}`,
      'Your Host Hampton crew account',
      `Hi ${firstName},\n\nYour Host Hampton crew account is ready. Sign in with this email address to pick parties, set your availability and see your pay:\n${loginUrl}`,
    )
  },

  loginCode(code: string): Rendered {
    return r(
      `Your Host Hampton crew code is ${code}. It expires in 10 minutes.`,
      `Your Host Hampton crew code: ${code}`,
      `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for it, you can ignore this email.`,
    )
  },

  newParty(p: PartyRef, payLabel: string): Rendered {
    const kids = p.kids ? `, ${p.kids} kids` : ''
    return r(
      `New party: ${p.theme} ${p.dayLabel} ${p.timeLabel}${kids}, ${payLabel}. Claim a spot: ${p.url}`,
      `New party: ${p.theme}, ${p.dayLabel}`,
      `${p.theme} on ${p.dayLabel}, ${p.timeLabel}${kids}. ${payLabel} for you.\nClaim a spot: ${p.url}`,
    )
  },

  claimConfirmed(p: PartyRef, payLabel: string): Rendered {
    return r(
      `You're on ${p.theme} ${p.dayLabel} ${p.timeLabel} (${payLabel}). Details: ${p.url}`,
      `You're on: ${p.theme}, ${p.dayLabel}`,
      `You're on ${p.theme}, ${p.dayLabel} ${p.timeLabel}. ${payLabel} for the party.\nDetails: ${p.url}`,
    )
  },

  confirmRequest(p: PartyRef, dueLabel: string): Rendered {
    return r(
      `Still on for ${p.theme} ${p.dayLabel} ${p.timeLabel}? Reply Y or tap ${p.url} by ${dueLabel}.`,
      `Confirm: ${p.theme}, ${p.dayLabel}`,
      `Please confirm you're still on for ${p.theme}, ${p.dayLabel} ${p.timeLabel} by ${dueLabel}.\nConfirm, or tell us you can't make it: ${p.url}`,
    )
  },

  confirmReminder(p: PartyRef, dueLabel: string): Rendered {
    return r(
      `Reminder: confirm ${p.theme} ${p.dayLabel} by ${dueLabel}. Reply Y or tap ${p.url}`,
      `Reminder: confirm ${p.theme}, ${p.dayLabel}`,
      `A reminder to confirm ${p.theme}, ${p.dayLabel} by ${dueLabel}: ${p.url}`,
    )
  },

  confirmed(p: PartyRef): Rendered {
    const setup = p.setupLabel ? ` Setup starts ${p.setupLabel}.` : ''
    return r(
      `Confirmed for ${p.theme} ${p.dayLabel}.${setup} Thank you!`,
      `Confirmed: ${p.theme}, ${p.dayLabel}`,
      `You're confirmed for ${p.theme}, ${p.dayLabel}.${setup}`,
    )
  },

  nothingToConfirm(): Rendered {
    return r('Nothing to confirm right now.', 'Nothing to confirm', 'Nothing to confirm right now.')
  },

  dayBefore(p: PartyRef, address: string): Rendered {
    const setup = p.setupLabel ? ` Setup starts ${p.setupLabel}.` : ''
    return r(
      `Tomorrow: ${p.theme} ${p.timeLabel}.${setup} ${address}`,
      `Tomorrow: ${p.theme} at ${p.timeLabel}`,
      `See you tomorrow for ${p.theme}, ${p.timeLabel}.${setup}\n${address}\n${p.url}`,
    )
  },

  earlyReleased(p: PartyRef, newRateLabel: string, waived: boolean, stepLabel: string): Rendered {
    const effect = waived
      ? `Your rate stays at ${newRateLabel} a party.`
      : `Your rate is now ${newRateLabel} a party; every party you work adds ${stepLabel}.`
    return r(
      `You're off ${p.theme} ${p.dayLabel}. ${effect}`,
      `You're off ${p.theme}, ${p.dayLabel}`,
      `Thanks for the notice. You're off ${p.theme}, ${p.dayLabel}, and the spot is open for someone else. ${effect}`,
    )
  },

  coverOffer(requesterFirst: string, p: PartyRef, role: 'lead' | 'crew', payLabel: string): Rendered {
    return r(
      `${requesterFirst} can't make ${p.theme} ${p.dayLabel} ${p.timeLabel}. You're a standby, claim ${spotWord(role)} (${payLabel}): ${p.url}`,
      `Cover needed: ${p.theme}, ${p.dayLabel}`,
      `${requesterFirst} can't make ${p.theme}, ${p.dayLabel} ${p.timeLabel}. You're a standby, so you get first pick: ${spotWord(role)}, ${payLabel}. First to claim gets it, and covering a late cancel counts as two parties toward your rate.\n${p.url}`,
    )
  },

  coveredRequester(p: PartyRef): Rendered {
    return r(
      `You're covered for ${p.theme} ${p.dayLabel}. Your rate doesn't change. Thanks for asking early!`,
      `You're covered for ${p.theme}`,
      `Someone took your spot at ${p.theme}, ${p.dayLabel}. Your rate doesn't change.`,
    )
  },

  coverClaimed(p: PartyRef, payLabel: string): Rendered {
    return r(
      `Thanks for covering! You're on ${p.theme} ${p.dayLabel} ${p.timeLabel} (${payLabel}). It counts as two parties toward your rate. ${p.url}`,
      `You're covering ${p.theme}, ${p.dayLabel}`,
      `Thanks for covering. You're on ${p.theme}, ${p.dayLabel} ${p.timeLabel}, ${payLabel}. Once you've worked it, it counts as two parties toward your rate.\n${p.url}`,
    )
  },

  unclaimedWarning(p: PartyRef, resetRateLabel: string): Rendered {
    return r(
      `Nobody has taken ${p.theme} ${p.dayLabel} yet, so you're still on. Options: ${p.url}`,
      `Still uncovered: ${p.theme}, ${p.dayLabel}`,
      `Nobody has taken your spot at ${p.theme}, ${p.dayLabel} yet, so you're still on. You can keep waiting, keep the spot, or drop it anyway (that puts you back to ${resetRateLabel} a party): ${p.url}`,
    )
  },

  droppedUncovered(p: PartyRef, rateLabel: string, waived: boolean, stepLabel: string): Rendered {
    const effect = waived
      ? `Your rate stays at ${rateLabel} a party for now.`
      : `You're back to ${rateLabel} a party; every party you work adds ${stepLabel}.`
    return r(
      `You're off ${p.theme} ${p.dayLabel}. ${effect}`,
      `You're off ${p.theme}, ${p.dayLabel}`,
      `You're off ${p.theme}, ${p.dayLabel}. ${effect}`,
    )
  },

  stepUp(rateLabel: string, url: string): Rendered {
    return r(
      `You're up a step — ${rateLabel} per party now. ${url}`,
      `You're up a step: ${rateLabel} a party`,
      `Thanks for another great party. You're up a step — ${rateLabel} per party now.\n${url}`,
    )
  },

  stepReset(rateLabel: string, stepLabel: string, url: string): Rendered {
    return r(
      `You're back to ${rateLabel} per party; every party you work adds ${stepLabel}. ${url}`,
      `Your rate: ${rateLabel} a party`,
      `You're back to ${rateLabel} per party; every party you work adds ${stepLabel}.\n${url}`,
    )
  },

  partyCancelled(p: PartyRef): Rendered {
    return r(
      `Heads up: ${p.theme} ${p.dayLabel} was cancelled. Your rate doesn't change.`,
      `Cancelled: ${p.theme}, ${p.dayLabel}`,
      `${p.theme} on ${p.dayLabel} was cancelled by the family. Your rate doesn't change.`,
    )
  },

  availabilityDue(monthLabel: string, dueLabel: string, url: string): Rendered {
    return r(
      `Set your ${monthLabel} availability by ${dueLabel} so we can plan: ${url}`,
      `${monthLabel} availability due ${dueLabel}`,
      `Please set your ${monthLabel} availability by ${dueLabel}: ${url}`,
    )
  },

  paid(p: PartyRef, payLabel: string, tipLabel: string): Rendered {
    return r(
      `Paid for ${p.theme} ${p.dayLabel}: ${payLabel} + ${tipLabel} tips. Thank you!`,
      `Paid: ${p.theme}, ${p.dayLabel}`,
      `Thanks for ${p.theme}, ${p.dayLabel}. Paid: ${payLabel}, plus ${tipLabel} in tips.\n${p.url}`,
    )
  },
} as const

/** Allie's alerts: email + an in-app row. These may name a reason; crew copy never does. */
export const adminTemplates = {
  unconfirmed(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `Not confirmed: ${memberFirst}, ${p.theme} ${p.dayLabel}`,
      text: `${memberFirst} hasn't confirmed ${p.theme}, ${p.dayLabel} ${p.timeLabel} and the deadline passed.\n${adminUrl}`,
    }
  },
  spotReleased(memberFirst: string, p: PartyRef, noticeDays: number, adminUrl: string) {
    return {
      subject: `Spot released: ${p.theme}, ${p.dayLabel}`,
      text: `${memberFirst} released a spot at ${p.theme}, ${p.dayLabel} (${noticeDays} days out). It's open again.\n${adminUrl}`,
    }
  },
  coverRequested(memberFirst: string, reason: string, standbys: number, p: PartyRef, adminUrl: string) {
    return {
      subject: `Late cancel: ${memberFirst}, ${p.theme} ${p.dayLabel}`,
      text: `${memberFirst} can't make ${p.theme}, ${p.dayLabel} (reason: ${reason}). ${standbys} standby${standbys === 1 ? '' : 's'} asked. ${memberFirst} stays on until someone claims.\n${adminUrl}`,
    }
  },
  coverEscalated(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `No standby took it: ${p.theme}, ${p.dayLabel}`,
      text: `No standby has taken ${memberFirst}'s spot at ${p.theme}, ${p.dayLabel} ${p.timeLabel}. Offer it to everyone free that day, or assign someone:\n${adminUrl}`,
    }
  },
  coverUnclaimed(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `Still uncovered at 48 hours: ${p.theme}, ${p.dayLabel}`,
      text: `Nobody has taken ${memberFirst}'s spot at ${p.theme}, ${p.dayLabel}. They're still on.\n${adminUrl}`,
    }
  },
  droppedUncovered(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `URGENT open spot: ${p.theme}, ${p.dayLabel}`,
      text: `${memberFirst} dropped ${p.theme}, ${p.dayLabel} ${p.timeLabel} with nobody covering. The spot is open.\n${adminUrl}`,
    }
  },
  noLead(p: PartyRef, adminUrl: string) {
    return {
      subject: `No Party Lead yet: ${p.theme}, ${p.dayLabel}`,
      text: `${p.theme}, ${p.dayLabel} ${p.timeLabel} still has no Party Lead.\n${adminUrl}`,
    }
  },
  attendanceDue(p: PartyRef, adminUrl: string) {
    return {
      subject: `Mark attendance: ${p.theme}, ${p.dayLabel}`,
      text: `Attendance, pay and tips for ${p.theme}, ${p.dayLabel} haven't been recorded yet.\n${adminUrl}`,
    }
  },
  noShowReview(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `No-show: ${memberFirst}`,
      text: `${memberFirst} was marked a no-show for ${p.theme}, ${p.dayLabel}. Their profile is flagged for you to talk to them.\n${adminUrl}`,
    }
  },
} as const
