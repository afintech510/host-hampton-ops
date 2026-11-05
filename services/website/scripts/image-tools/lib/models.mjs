// models.mjs - the model registry: what each model is for, what it costs, how to call it.
//
// `costUsd` is an ESTIMATE used by the spend guard, and `verified` says how far to trust it:
//   'billing'  confirmed against the Replicate billing dashboard (PARR Studio, 2026-08-24)
//   'measured' derived from a prediction's own metrics
//   'estimate' read from a model page or remembered; the guard treats it as a ceiling-ish guess
// Re-check the dashboard before a big run. A wrong price here makes the cap wrong, not the bill.
//
// `verdict` is what two projects learned the hard way (PARR's model-tests/*/VERDICT.md and the
// RSE merch work). It is shown by `models` and is the reason the defaults are what they are.

export const MODELS = {
  'nano-banana-pro': {
    provider: 'replicate',
    slug: 'google/nano-banana-pro',
    kind: 'generate',
    costUsd: { '1K': 0.15, '2K': 0.15, '4K': 0.3 },
    verified: 'billing',
    input: ({ prompt, refs, resolution, aspectRatio }) => ({
      prompt,
      resolution,
      output_format: 'png',
      ...(refs.length ? { image_input: refs } : {}),
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    }),
    verdict:
      'DEFAULT. Takes up to 14 reference images and composites them rather than redrawing, so a ' +
      'supplied product/artwork survives. Best text. Honours "wide shot" framing. 1 failure in ' +
      'PARR\'s small sample (timeouts), so the client retries transients.',
  },
  'nano-banana-2': {
    provider: 'replicate',
    slug: 'google/nano-banana-2',
    kind: 'generate',
    costUsd: { '1K': 0.1, '2K': 0.1, '4K': 0.1 },
    verified: 'billing',
    input: ({ prompt, refs, resolution, aspectRatio }) => ({
      prompt,
      resolution,
      output_format: 'png',
      ...(refs.length ? { image_input: refs } : {}),
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    }),
    verdict:
      'Cheap drafts. Same fidelity as the pro on PARR\'s room-mockup test (the supplied art stayed ' +
      'intact) and followed scene briefs more literally. 33% cheaper, not a step change. Poster ' +
      'text quality was not tested.',
  },
  'grok-imagine': {
    provider: 'replicate',
    slug: 'xai/grok-imagine-image',
    kind: 'generate',
    costUsd: { '1K': 0.02, '2K': 0.02, '4K': 0.02 },
    verified: 'billing',
    input: ({ prompt, refs }) => ({ prompt, ...(refs[0] ? { image: refs[0] } : {}) }),
    verdict:
      'Cheapest ($0.02) but it REPAINTS a supplied image and ignores wide-shot framing. Good only ' +
      'for throwaway first drafts or flat graphics. Returns JPEG; aspect_ratio is ignored when ' +
      'editing. Do not use where the supplied image must survive exactly.',
  },
  'flux-2-pro': {
    provider: 'replicate',
    slug: 'black-forest-labs/flux-2-pro',
    kind: 'generate',
    // $0.015 + $0.015 per megapixel, input AND output counted. The ref is billed too.
    costUsd: { '1K': 0.075, '2K': 0.135, '4K': 0.135 },
    verified: 'measured',
    input: ({ prompt, refs, aspectRatio }) => ({
      prompt,
      output_format: 'png',
      ...(refs.length ? { input_images: refs.slice(0, 8) } : {}),
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    }),
    verdict:
      'Not recommended: only ~10% cheaper than the pro at 4 MP (the reference image is billed ' +
      'too), restyled a painting into impasto, and ignored wide-shot framing.',
  },
  'kontext-pro': {
    provider: 'replicate',
    slug: 'black-forest-labs/flux-kontext-pro',
    kind: 'generate',
    costUsd: { '1K': 0.04, '2K': 0.04, '4K': 0.04 },
    verified: 'estimate',
    input: ({ prompt, refs, aspectRatio }) => ({
      prompt,
      output_format: 'png',
      safety_tolerance: 2,
      aspect_ratio: aspectRatio || 'match_input_image',
      ...(refs[0] ? { input_image: refs[0] } : {}),
    }),
    verdict:
      'Single-image edit. Used on the RSE merch (a flat design -> an embroidered patch). On a whole ' +
      'product photo it re-renders the product itself and garbles small text, so only give it the ' +
      'piece you want transformed, on its own.',
  },
  'ideogram-v3': {
    provider: 'replicate',
    slug: 'ideogram-ai/ideogram-v3-balanced',
    kind: 'generate',
    costUsd: { '1K': 0.06, '2K': 0.06, '4K': 0.06 },
    verified: 'estimate',
    input: ({ prompt, aspectRatio }) => ({ prompt, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) }),
    verdict:
      'Text-to-image where the WORDS matter (signs, banners, merch tags). Spelled "RSE" correctly ' +
      'for the RSE accessories. No reference-image port here.',
  },
  'recraft-upscale': {
    provider: 'replicate',
    slug: 'recraft-ai/recraft-crisp-upscale',
    kind: 'upscale',
    costUsd: { default: 0.01 },
    verified: 'estimate',
    input: ({ image }) => ({ image }),
    verdict:
      'DEFAULT upscaler. Used on the RSE sweatshirt mockups. Returns WebP. Real-ESRGAN was rejected ' +
      'there: chenille lettering went metallic with halos.',
  },
  'bg-remove': {
    provider: 'replicate',
    slug: '851-labs/background-remover',
    kind: 'cutout',
    costUsd: { default: 0.01 },
    verified: 'estimate',
    input: ({ image }) => ({ image }),
    verdict: 'Background removal for product/merch cut-outs (RSE patches). PNG with alpha.',
  },
  // fal route, ported from PARR for provider parity. No FAL_KEY is configured for Host Hampton,
  // so nothing here has been run in this repo.
  'fal-esrgan': {
    provider: 'fal',
    slug: 'fal-ai/esrgan',
    kind: 'upscale',
    costUsd: { default: 0.01 },
    verified: 'estimate',
    input: ({ image }) => ({ image_url: image }),
    verdict: 'fal.ai ESRGAN upscale. Untested in this repo (no FAL_KEY).',
  },
  'fal-flux-dev': {
    provider: 'fal',
    slug: 'fal-ai/flux/dev',
    kind: 'generate',
    costUsd: { '1K': 0.012, '2K': 0.024, '4K': 0.05 },
    verified: 'estimate',
    input: ({ prompt }) => ({ prompt, num_images: 1, output_format: 'png', image_size: 'square_hd' }),
    verdict: 'fal.ai FLUX-dev, text-to-image only (no reference port). Untested in this repo.',
  },
}

export const DEFAULT_MODEL = { generate: 'nano-banana-pro', upscale: 'recraft-upscale', cutout: 'bg-remove' }

export function getModel(name, kind) {
  const m = MODELS[name]
  if (!m) throw new Error(`Unknown model "${name}". Known: ${Object.keys(MODELS).join(', ')}`)
  if (kind && m.kind !== kind) throw new Error(`Model "${name}" is for ${m.kind}, not ${kind}`)
  return m
}

/** Estimated USD for one call. */
export function estimate(model, resolution = '2K') {
  const c = model.costUsd
  return c[resolution] ?? c.default ?? Math.max(...Object.values(c))
}
