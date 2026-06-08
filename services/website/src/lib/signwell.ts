/**
 * SignWell API client — embedded rental-agreement signing.
 *
 * Free up to 25 documents/month. We create a document from a pre-built
 * template (the Studio Rental Agreement, set up in the SignWell dashboard
 * with merge fields + one signer field), prefill the reservation details,
 * and return an embedded signing URL the customer signs inside an iframe.
 *
 * Required env:
 *   SIGNWELL_API_KEY       — API key (X-Api-Key header)
 *   SIGNWELL_TEMPLATE_ID   — the agreement template's id
 * Optional env:
 *   SIGNWELL_TEST_MODE         — 'true' to use SignWell test mode (default: true off prod)
 *   SIGNWELL_SIGNER_PLACEHOLDER — recipient placeholder name in the template (default 'Client')
 *
 * Docs: https://developers.signwell.com/reference
 */

const API_BASE = 'https://www.signwell.com/api/v1'

export function isSignwellConfigured(): boolean {
  return !!(process.env.SIGNWELL_API_KEY && process.env.SIGNWELL_TEMPLATE_ID)
}

/**
 * Fetch the set of field api_ids that actually exist on the template.
 * SignWell 422-rejects a create request if template_fields references any
 * api_id the template doesn't have, so we filter our prefill to this set.
 * Returns an empty set on any error (caller then sends no prefill — signing
 * still works, details just won't auto-populate).
 */
async function getTemplateApiIds(): Promise<Set<string>> {
  const id = process.env.SIGNWELL_TEMPLATE_ID
  if (!id) return new Set()
  try {
    const res = await fetch(`${API_BASE}/document_templates/${encodeURIComponent(id)}`, { headers: headers() })
    if (!res.ok) return new Set()
    const data = (await res.json()) as { fields?: unknown }
    // fields is an array-of-arrays (per page); flatten and collect api_ids.
    const flat = Array.isArray(data.fields) ? (data.fields as unknown[]).flat() : []
    const ids = (flat as { api_id?: string }[]).map(f => f.api_id).filter((x): x is string => !!x)
    return new Set(ids)
  } catch {
    return new Set()
  }
}

function testMode(): boolean {
  if (process.env.SIGNWELL_TEST_MODE != null) {
    return process.env.SIGNWELL_TEST_MODE === 'true'
  }
  // Default: live in production, test everywhere else.
  return process.env.NODE_ENV !== 'production'
}

function headers(): Record<string, string> {
  return {
    'X-Api-Key': process.env.SIGNWELL_API_KEY || '',
    'Content-Type': 'application/json',
  }
}

/** Merge-field values, keyed by the api_id you gave each field in the template. */
export type AgreementFields = Record<string, string | number>

export interface CreateAgreementInput {
  bookingRef: string
  signerName: string
  signerEmail: string
  fields: AgreementFields
}

export interface CreateAgreementResult {
  documentId: string
  embeddedSigningUrl: string
}

/**
 * Create an embedded-signing document from the agreement template.
 * Returns the document id + the signer's embedded signing URL.
 */
export async function createEmbeddedAgreement(
  input: CreateAgreementInput
): Promise<CreateAgreementResult> {
  if (!isSignwellConfigured()) {
    throw new Error('SignWell is not configured (missing SIGNWELL_API_KEY or SIGNWELL_TEMPLATE_ID)')
  }

  const placeholder = process.env.SIGNWELL_SIGNER_PLACEHOLDER || 'Client'

  // Only send prefill for api_ids the template actually defines, or SignWell
  // 422s the whole request. As you add more fields to the template (with our
  // standard api_ids), they start auto-populating with zero code changes.
  const existing = await getTemplateApiIds()
  const template_fields = Object.entries(input.fields)
    .filter(([api_id]) => existing.has(api_id))
    .map(([api_id, value]) => ({ api_id, value: String(value) }))

  const payload = {
    test_mode: testMode(),
    template_id: process.env.SIGNWELL_TEMPLATE_ID,
    embedded_signing: true,
    embedded_signing_notifications: true,
    name: `Studio Rental Agreement — ${input.bookingRef}`,
    metadata: { booking_ref: input.bookingRef, type: 'studio_rental' },
    recipients: [
      {
        id: '1',
        placeholder_name: placeholder,
        name: input.signerName,
        email: input.signerEmail,
      },
    ],
    template_fields,
  }

  const res = await fetch(`${API_BASE}/document_templates/documents/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SignWell create document failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as {
    id: string
    recipients?: { id: string; embedded_signing_url?: string }[]
  }

  const signingUrl = data.recipients?.find(r => r.embedded_signing_url)?.embedded_signing_url
  if (!data.id || !signingUrl) {
    throw new Error('SignWell response missing document id or embedded signing URL')
  }

  return { documentId: data.id, embeddedSigningUrl: signingUrl }
}

/**
 * Best-effort fetch of the completed PDF URL for a signed document.
 * Returns null if not available yet or on error (non-fatal).
 */
export async function fetchSignedPdfUrl(documentId: string): Promise<string | null> {
  if (!process.env.SIGNWELL_API_KEY) return null
  try {
    const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(documentId)}/`, {
      headers: headers(),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { files?: { pdf_url?: string }[] }
    return data.files?.find(f => f.pdf_url)?.pdf_url ?? null
  } catch {
    return null
  }
}
