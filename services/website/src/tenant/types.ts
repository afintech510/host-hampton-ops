/**
 * The shape of one business that this codebase can run as.
 *
 * Host Hampton is tenant #1. A white-label client is a second file of this
 * shape plus the one-line change in `src/tenant/index.ts` — never a fork and a
 * find-and-replace, because a fork stops receiving every later fix (and this
 * repository has shipped a long run of money and portal security fixes).
 *
 * Rules for what goes in here:
 *
 *   * FACTS about the business that more than one file needs — name, domain,
 *     phone numbers, address, the person customer messages are signed by.
 *   * Not COPY. Page wording stays in the pages; a tenant gets its own copy by
 *     editing those pages or the DB-driven content rows.
 *   * Not SECRETS. Keys stay in `.env`; this file is committed and public.
 *
 * Every value here was previously a literal somewhere in `src/`. The
 * `tenantSurface.test.ts` ratchet counts how many of those literals remain
 * outside `src/tenant/`, and fails if the number ever goes UP.
 */

/** Modules a tenant can switch off. Unknown names are not features. */
export type FeatureName =
  /** The internal Manager chat assistant at /admin/assistant. */
  | 'managerAssistant'
  /** The public, read-mostly MCP endpoint at /api/mcp (ChatGPT / Claude connectors). */
  | 'publicMcp'
  /** `start_inquiry` on the public MCP endpoint — creates a real lead and texts the owner. */
  | 'publicMcpInquiry'

export interface TenantConfig {
  /** Stable machine id, lowercase. Used in logs and the MCP server name. */
  id: string

  business: {
    /** As written in a sentence: "Host Hampton". */
    name: string
    /** One sentence an answer engine can repeat. */
    oneLiner: string
    /** Canonical origin, no trailing slash. */
    siteUrl: string
    /** The bare apex host Cloudflare also serves, e.g. `hosthampton.com`. */
    apexHost: string
  }

  contact: {
    /** The public line, formatted for reading: `(631) 998-9325`. */
    phoneDisplay: string
    /** The same number in E.164: `+16319989325`. */
    phoneE164: string
    /** Bare 10 digits for `tel:` / `sms:` hrefs as the site has always written them. */
    phoneDigits: string
    /** The public inbox printed on the site and in schema.org. */
    email: string
    /** Where job applications are copied. */
    infoEmail: string
  }

  payments: {
    /**
     * The number Venmo/Zelle are registered to. For Host Hampton this is NOT
     * the public line — see `lib/paymentContacts.ts`.
     */
    phoneDisplay: string
    /** Venmo handle without the `@`. `VENMO_HANDLE` in the env wins. */
    venmoHandle: string
  }

  location: {
    street: string
    town: string
    region: string
    postalCode: string
    country: string
    latitude: number
    longitude: number
    /** IANA zone the business keeps its calendar in. */
    timeZone: string
  }

  social: {
    instagram: string
    facebook: string
    /** Google Business Profile share link. */
    googleBusiness: string
  }

  people: {
    /**
     * Who customer-facing messages are signed by. For Host Hampton this is
     * always Allie, never the owner.
     */
    customerSignoff: string
  }

  email: {
    /** Fallback `from` for transactional mail when `RESEND_FROM_EMAIL` is unset. */
    noReplyFrom: string
    /** Default for `OWNER_NOTIFY_EMAIL`. */
    ownerNotifyDefault: string
  }

  brand: {
    /** Header logo (300px wide). */
    logo: string
    /** Footer logo (large). */
    logoLarge: string
    /** Inline colours used by email templates and inline styles. */
    colors: {
      navy: string
      ivory: string
      blue: string
      pink: string
      footer: string
    }
  }

  features: Record<FeatureName, boolean>
}
