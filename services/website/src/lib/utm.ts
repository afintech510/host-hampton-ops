const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

export type UtmParams = Partial<Record<(typeof UTM_KEYS)[number], string>>

const STORAGE_KEY = 'hh_utm'

/** Capture UTM params from URL on page load and persist in sessionStorage */
export function captureUtm() {
  if (typeof window === 'undefined') return
  const url = new URLSearchParams(window.location.search)
  const params: UtmParams = {}
  let hasAny = false
  for (const key of UTM_KEYS) {
    const val = url.get(key)
    if (val) {
      params[key] = val
      hasAny = true
    }
  }
  if (hasAny) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(params))
  }
}

/** Get stored UTM params (from sessionStorage, persists across page navigations) */
export function getUtmParams(): UtmParams {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
