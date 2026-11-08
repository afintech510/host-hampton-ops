// index.mjs - provider selector. A model in lib/models.mjs names its provider; IMAGE_PROVIDER is
// only the fallback for a model that does not (none today). Both providers expose the same two
// functions: run({slug, input}) -> {imageUrl, predictionId} and download(url, path) -> path.

import * as replicate from './replicate.mjs'
import * as fal from './fal.mjs'

const PROVIDERS = { replicate, fal }

export function pickProvider(name) {
  const p = PROVIDERS[name ?? process.env.IMAGE_PROVIDER ?? 'replicate']
  if (!p) throw new Error(`Unknown provider "${name}" (expected replicate or fal)`)
  return p
}
