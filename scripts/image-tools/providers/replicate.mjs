// replicate.mjs - Replicate provider. Plain fetch (Node 18+), no SDK.
//
// Ported from PARR Studio's content-engine/image/providers/replicate.mjs: the 429/503-aware
// fetch, `Prefer: wait=60` with a polling fallback, a transient-error retry, and the download
// that fixes the file extension from the real content-type (recraft returns WebP).
// Dropped on purpose: LoRA training (no Host Hampton use) and the module-level price table
// (prices live in lib/models.mjs, next to the guard that uses them).
//
// The key is read at CALL time from REPLICATE_API_KEY and sent as `Authorization: Token ...`,
// the same as services/image and the RSE scripts. It is never logged.

import { writeFile } from 'node:fs/promises'

export const name = 'replicate'
export const keyName = 'REPLICATE_API_KEY'

const key = () => process.env.REPLICATE_API_KEY

function assertKey() {
  if (!key()) throw new Error('REPLICATE_API_KEY not set (see README: env or repo-root .env.local)')
}

// 429 (rate limit) and 503: honour retry_after / Retry-After. A low-credit account is throttled
// to a few creates a minute, and bursts of one.
async function fetchRetry(url, opts, { tries = 8 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts)
    if (res.status !== 429 && res.status !== 503) return res
    if (attempt >= tries) return res
    let waitMs = 0
    try {
      const body = await res.clone().json()
      if (body.retry_after) waitMs = (body.retry_after + 1) * 1000
    } catch {}
    if (!waitMs) {
      const ra = Number(res.headers.get('retry-after'))
      waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(2000 * 2 ** attempt, 30000)
    }
    await new Promise((r) => setTimeout(r, waitMs))
  }
}

const headers = () => ({ Authorization: `Token ${key()}`, 'Content-Type': 'application/json' })

async function create(slug, input) {
  const res = await fetchRetry(`https://api.replicate.com/v1/models/${slug}/predictions`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'wait=60' },
    body: JSON.stringify({ input }),
  })
  if (!res.ok) throw new Error(`Replicate create failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

async function wait(pred, { maxAttempts = 180, intervalMs = 2000 } = {}) {
  let p = pred
  for (let i = 0; i < maxAttempts; i++) {
    if (p.status === 'succeeded') return p.output
    if (p.status === 'failed' || p.status === 'canceled') {
      throw new Error(`Replicate ${p.status}: ${p.error ?? 'unknown'}`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
    const res = await fetchRetry(p.urls.get, { headers: { Authorization: `Token ${key()}` } })
    if (!res.ok) throw new Error(`Replicate poll failed (${res.status})`)
    p = await res.json()
  }
  throw new Error('Replicate prediction timed out')
}

export function resolveImageUrl(output) {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const first = output.find((x) => typeof x === 'string')
    if (first) return first
  }
  if (output && typeof output === 'object' && typeof output.url === 'string') return output.url
  return undefined
}

const isTransient = (msg) => /temporarily unavailable|E004|try again later|internal error|502|503/i.test(msg)

/** Run one model. Returns { imageUrl, predictionId }. Retries only transient server failures. */
export async function run({ slug, input, retries = 3 }) {
  assertKey()
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const pred = await create(slug, input)
      const imageUrl = resolveImageUrl(await wait(pred))
      if (!imageUrl) throw new Error(`${slug} succeeded but returned no image URL`)
      return { imageUrl, predictionId: pred.id }
    } catch (err) {
      lastErr = err
      if (attempt < retries - 1 && isTransient(err.message)) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

/** Download a result. The extension is corrected to the real format (recraft returns WebP), so
 *  the file on disk is never mislabelled. Returns the path written. */
export async function download(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const ct = res.headers.get('content-type') || ''
  const ext = ct.includes('webp') ? 'webp' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'png'
  const finalPath = destPath.replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext
  await writeFile(finalPath, Buffer.from(await res.arrayBuffer()))
  return finalPath
}
