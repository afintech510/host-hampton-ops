/**
 * Host Hampton Crew — every word a crew member is sent. Spec §6.
 *
 * - Every message signs "— Allie, Host Hampton" (customer AND crew messages are
 *   always from Allie).
 * - Pay is dollars a party. Never a level, a tier or points —
 *   `crewCopy.test.ts` renders every template and fails on those words.
 * - LAUNCH MODE (2026-11-05): no pay figure and no word about a rate moving.
 *   A template that could say either takes `payLabel: string | null` (null = say
 *   nothing about pay) and/or `ladder: boolean` (false = say nothing about rates
 *   going up, down or resetting, or a cover "counting as two parties"). The
 *   ladder wording is kept, behind the switch, for the day it comes back.
 * - Plain text only. Phase 4's `lib/crew/mail.ts` wraps the email half in HTML
 *   with `escapeFields` / `mailHref`; nothing here is HTML, so nothing here is
 *   escaped (the plain-text half of an email must never be).
 * - SMS bodies aim for one segment; `smsSegmentInfo` counts them at send time.
 */

import { STUDIO_PHONE_DISPLAY } from '@/lib/studioLocation'
import { TENANT } from '@/tenant'

export const CREW_SIGNATURE = `— ${TENANT.people.customerSignoff}, ${TENANT.business.name}`
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
  /** The whole shift this person is committing to, arrival to done: "1–5 PM". Not the party's own hours. */
  shiftLabel?: string
  kids?: number | null
  url: string          // deep link into /crew
  /** Where to add this shift to a phone calendar (a signed link that needs no login), when the message carries one. */
  calUrl?: string
}

/** " Add to your calendar: <link>", or nothing when the message has no link. */
const calLine = (p: PartyRef) => (p.calUrl ? ` Add to your calendar: ${p.calUrl}` : '')

function r(sms: string, subject: string, text: string, inApp?: string): Rendered {
  return {
    sms: `${sms} ${CREW_SIGNATURE}`,
    email: { subject, text: `${text}\n\n${CREW_SIGNATURE}` },
    inApp: inApp ?? sms,
  }
}

const spotWord = (role: 'lead' | 'crew') => (role === 'lead' ? 'the Party Lead spot' : 'a crew spot')
/** " (label)" for a text, or nothing while pay is hidden. */
const paren = (label: string | null) => (label ? ` (${label})` : '')
/** ", label" after a comma-separated clause, or nothing. */
const comma = (label: string | null) => (label ? `, ${label}` : '')

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
      `Hi ${firstName},\n\nYour Host Hampton crew account is ready. Sign in with this email address to pick parties and set your availability:\n${loginUrl}`,
    )
  },

  /** The first crew text a person ever gets: one link, the opt-out line, signed like every crew message. */
  onboardingInvite(firstName: string): Rendered {
    const site = TENANT.business.siteUrl
    return r(
      `Hi ${firstName}, set up your ${TENANT.business.name} crew account here: ${site.replace(/^https?:\/\//, '').replace(/^www\./, '')}/crew/login Reply STOP to opt out.`,
      `Set up your ${TENANT.business.name} crew account`,
      `Hi ${firstName},

Set up your ${TENANT.business.name} crew account here: ${site}/crew/login`,
    )
  },

  emailConfirm(code: string): Rendered {
    return r(
      `Your ${TENANT.business.name} crew email code is ${code}. It expires in 10 minutes.`,
      `Confirm your email: ${code}`,
      `Your code to confirm this email address is ${code}. It expires in 10 minutes.

If you didn't ask for it, you can ignore this email.`,
    )
  },

  loginCode(code: string): Rendered {
    return r(
      `Your Host Hampton crew code is ${code}. It expires in 10 minutes.`,
      `Your Host Hampton crew code: ${code}`,
      `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for it, you can ignore this email.`,
    )
  },

  newParty(p: PartyRef, payLabel: string | null): Rendered {
    const kids = p.kids ? `, ${p.kids} kids` : ''
    return r(
      `New party: ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}${kids}${comma(payLabel)}. Claim a spot: ${p.url}`,
      `New party: ${p.theme}, ${p.dayLabel}`,
      `${p.theme} on ${p.dayLabel}, ${p.shiftLabel ?? p.timeLabel}${kids}.${payLabel ? ` ${payLabel} for you.` : ''}\nClaim a spot: ${p.url}`,
    )
  },

  /** The same party, still short of crew, as it gets closer. `spots` is how many are open for THIS person. */
  openSpots(p: PartyRef, spots: number, payLabel: string | null): Rendered {
    const n = `${spots} ${spots === 1 ? 'spot' : 'spots'}`
    return r(
      `Still need crew: ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}, ${n} open${comma(payLabel)}. Can you take one? ${p.url}`,
      `Still need crew: ${p.theme}, ${p.dayLabel}`,
      `${p.theme} on ${p.dayLabel}, ${p.shiftLabel ?? p.timeLabel} still has ${n} open.${payLabel ? ` ${payLabel} for you.` : ''} If you're free, claim one here (or say you can cover and we'll ask you first if someone drops):\n${p.url}`,
    )
  },

  /** A spot opened on a party the person is waitlisted for (someone gave notice early): first pick. */
  spotOpened(p: PartyRef, role: 'lead' | 'crew', payLabel: string | null): Rendered {
    return r(
      `A spot opened on ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}. You're on the waitlist, so you get first pick: ${spotWord(role)}${paren(payLabel)}. ${p.url}`,
      `A spot opened: ${p.theme}, ${p.dayLabel}`,
      `Someone gave notice on ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}, and ${spotWord(role)} is open${comma(payLabel)}. You're on the waitlist, so you get first pick. First to claim gets it:\n${p.url}`,
    )
  },

  /** Several asks at once for one person (a batch of parties published together) as one message. */
  partiesDigest(count: number, open: boolean, url: string): Rendered {
    const n = `${count} ${count === 1 ? 'party' : 'parties'}`
    return r(
      open ? `${n} still need crew. See which ones you can take: ${url}` : `${n} just went up. See which ones you can take: ${url}`,
      open ? `${n} still need crew` : `${n} just went up`,
      open
        ? `${n} still have open spots. If you're free, take the ones you want (or say you can cover):\n${url}`
        : `${n} just went up on the schedule. Take the ones you want:\n${url}`,
    )
  },

  /** Equitable scheduling: a new party in pick mode. Nothing is taken by answering; the manager picks. */
  newPartyPick(p: PartyRef): Rendered {
    const kids = p.kids ? `, ${p.kids} kids` : ''
    return r(
      `New party: ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}${kids}. Tell us if you want to work it, can't, or can stand by: ${p.url}`,
      `New party: ${p.theme}, ${p.dayLabel}`,
      `${p.theme} on ${p.dayLabel}, ${p.shiftLabel ?? p.timeLabel}${kids}.
Tell us if you want to work it, can't, or can stand by. Answering doesn't lock you in; the crew is picked fairly:
${p.url}`,
    )
  },

  /** Pick mode: the ones who have not answered yet. */
  pickReminder(p: PartyRef): Rendered {
    return r(
      `Still need to hear from you on ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}: want to work it, can't, or can stand by? ${p.url}`,
      `Your answer: ${p.theme}, ${p.dayLabel}`,
      `We still need to hear from you on ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}. Tell us if you want to work it, can't, or can stand by. Answering doesn't lock you in:\n${p.url}`,
    )
  },

  partiesDigestPick(count: number, url: string): Rendered {
    const n = `${count} ${count === 1 ? 'party' : 'parties'}`
    return r(
      `${n} just went up. Tell us which you want to work: ${url}`,
      `${n} just went up`,
      `${n} just went up on the schedule. Tell us which you want to work, which you can't, and which you can stand by for:
${url}`,
    )
  },

  /** Pick mode, once a day: the parties this person has not answered yet. Answering locks nothing. */
  pickDigest(firstName: string, items: { theme: string; dayLabel: string }[], more: number, url: string): Rendered {
    const n = items.length + more
    const NL = String.fromCharCode(10)
    const head = `${n} ${n === 1 ? 'party' : 'parties'}`
    const list = items.map(i => `${i.theme}, ${i.dayLabel}`).join('; ') + (more > 0 ? ` and ${more} more` : '')
    return r(
      `Hi ${firstName}! You haven't told us about ${head} yet: ${list}. Work it, can't, or standby? ${url}`,
      `${head} waiting for your answer`,
      `Hi ${firstName},

We haven't heard from you on ${head} yet:
${items.map(i => `- ${i.theme}, ${i.dayLabel}`).join(NL)}${more > 0 ? `${NL}- and ${more} more` : ''}

Tell us if you want to work it, can't, or can stand by. Answering doesn't lock you in; the crew is picked fairly, and nobody is put on a party without being asked first.
${url}`,
    )
  },

  /** The ones who asked to work and were not picked this round: one message for the whole round. */
  pickStandby(firstName: string, count: number, url: string): Rendered {
    const n = `${count} ${count === 1 ? 'party' : 'parties'}`
    return r(
      `Hi ${firstName}! Thanks for asking. For ${n} someone else was picked this round, so you're on standby. You'll be first asked if a spot opens: ${url}`,
      `You're on standby for ${n}`,
      `Hi ${firstName},

Thanks for asking to work. For ${n} someone else was picked this round, so you're on standby. If a spot opens you'll be asked, in turn.
See where you stand: ${url}`,
    )
  },

  /** The manager put this person on a spot (by hand, or from the ranked list): the whole shift, how to accept, and the calendar link. */
  assignedByManager(p: PartyRef): Rendered {
    const when = `${p.dayLabel}, ${p.shiftLabel ?? p.timeLabel}`
    return r(
      `You've been put on ${p.theme}, ${when}. Please open the app and tap Accept Assignment: ${p.url}${calLine(p)}`,
      `You've been assigned: ${p.theme}, ${p.dayLabel}`,
      `You've been put on ${p.theme}.\nYour shift: ${when}.\nPlease open the app and tap Accept Assignment so we know you have it:\n${p.url}${p.calUrl ? `\nAdd it to your calendar: ${p.calUrl}` : ''}`,
    )
  },

  claimConfirmed(p: PartyRef, payLabel: string | null): Rendered {
    return r(
      `You're on ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}${paren(payLabel)}. Details: ${p.url}`,
      `You're on: ${p.theme}, ${p.dayLabel}`,
      `You're on ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}.${payLabel ? ` ${payLabel} for the party.` : ''}\nDetails: ${p.url}`,
    )
  },

  confirmRequest(p: PartyRef, dueLabel: string): Rendered {
    return r(
      `Still on for ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}? Reply Y or tap ${p.url} by ${dueLabel}.${calLine(p)}`,
      `Confirm: ${p.theme}, ${p.dayLabel}`,
      `Please confirm you're still on for ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel} by ${dueLabel}.\nConfirm, or tell us you can't make it: ${p.url}${p.calUrl ? `\nAdd it to your calendar: ${p.calUrl}` : ''}`,
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
      `Confirmed for ${p.theme} ${p.dayLabel}.${setup} Thank you!${calLine(p)}`,
      `Confirmed: ${p.theme}, ${p.dayLabel}`,
      `You're confirmed for ${p.theme}, ${p.dayLabel}.${setup}${p.calUrl ? `\nAdd it to your calendar: ${p.calUrl}` : ''}`,
    )
  },

  nothingToConfirm(): Rendered {
    return r('Nothing to confirm right now.', 'Nothing to confirm', 'Nothing to confirm right now.')
  },

  dayBefore(p: PartyRef, address: string): Rendered {
    const setup = p.setupLabel ? ` Setup starts ${p.setupLabel}.` : ''
    return r(
      `Tomorrow: ${p.theme} ${p.shiftLabel ?? p.timeLabel}.${setup} ${address}`,
      `Tomorrow: ${p.theme} at ${p.shiftLabel ?? p.timeLabel}`,
      `See you tomorrow for ${p.theme}, ${p.shiftLabel ?? p.timeLabel}.${setup}\n${address}\n${p.url}`,
    )
  },

  earlyReleased(p: PartyRef, newRateLabel: string, waived: boolean, stepLabel: string, ladder: boolean): Rendered {
    if (!ladder) {
      return r(
        `You're off ${p.theme} ${p.dayLabel}. Thanks for the notice!`,
        `You're off ${p.theme}, ${p.dayLabel}`,
        `Thanks for the notice. You're off ${p.theme}, ${p.dayLabel}, and the spot is open for someone else.`,
      )
    }
    const effect = waived
      ? `Your rate stays at ${newRateLabel} a party.`
      : `Your rate is now ${newRateLabel} a party; every party you work adds ${stepLabel}.`
    return r(
      `You're off ${p.theme} ${p.dayLabel}. ${effect}`,
      `You're off ${p.theme}, ${p.dayLabel}`,
      `Thanks for the notice. You're off ${p.theme}, ${p.dayLabel}, and the spot is open for someone else. ${effect}`,
    )
  },

  coverOffer(requesterFirst: string, p: PartyRef, role: 'lead' | 'crew', payLabel: string | null, ladder: boolean): Rendered {
    const two = ladder ? ', and covering a late cancel counts as two parties toward your rate' : ''
    return r(
      `${requesterFirst} can't make ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}. You're up on the waitlist, claim ${spotWord(role)}${paren(payLabel)}: ${p.url}`,
      `Cover needed: ${p.theme}, ${p.dayLabel}`,
      `${requesterFirst} can't make ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}. You're up on the waitlist, so you get first pick: ${spotWord(role)}${comma(payLabel)}. If you can't take it, we'll ask the next person${two}.\n${p.url}`,
    )
  },

  /** A late cancel offered to everyone free that day (the manager, or autopilot): not only the standbys. */
  coverOpen(requesterFirst: string, p: PartyRef, role: 'lead' | 'crew', payLabel: string | null, ladder: boolean): Rendered {
    const two = ladder ? ', and covering a late cancel counts as two parties toward your rate' : ''
    return r(
      `${requesterFirst} can't make ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}. You're free that day, want ${spotWord(role)}${paren(payLabel)}? ${p.url}`,
      `Spot open: ${p.theme}, ${p.dayLabel}`,
      `${requesterFirst} can't make ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}, and you're free that day: ${spotWord(role)}${comma(payLabel)}. First to claim gets it${two}.\n${p.url}`,
    )
  },

  coveredRequester(p: PartyRef, ladder: boolean): Rendered {
    const keep = ladder ? " Your rate doesn't change." : ''
    return r(
      `You're covered for ${p.theme} ${p.dayLabel}.${keep} Thanks for asking early!`,
      `You're covered for ${p.theme}`,
      `Someone took your spot at ${p.theme}, ${p.dayLabel}.${keep}`,
    )
  },

  coverClaimed(p: PartyRef, payLabel: string | null, ladder: boolean): Rendered {
    const two = ladder ? ' It counts as two parties toward your rate.' : ''
    return r(
      `Thanks for covering! You're on ${p.theme} ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}${paren(payLabel)}.${two} ${p.url}`,
      `You're covering ${p.theme}, ${p.dayLabel}`,
      `Thanks for covering. You're on ${p.theme}, ${p.dayLabel} ${p.shiftLabel ?? p.timeLabel}${comma(payLabel)}.${ladder ? " Once you've worked it, it counts as two parties toward your rate." : ''}\n${p.url}`,
    )
  },

  unclaimedWarning(p: PartyRef, resetRateLabel: string, ladder: boolean): Rendered {
    const drop = ladder ? ` (that puts you back to ${resetRateLabel} a party)` : ''
    return r(
      `Nobody has taken ${p.theme} ${p.dayLabel} yet, so you're still on. Options: ${p.url}`,
      `Still uncovered: ${p.theme}, ${p.dayLabel}`,
      `Nobody has taken your spot at ${p.theme}, ${p.dayLabel} yet, so you're still on. You can keep waiting, keep the spot, or drop it anyway${drop}: ${p.url}`,
    )
  },

  droppedUncovered(p: PartyRef, rateLabel: string, waived: boolean, stepLabel: string, ladder: boolean): Rendered {
    if (!ladder) {
      return r(
        `You're off ${p.theme} ${p.dayLabel}. ${TENANT.people.customerSignoff} knows the spot is open.`,
        `You're off ${p.theme}, ${p.dayLabel}`,
        `You're off ${p.theme}, ${p.dayLabel}. ${TENANT.people.customerSignoff} knows the spot is open.`,
      )
    }
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

  partyCancelled(p: PartyRef, ladder: boolean): Rendered {
    const keep = ladder ? " Your rate doesn't change." : ''
    return r(
      `Heads up: ${p.theme} ${p.dayLabel} was cancelled.${keep}`,
      `Cancelled: ${p.theme}, ${p.dayLabel}`,
      `${p.theme} on ${p.dayLabel} was cancelled by the family.${keep}`,
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
  /** Equitable scheduling: everyone who asked fit, so the system approved them without waiting. Information. */
  pickAutoApproved(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `Approved automatically: ${p.theme}, ${p.dayLabel}`,
      text: `${memberFirst} asked to work ${p.theme}, ${p.dayLabel} ${p.timeLabel}, and everyone who asked fit the open spots, so they were approved without waiting for you. Nothing to do.
${adminUrl}`,
    }
  },
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
      text: `No standby took ${memberFirst}'s spot at ${p.theme}, ${p.dayLabel} ${p.timeLabel}, so it is being offered to everyone free that day. You only hear about it again if it is still open 48 hours before the party.\n${adminUrl}`,
    }
  },
  /** Autopilot's offer to everyone free that day went out. Information; nothing to do. */
  coverOfferedToAll(memberFirst: string, p: PartyRef, asked: number, adminUrl: string) {
    return {
      subject: `Offered to everyone free: ${p.theme}, ${p.dayLabel}`,
      text: `${memberFirst}'s spot at ${p.theme}, ${p.dayLabel} ${p.timeLabel} was offered to ${asked} crew ${asked === 1 ? 'member' : 'members'} who are free that day. ${memberFirst} stays on until someone takes it.\n${adminUrl}`,
    }
  },
  /** Nobody could even be asked: this one needs a person. */
  coverNobodyFree(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `Nobody free to cover: ${p.theme}, ${p.dayLabel}`,
      text: `${memberFirst} can't make ${p.theme}, ${p.dayLabel} ${p.timeLabel} and nobody on the crew is free to cover. ${memberFirst} stays on until you find someone:\n${adminUrl}`,
    }
  },
  /** The one routine manager touch: a published party still short of crew (or a Lead) as the day nears. */
  understaffed(p: PartyRef, crewShort: number, leadShort: boolean, daysOut: number, adminUrl: string) {
    const need = [
      leadShort ? 'a Party Lead' : null,
      crewShort > 0 ? `${crewShort} crew ${crewShort === 1 ? 'spot' : 'spots'}` : null,
    ].filter(Boolean).join(' and ')
    return {
      subject: `Short on crew: ${p.theme}, ${p.dayLabel}`,
      text: `${p.theme}, ${p.dayLabel} ${p.timeLabel} is ${daysOut} ${daysOut === 1 ? 'day' : 'days'} out and still needs ${need}. The crew has been asked already.\n${adminUrl}`,
    }
  },
  coverTaken(memberFirst: string, coverFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `Covered: ${p.theme}, ${p.dayLabel}`,
      text: `${coverFirst} took ${memberFirst}'s spot at ${p.theme}, ${p.dayLabel} ${p.timeLabel}. Nothing changes for ${memberFirst}.\n${adminUrl}`,
    }
  },
  coverWithdrawn(memberFirst: string, p: PartyRef, adminUrl: string) {
    return {
      subject: `Cancel withdrawn: ${memberFirst}, ${p.theme} ${p.dayLabel}`,
      text: `${memberFirst} can make ${p.theme}, ${p.dayLabel} after all and withdrew the cover request. They're still on.\n${adminUrl}`,
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
