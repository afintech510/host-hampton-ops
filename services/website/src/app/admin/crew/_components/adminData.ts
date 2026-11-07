'use client'

/**
 * The crew-management app's data cache: what makes a page change instant.
 *
 * Every screen reads its data through `useAdminData(path)`. The shell warms the whole
 * set once, right after sign-in, so by the time a tab is tapped its data is already
 * here and the page paints at once from the cache; a quiet background refresh then
 * brings it up to date (stale-while-revalidate). A write elsewhere (the assistant
 * changed something) announces `hh:admin-data-changed` and every held entry is
 * re-read.
 *
 * The cache lives in module memory, which a client-side navigation between these
 * pages does not reset. It holds exactly what the signed-in admin's own requests
 * returned; reloading the page starts it empty.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

const TOKEN_KEY = 'hh_admin_token'

interface Entry {
  data: unknown
  error: string | null
  status: number
  /** ms epoch of the last successful read; 0 = never. */
  at: number
  loading: boolean
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

const EMPTY: Entry = { data: null, error: null, status: 0, at: 0, loading: false }

function set(path: string, patch: Partial<Entry>) {
  cache.set(path, { ...(cache.get(path) ?? EMPTY), ...patch })
  emit()
}

/** Read `path` into the cache. Joins a read already under way; never throws. */
export function load(path: string): Promise<void> {
  const running = inflight.get(path)
  if (running) return running
  set(path, { loading: true })
  const p = (async () => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
      const res = await fetch(path, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) set(path, { data, error: null, status: res.status, at: Date.now(), loading: false })
      else set(path, { error: (data as { error?: string }).error || `Error ${res.status}`, status: res.status, loading: false })
    } catch {
      set(path, { error: 'Could not reach the server.', status: 0, loading: false })
    } finally {
      inflight.delete(path)
    }
  })()
  inflight.set(path, p)
  return p
}

/** Start reading these now, so they are ready when their page is opened. */
export function warm(paths: string[]) {
  for (const p of paths) {
    const e = cache.get(p)
    if (!e || (!e.loading && Date.now() - e.at > 30_000)) void load(p)
  }
}

/** Mark everything held as old and re-read it. */
export function refreshAll() {
  for (const p of Array.from(cache.keys())) void load(p)
}

/** What is held for a path right now (for tests and diagnostics). */
export function peek(path: string): Readonly<Entry> | undefined {
  return cache.get(path)
}

export function clearCache() {
  cache.clear()
  emit()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export interface AdminData<T> {
  data: T | null
  error: string | null
  /** True only while there is nothing to show yet. */
  loading: boolean
  /** True while a background refresh is running over data already on screen. */
  refreshing: boolean
  status: number
  reload: () => Promise<void>
}

/**
 * `maxAgeMs` is how old held data may be before opening the page re-reads it in the
 * background; the held data is shown either way.
 */
export function useAdminData<T = any>(path: string | null, maxAgeMs = 45_000): AdminData<T> {
  const entry = useSyncExternalStore(
    subscribe,
    () => (path ? cache.get(path) ?? EMPTY : EMPTY),
    () => EMPTY,
  )

  useEffect(() => {
    if (!path) return
    const e = cache.get(path)
    if (!e || (!e.loading && Date.now() - e.at > maxAgeMs)) void load(path)
  }, [path, maxAgeMs])

  // Back to the tab / phone woken up: quietly bring it up to date.
  useEffect(() => {
    if (!path) return
    const onVisible = () => {
      const e = cache.get(path)
      if (document.visibilityState === 'visible' && e && !e.loading && Date.now() - e.at > 30_000) void load(path)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [path])

  // The assistant (or anything else) changed data.
  useEffect(() => {
    const again = () => {
      if (path) void load(path)
    }
    window.addEventListener('hh:admin-data-changed', again)
    return () => window.removeEventListener('hh:admin-data-changed', again)
  }, [path])

  const reload = useCallback(async () => {
    if (path) await load(path)
  }, [path])

  const hasData = entry.at > 0
  return {
    data: hasData ? (entry.data as T) : null,
    error: entry.error,
    loading: !hasData && (entry.loading || !entry.error),
    refreshing: hasData && entry.loading,
    status: entry.status,
    reload,
  }
}
