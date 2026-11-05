/**
 * What the manager is looking at when they open the assistant.
 *
 * The browser sends `{ page, booking_ref }` every turn so "add a balloon garland
 * to this" resolves to the plan on screen. Both values are SCREENED here to a
 * closed vocabulary before they reach the system prompt or a table key: the
 * page is one of a few names (never a free path), and the ref must look like a
 * ref. A context that does not screen is dropped, not trusted — it only ever
 * narrows what "this" means, it never grants anything (the tools still look the
 * booking up and every write is still a confirmed card).
 */

export const ASSISTANT_PAGES = ['invoice', 'admin', 'assistant'] as const
export type AssistantPage = (typeof ASSISTANT_PAGES)[number]

export interface AssistantContext {
  page: AssistantPage
  bookingRef: string | null
}

const REF = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/

export const GENERAL_CONTEXT: AssistantContext = { page: 'assistant', bookingRef: null }

export function screenContext(raw: unknown): AssistantContext {
  if (!raw || typeof raw !== 'object') return GENERAL_CONTEXT
  const o = raw as { page?: unknown; booking_ref?: unknown; bookingRef?: unknown }
  const page = (ASSISTANT_PAGES as readonly string[]).includes(String(o.page)) ? (o.page as AssistantPage) : 'admin'
  const refRaw = typeof o.booking_ref === 'string' ? o.booking_ref : typeof o.bookingRef === 'string' ? o.bookingRef : ''
  const ref = refRaw.trim()
  return { page, bookingRef: REF.test(ref) ? ref : null }
}

/** One thread per admin per context: the booking when there is one, else the general thread. */
export function contextKey(ctx: AssistantContext): string {
  return ctx.bookingRef ? `booking:${ctx.bookingRef}` : 'general'
}

/** The sentence added to the system prompt. Built only from screened values. */
export function contextPromptLine(ctx: AssistantContext): string | null {
  if (!ctx.bookingRef) return null
  const where = ctx.page === 'invoice' ? 'the customer-facing invoice page' : 'the admin dashboard'
  return `The manager has ${where} open for party ${ctx.bookingRef}. When they say "this", "this party", "the plan" or "the invoice", they mean ${ctx.bookingRef}: use that booking_ref in your tool calls without asking, and read it with get_party before you propose a change to it.`
}
