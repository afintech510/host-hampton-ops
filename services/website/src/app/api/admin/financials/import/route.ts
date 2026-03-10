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
  if (d.includes('party') || d.includes('birthday') || d.includes('celebration')) return 'Party Booking'
  if (d.includes('ticket') || d.includes('bingo') || d.includes('admission')) return 'Event Ticket'
  if (d.includes('sourdough') || d.includes('class') || d.includes('workshop') || d.includes('101')) return 'Event Ticket'
  if (d.includes('drop off') || d.includes('drop-off') || d.includes('camp') || d.includes('soft play')) return 'Event Ticket'
  if (d.includes('photo shoot') || d.includes('photoshoot') || d.includes('pet photo')) return 'Event Ticket'
  if (d.includes('room') || d.includes('rental')) return 'Room Rental'
  if (d.includes('jewelry') || d.includes('bracelet') || d.includes('necklace') || d.includes('initial necklace') || d.includes('chain')) return 'Permanent Jewelry'
  if (d.includes('canvas') || d.includes('bag') || d.includes('tote')) return 'Canvas Bags'
  if (d.includes('hat') || d.includes('trucker') || d.includes('patch') || d.includes('pouch')) return 'Trucker Hats'
  if (d.includes('food') || d.includes('drink') || d.includes('beverage') || d.includes('coffee') || d.includes('snack')) return 'Food & Beverage'
  if (d.includes('gift card') || d.includes('giftcard')) return 'Gift Card'
  if (d.includes('vendor') || d.includes('booth')) return 'Vendor Fee'
  if (d.includes('deposit') || d.includes('retainer')) return 'Deposit'
  if (d.includes('merch') || d.includes('shirt') || d.includes('sticker') || d.includes('tumbler') || d.includes('slipper') || d.includes('lip gloss') || d.includes('wrapping paper')) return 'Merchandise'
  return 'Other'
}

/* ─── GoDaddy (POS + Paylinks) ───────────────────────── */
// Actual columns: Date, Order ID, Items, Channel, Order Status, Fulfillment Mode,
// Fulfillment Status, Subtotal, Discount, Fee, Tax, Shipping, Order Total
// Sanitized: date, order_id, items, channel, order_status, order_total, subtotal

function parseGoDaddy(rows: Record<string, string>[]): TransactionRow[] {
  return rows.map(r => {
    const date = r.date || ''
    const desc = r.items || r.item || r.description || ''
    const amount = r.order_total || r.total || r.subtotal || ''
    const ref = r.order_id || r.order_number || ''
    const channel = r.channel || ''
    const status = (r.order_status || r.status || '').toLowerCase()

    // Skip refunds/voids/cancelled
    if (status === 'refunded' || status === 'voided' || status === 'cancelled') return null

    const amountCents = parseAmount(amount)
    if (amountCents <= 0) return null

    // Clean the ref — remove "Order #" prefix
    const cleanRef = ref.replace(/^Order\s*#?/i, '').trim()

    return {
      date: parseDate(date),
      description: desc || 'GoDaddy Sale',
      amount_cents: amountCents,
      source: 'godaddy',
      category: categorize(desc),
      customer_name: null,
      reference: cleanRef ? `gd-${cleanRef}` : null,
      notes: channel ? `Channel: ${channel}` : null,
    }
  }).filter(Boolean) as TransactionRow[]
}

/* ─── Squarespace ─────────────────────────────────────── */
// Actual columns: Order ID, Email, Financial Status, Paid at, Fulfillment Status,
// Currency, Subtotal, Shipping, Taxes, Amount Refunded, Total, Discount Amount,
// Lineitem quantity, Lineitem name, Lineitem price, Billing Name, ...
// Sanitized: order_id, email, financial_status, paid_at, total, lineitem_name,
// lineitem_price, billing_name, lineitem_quantity

function parseSquarespace(rows: Record<string, string>[]): TransactionRow[] {
  // Squarespace exports one row per line item — group by order_id to avoid duplicates
  const orderMap = new Map<string, { date: string; desc: string[]; total: number; customer: string; email: string }>()

  for (const r of rows) {
    const orderId = r.order_id || ''
    const status = (r.financial_status || '').toLowerCase()

    // Only import paid orders
    if (status !== 'paid') continue

    const existing = orderMap.get(orderId)
    if (existing) {
      // Add line item to existing order
      const itemName = r.lineitem_name || ''
      if (itemName && !existing.desc.includes(itemName)) {
        existing.desc.push(itemName)
      }
    } else {
      orderMap.set(orderId, {
        date: r.paid_at || r.created_at || '',
        desc: [r.lineitem_name || ''].filter(Boolean),
        total: parseAmount(r.total || ''),
        customer: r.billing_name || '',
        email: r.email || '',
      })
    }
  }

  return Array.from(orderMap.entries()).map(([orderId, order]) => {
    if (order.total <= 0) return null

    const desc = order.desc.join(', ') || 'Squarespace Sale'

    return {
      date: parseDate(order.date),
      description: desc,
      amount_cents: order.total,
      source: 'squarespace',
      category: categorize(desc),
      customer_name: order.customer || null,
      reference: orderId ? `sq-${orderId}` : null,
      notes: order.email || null,
    }
  }).filter(Boolean) as TransactionRow[]
}

/* ─── HoneyBook ───────────────────────────────────────── */
// Actual columns: COMPANY_NAME, PROJECT_NAME, PROJECT_DATE, VENDOR_INFO, CLIENT_INFO,
// INVOICE, PAYMENT_STATUS, PAYMENT_NAME, CHARGE_NOTES, PAYMENT_METHOD, DUE_DATE,
// TRANSACTION_DATE, TOTAL_AMOUNT, NET_AMOUNT, ...
// Sanitized: project_name, client_info, invoice, payment_status, payment_name,
// transaction_date, total_amount, net_amount, payment_method, charge_notes

function parseHoneyBook(rows: Record<string, string>[]): TransactionRow[] {
  return rows.map(r => {
    const date = r.transaction_date || r.due_date || r.project_date || ''
    const desc = r.project_name || r.payment_name || ''
    const amount = r.total_amount || r.net_amount || ''
    const ref = r.invoice || ''
    const status = (r.payment_status || '').toLowerCase()
    const paymentMethod = r.payment_method || ''
    const chargeNotes = r.charge_notes || ''

    // Extract client name from CLIENT_INFO (format: "Name (email)")
    const clientInfo = r.client_info || ''
    const clientMatch = clientInfo.match(/^(.+?)\s*\(/)
    const customer = clientMatch ? clientMatch[1].trim() : clientInfo

    // Skip unpaid/cancelled
    if (status !== 'paid') return null

    const amountCents = parseAmount(amount)
    if (amountCents <= 0) return null

    // Build description: project name + payment name
    const fullDesc = r.payment_name ? `${desc} — ${r.payment_name}` : desc

    return {
      date: parseDate(date),
      description: fullDesc || 'HoneyBook Payment',
      amount_cents: amountCents,
      source: 'honeybook',
      category: categorize(desc),
      customer_name: customer || null,
      reference: ref ? `hb-${ref}` : null,
      notes: [paymentMethod, chargeNotes].filter(Boolean).join(' — ') || null,
    }
  }).filter(Boolean) as TransactionRow[]
}
