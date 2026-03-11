import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'

const MAX_WIDTH = 1600
const WEBP_QUALITY = 82
const BUCKET = 'media'

/**
 * GET /api/admin/media — list uploaded media files
 * Query: ?limit=50&offset=0&search=filename
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = req.nextUrl
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)
  const search = searchParams.get('search') || ''

  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list('', {
      limit,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
      search: search || undefined,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Build public URLs for each file
  const items = (files || [])
    .filter(f => f.name !== '.emptyFolderPlaceholder')
    .map(f => {
      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(f.name)
      return {
        name: f.name,
        url: publicUrl,
        size: f.metadata?.size || 0,
        type: f.metadata?.mimetype || '',
        created_at: f.created_at,
      }
    })

  return NextResponse.json({ files: items })
}

/**
 * POST /api/admin/media — upload a file
 * FormData: file (required), convert_webp ('true'/'false')
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const convertWebp = formData.get('convert_webp') === 'true'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use JPG, PNG, WebP, GIF, or HEIC.' }, { status: 400 })
  }

  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large. Max 15MB.' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const inputBuffer = Buffer.from(arrayBuffer)

  let finalBuffer: Buffer
  let contentType: string
  let ext: string

  if (convertWebp) {
    try {
      finalBuffer = await sharp(inputBuffer)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
      contentType = 'image/webp'
      ext = 'webp'
    } catch (err) {
      console.error('Sharp processing error:', err)
      return NextResponse.json({ error: 'Failed to convert image' }, { status: 500 })
    }
  } else {
    finalBuffer = inputBuffer
    contentType = file.type
    ext = file.name.split('.').pop() || 'jpg'
  }

  // Clean original filename for use as base
  const baseName = file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60)

  const fileName = `${baseName}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, finalBuffer, {
      contentType,
      upsert: false,
    })

  if (uploadError) {
    console.error('Storage upload error:', uploadError)
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(fileName)

  return NextResponse.json({
    url: publicUrl,
    name: fileName,
    size: finalBuffer.length,
    type: contentType,
  })
}

/**
 * DELETE /api/admin/media — delete a file
 * Body: { name: string }
 */
export async function DELETE(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { name } = await req.json()

  if (!name) {
    return NextResponse.json({ error: 'File name required' }, { status: 400 })
  }

  const { error } = await supabase.storage.from(BUCKET).remove([name])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: name })
}
