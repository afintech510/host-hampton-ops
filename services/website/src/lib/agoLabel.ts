/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
export function agoLabel(iso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
