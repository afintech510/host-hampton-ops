import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/* POST /api/admin/financials/import — bulk import from CSV */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const source = formData.get('source') as string

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }
  if (!['godaddy', 'squarespace', 'honeybook'].includes(source)) {
    return NextResponse.json({ error: 'Invalid source. Must be godaddy, squarespace, or honeybook' }, { status: 400 })
  }

  const text = await file.text()
  const rows = parseCSV(text)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found in file' }, { status: 400 })
  }

  // Map rows to transactions based on source
  let transactions: TransactionRow[]
  try {
    if (source === 'godaddy') {
      transactions = parseGoDaddy(rows)
    } else if (source === 'squarespace') {
      transactions = parseSquarespace(rows)
    } else {
      transactions = parseHoneyBook(rows)
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 400 })
  }

  if (transactions.length === 0) {
    return NextResponse.json({ error: 'No valid transactions found in file' }, { status: 400 })
  }

  // Deduplicate against existing records by reference
  const supabase = getSupabase()
  const refs = transactions.map(t => t.reference).filter(Boolean)
  let existingRefs = new Set<string>()

  if (refs.length > 0) {
    const { data: existing } = await supabase
      .from('financial_transactions')
      .select('reference')
      .eq('source', source)
      .in('reference', refs)

    existingRefs = new Set((existing || []).map(e => e.reference))
  }

  const newTransactions = transactions.filter(t => !t.reference || !existingRefs.has(t.reference))
  const skipped = transactions.length - newTransactions.length

  if (newTransactions.length === 0) {
    return NextResponse.json({ imported: 0, skipped, errors: [] })
  }

  // Batch insert (50 at a time)
  const errors: string[] = []
  let imported = 0

  for (let i = 0; i < newTransactions.length; i += 50) {
    const batch = newTransactions.slice(i, i + 50)
    const { error } = await supabase
      .from('financial_transactions')
      .insert(batch)

    if (error) {
      errors.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`)
    } else {
      imported += batch.length
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}

/* ─── CSV Parser ─────────────────────────────────────── */

interface TransactionRow {
  date: string
  description: string
  amount_cents: number
  source: string
  category: string
  customer_name: string | null
  reference: string | null
  notes: string | null
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Parse header — handle quoted values
  const headers = parseCsvLine(lines[0])

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')] = (values[i] || '').trim()
    })
    return row
  }).filter(row => Object.values(row).some(v => v))
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/* ─── Source-specific parsers ─────────────────────────── */

function parseAmount(val: string): number {
  if (!val) return 0
  // Remove $, commas, parentheses (for negatives)
  const clean = val.replace(/[$,\s]/g, '').replace(/^\((.+)\)$/, '-$1')
  const num = parseFloat(clean)
  return isNaN(num) ? 0 : Math.round(num * 100)
}

function parseDate(val: string): string {
  if (!val) return new Date().toISOString().split('T')[0]
  // Try common date formats
  const d = new Date(val)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  // Try MM/DD/YYYY
  const parts = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (parts) {
    const year = parts[3].length === 2 ? '20' + parts[3] : parts[3]
    return `${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
  }
  return new Date().toISOString().split('T')[0]
}

function categorize(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('party') || d.includes('birthday')) return 'Party Booking'
  if (d.includes('ticket') || d.includes('event') || d.includes('admission')) return 'Event Ticket'
  if (d.includes('room') || d.includes('rental')) return 'Room Rental'
  if (d.includes('jewelry') || d.includes('bracelet') || d.includes('necklace')) return 'Permanent Jewelry'
  if (d.includes('canvas') || d.includes('bag') || d.includes('tote')) return 'Canvas Bags'
  if (d.includes('hat') || d.includes('trucker')) return 'Trucker Hats'
  if (d.includes('food') || d.includes('drink') || d.includes('beverage') || d.includes('coffee') || d.includes('snack')) return 'Food & Beverage'
  if (d.includes('gift card') || d.includes('giftcard')) return 'Gift Card'
  if (d.includes('vendor') || d.includes('booth')) return 'Vendor Fee'
  if (d.includes('deposit')) return 'Deposit'
  if (d.includes('merch') || d.includes('shirt') || d.includes('sticker')) return 'Merchandise'
  return 'Other'
}

/* ─── GoDaddy (POS + Paylinks) ───────────────────────── */
// Common GoDaddy export columns:
// Date, Order Number, Item, Quantity, Price, Total, Payment Method, Customer Name, Customer Email
// OR: Transaction Date, Transaction ID, Description, Amount, Status, Customer

function parseGoDaddy(rows: Record<string, string>[]): TransactionRow[] {
  return rows.map(r => {
    // Try various column name patterns
    const date = r.date || r.transaction_date || r.order_date || r.created || r.created_at || ''
    const desc = r.item || r.description || r.product || r.item_name || r.name || ''
    const amount = r.total || r.amount || r.price || r.net || r.gross || ''
    const ref = r.order_number || r.transaction_id || r.order_id || r.id || ''
    const customer = r.customer_name || r.customer || r.name || r.buyer || ''
    const status = (r.status || r.payment_status || '').toLowerCase()

    // Skip refunds/voids
    if (status === 'refunded' || status === 'voided' || status === 'cancelled') return null

    const amountCents = parseAmount(amount)
    if (amountCents <= 0) return null

    return {
      date: parseDate(date),
      description: desc || 'GoDaddy Sale',
      amount_cents: amountCents,
      source: 'godaddy',
      category: categorize(desc),
      customer_name: customer || null,
      reference: ref ? `gd-${ref}` : null,
      notes: null,
    }
  }).filter(Boolean) as TransactionRow[]
}

/* ─── Squarespace ─────────────────────────────────────── */
// Common Squarespace export columns:
// Order ID, Order Date, Product Name, Quantity, Unit Price, Total, Customer Email, Billing Name

function parseSquarespace(rows: Record<string, string>[]): TransactionRow[] {
  return rows.map(r => {
    const date = r.order_date || r.date || r.created_on || r.fulfilled_on || ''
    const desc = r.product_name || r.product || r.line_item || r.description || r.item || ''
    const amount = r.total || r.subtotal || r.amount || r.unit_price || ''
    const ref = r.order_id || r.order_number || r.id || r.transaction_id || ''
    const customer = r.billing_name || r.customer_name || r.name || r.customer_email || ''

    const amountCents = parseAmount(amount)
    if (amountCents <= 0) return null

    return {
      date: parseDate(date),
      description: desc || 'Squarespace Sale',
      amount_cents: amountCents,
      source: 'squarespace',
      category: categorize(desc),
      customer_name: customer || null,
      reference: ref ? `sq-${ref}` : null,
      notes: null,
    }
  }).filter(Boolean) as TransactionRow[]
}

/* ─── HoneyBook ───────────────────────────────────────── */
// Common HoneyBook export columns:
// Project Name, Client Name, Payment Date, Amount, Status, Invoice Number, Service Type

function parseHoneyBook(rows: Record<string, string>[]): TransactionRow[] {
  return rows.map(r => {
    const date = r.payment_date || r.date || r.paid_date || r.created_date || r.created || ''
    const desc = r.project_name || r.project || r.service_type || r.description || r.invoice_description || ''
    const amount = r.amount || r.total || r.payment_amount || r.net || ''
    const ref = r.invoice_number || r.payment_id || r.transaction_id || r.id || ''
    const customer = r.client_name || r.client || r.customer || r.customer_name || ''
    const status = (r.status || r.payment_status || '').toLowerCase()

    // Skip unpaid/cancelled
    if (status === 'unpaid' || status === 'cancelled' || status === 'refunded' || status === 'void') return null

    const amountCents = parseAmount(amount)
    if (amountCents <= 0) return null

    return {
      date: parseDate(date),
      description: desc || 'HoneyBook Payment',
      amount_cents: amountCents,
      source: 'honeybook',
      category: categorize(desc),
      customer_name: customer || null,
      reference: ref ? `hb-${ref}` : null,
      notes: null,
    }
  }).filter(Boolean) as TransactionRow[]
}
