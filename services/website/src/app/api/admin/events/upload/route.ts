import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'

const MAX_WIDTH = 1600
const WEBP_QUALITY = 82

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Validate file type (accept HEIC from iPhones too)
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use JPG, PNG, WebP, GIF, or HEIC.' }, { status: 400 })
  }

  // Max 15MB (mobile photos can be large)
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large. Max 15MB.' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const inputBuffer = Buffer.from(arrayBuffer)

  // Resize + convert to WebP
  let optimized: Buffer
  try {
    optimized = await sharp(inputBuffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
  } catch (err) {
    console.error('Sharp processing error:', err)
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 })
  }

  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`

  const { error: uploadError } = await supabase.storage
    .from('event-images')
    .upload(fileName, optimized, {
      contentType: 'image/webp',
      upsert: false,
    })

  if (uploadError) {
    console.error('Storage upload error:', uploadError)
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('event-images')
    .getPublicUrl(fileName)

  return NextResponse.json({
    url: publicUrl,
    name: file.name,
  })
}
