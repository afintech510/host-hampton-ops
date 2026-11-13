/**
 * The two writes behind the extra-pictures routes (host: `/api/portal/invitation/images`, admin:
 * `/api/admin/parties/[id]/invitation/images`). One implementation, so the two cannot drift.
 *
 *   addExtraImage(supabase, evite, form)      multipart form (`image`, optional `alt`) -> outcome
 *   removeExtraImage(supabase, evite, object) removes ONE entry of THIS evite and its Storage object
 *
 * `evite` is a row the caller already found through its own gate (the portal cookie's booking, or the
 * admin's booking id), never an id from a body. Page-only: nothing here re-renders the invitation.
 * The type is judged by MAGIC BYTES and the size on the bytes read; no file name is read, stored or logged.
 */

import type { getSupabase } from '@/lib/supabase'
import {
  EXTRA_IMAGE_MAX_BYTES,
  EXTRA_OBJECT,
  MAX_EXTRA_IMAGES,
  cleanExtraAlt,
  newExtraObject,
  processExtraImage,
  screenExtraImagesValue,
  sniffImageType,
  type ExtraImage,
} from '@/lib/evites/extraImages'

type Supa = ReturnType<typeof getSupabase>

const BUCKET = 'evites'
const IMAGE_KEY = /^[0-9a-f]{32}$/

export interface ExtraTarget {
  id: string
  image_key: string | null
  extra_images: unknown
}

export type ExtraOutcome = { ok: true; images: ExtraImage[]; object: string } | { ok: false; status: number; error: string }

const fail = (status: number, error: string): ExtraOutcome => ({ ok: false, status, error })

export async function addExtraImage(supabase: Supa, evite: ExtraTarget, form: FormData): Promise<ExtraOutcome> {
  const current = screenExtraImagesValue(evite.extra_images)
  if (current.length >= MAX_EXTRA_IMAGES) return fail(409, `An invitation can have up to ${MAX_EXTRA_IMAGES} extra pictures. Remove one first.`)
  if (!IMAGE_KEY.test(evite.image_key ?? '')) {
    return fail(409, 'Your invitation picture is still being made. Try again in a minute.')
  }

  const file = form.get('image')
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') return fail(400, 'Choose a picture to add.')
  const blob = file as Blob
  if (blob.size > EXTRA_IMAGE_MAX_BYTES) return fail(413, 'That picture is over 10 MB. Please choose a smaller one.')
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.length > EXTRA_IMAGE_MAX_BYTES) return fail(413, 'That picture is over 10 MB. Please choose a smaller one.')
  if (bytes.length === 0 || sniffImageType(bytes) === null) return fail(415, 'Please choose a JPEG, PNG or WebP picture.')

  let jpeg: Buffer
  try {
    jpeg = await processExtraImage(bytes)
  } catch {
    return fail(422, 'That picture could not be read. Please try another.')
  }

  const object = newExtraObject()
  const up = await supabase.storage.from(BUCKET).upload(`${evite.image_key}/${object}`, jpeg, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  })
  if (up.error) {
    console.error(`evites/extraImages: upload failed: ${up.error.message}`)
    return fail(502, 'Could not save that picture - try again.')
  }

  const next = [...current, { object, alt: cleanExtraAlt(form.get('alt')) }]
  const { data, error } = await supabase.from('evites').update({ extra_images: next }).eq('id', evite.id).is('archived_at', null).select('id')
  if (error || !data || data.length === 0) {
    if (error) console.error(`evites/extraImages: save failed: ${error.message}`)
    await supabase.storage.from(BUCKET).remove([`${evite.image_key}/${object}`])
    return error ? fail(503, 'Could not save that picture - try again.') : fail(404, 'no-invitation')
  }
  return { ok: true, images: next, object }
}

export async function removeExtraImage(supabase: Supa, evite: ExtraTarget, object: unknown): Promise<ExtraOutcome> {
  if (typeof object !== 'string' || !EXTRA_OBJECT.test(object)) return fail(400, 'Say which picture to remove.')
  const current = screenExtraImagesValue(evite.extra_images)
  if (!current.some((e) => e.object === object)) return fail(404, 'That picture is not on this invitation.')

  const next = current.filter((e) => e.object !== object)
  const { data, error } = await supabase.from('evites').update({ extra_images: next }).eq('id', evite.id).select('id')
  if (error) {
    console.error(`evites/extraImages: remove failed: ${error.message}`)
    return fail(503, 'Could not remove that picture - try again.')
  }
  if (!data || data.length === 0) return fail(404, 'no-invitation')
  // The entry is gone first; a Storage miss only leaves an unreferenced object, never a broken page.
  if (IMAGE_KEY.test(evite.image_key ?? '')) {
    const rm = await supabase.storage.from(BUCKET).remove([`${evite.image_key}/${object}`])
    if (rm.error) console.error(`evites/extraImages: storage remove failed: ${rm.error.message}`)
  }
  return { ok: true, images: next, object }
}
