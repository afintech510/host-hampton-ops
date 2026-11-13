/**
 * The server-only half of extra pictures: the sharp step and the random object name. Kept apart from
 * extraImages.ts because a client component imports that one, and webpack cannot bundle sharp for the browser.
 */

import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { EXTRA_IMAGE_MAX_WIDTH } from '@/lib/evites/extraImages'

export { sniffImageType } from '@/lib/evites/customArtFit'

export function newExtraObject(): string {
  return `extra-${randomBytes(8).toString('hex')}.jpg`
}

/** Auto-orient, resize to at most 1200 px wide (never enlarged, never cropped), flatten on white, JPEG q86. Throws if unreadable. */
export async function processExtraImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: EXTRA_IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer()
}
