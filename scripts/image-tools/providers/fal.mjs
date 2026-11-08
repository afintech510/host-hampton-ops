// fal.mjs - fal.ai provider, the second backend behind the same two functions as replicate.mjs.
//
// Ported from PARR Studio's providers/fal.mjs, trimmed to the queue REST flow (submit -> poll
// status -> fetch result). NO FAL_KEY is configured for Host Hampton and nothing here has run
// against the live API in this repo: treat it as scaffolding until someone adds a key and a
// first dry run. Auth is `Authorization: Key <FAL_KEY>`, read at call time, never logged.

import { writeFile } from 'node:fs/promises'

export const name = 'fal'
export const keyName = 'FAL_KEY'

const key = () => process.env.FAL_KEY

function assertKey() {
  if (!key()) throw new Error('FAL_KEY not set (see README: env or repo-root .env.local)')
}

const authHeaders = (extra = {}) => ({ Authorization: `Key ${key()}`, ...extra })

async function fetchRetry(url, opts, { tries = 8 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts)
    if (res.status !== 429 && res.status !== 503) return res
    if (attempt >= tries) return res
    const ra = Number(res.headers.get('retry-after'))
    const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(2000 * 2 ** attempt, 30000)
    await new Promise((r) => setTimeout(r, waitMs))
  }
}

export function resolveImageUrl(output) {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    if (Array.isArray(output.images) && output.images[0]) return output.images[0].url ?? output.images[0]
    if (output.image?.url) return output.image.url
    if (typeof output.url === 'string') return output.url
  }
  return undefined
}

export async function run({ slug, input }) {
  assertKey()
  const sub = await fetchRetry(`https://queue.fal.run/${slug}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  })
  if (!sub.ok) throw new Error(`fal submit failed (${sub.status}): ${(await sub.text()).slice(0, 400)}`)
  const submitted = await sub.json()
  if (!submitted.status_url || !submitted.response_url) throw new Error('fal submit returned no status/response URL')
  for (let i = 0; i < 300; i++) {
    const res = await fetchRetry(submitted.status_url, { headers: authHeaders() })
    if (!res.ok) throw new Error(`fal status poll failed (${res.status})`)
    const s = await res.json()
    if (s.status === 'COMPLETED') {
      const r = await fetchRetry(submitted.response_url, { headers: authHeaders() })
      if (!r.ok) throw new Error(`fal result fetch failed (${r.status})`)
      const imageUrl = resolveImageUrl(await r.json())
      if (!imageUrl) throw new Error(`${slug} completed but returned no image URL`)
      return { imageUrl, predictionId: submitted.request_id }
    }
    if (['FAILED', 'ERROR', 'CANCELLED'].includes(s.status)) {
      throw new Error(`fal job ${s.status}: ${s.error ?? 'unknown'}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('fal job timed out')
}

export async function download(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const ct = res.headers.get('content-type') || ''
  const ext = ct.includes('webp') ? 'webp' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'png'
  const finalPath = destPath.replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext
  await writeFile(finalPath, Buffer.from(await res.arrayBuffer()))
  return finalPath
}
