/** Departure labels live in the existing private admin notes; removed remains the access-control status. */
export type StaffStatus = 'active' | 'paused' | 'archived' | 'quit' | 'fired'
const MARKER = /^\[Staff status: (Archived|Quit|Fired)\]\n?/
export function staffStatus(status: string, notes: string | null): StaffStatus {
  if (status === 'active' || status === 'paused') return status
  return (MARKER.exec(notes ?? '')?.[1].toLowerCase() as StaffStatus | undefined) ?? 'archived'
}
export function staffNotes(notes: string | null): string {
  return (notes ?? '').replace(MARKER, '')
}
export function staffStatusUpdate(status: StaffStatus, notes: string): { status: 'active' | 'paused' | 'removed'; admin_notes: string } {
  const clean = staffNotes(notes).trim()
  if (status === 'active' || status === 'paused') return { status, admin_notes: clean }
  const label = status[0].toUpperCase() + status.slice(1)
  return { status: 'removed', admin_notes: `[Staff status: ${label}]${clean ? `\n${clean}` : ''}` }
}
