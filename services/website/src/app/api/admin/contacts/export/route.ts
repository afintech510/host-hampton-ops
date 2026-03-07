import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = req.nextUrl
  const format = searchParams.get('format') || 'google-ads'

  // Fetch all opted-in contacts with email
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('first_name, last_name, email, phone')
    .eq('email_opt_in', true)
    .not('email', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ error: 'No contacts to export' }, { status: 404 })
  }

  if (format === 'google-ads') {
    // Google Ads Customer Match CSV format
    const header = 'Email,First Name,Last Name,Phone'
    const rows = contacts.map(c => {
      const email = (c.email || '').trim().toLowerCase()
      const first = (c.first_name || '').trim()
      const last = (c.last_name || '').trim()
      const phone = normalizePhone(c.phone)
      return `${csvEscape(email)},${csvEscape(first)},${csvEscape(last)},${csvEscape(phone)}`
    })
    const csv = [header, ...rows].join('\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="hosthampton-customer-match-${today()}.csv"`,
      },
    })
  }

  if (format === 'meta') {
    // Meta (Facebook) Custom Audience CSV format
    const header = 'email,fn,ln,phone'
    const rows = contacts.map(c => {
      const email = (c.email || '').trim().toLowerCase()
      const first = (c.first_name || '').trim().toLowerCase()
      const last = (c.last_name || '').trim().toLowerCase()
      const phone = normalizePhone(c.phone)
      return `${csvEscape(email)},${csvEscape(first)},${csvEscape(last)},${csvEscape(phone)}`
    })
    const csv = [header, ...rows].join('\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="hosthampton-meta-audience-${today()}.csv"`,
      },
    })
  }

  return NextResponse.json({ error: 'Invalid format. Use google-ads or meta' }, { status: 400 })
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

function normalizePhone(phone: string | null): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.trim()
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
