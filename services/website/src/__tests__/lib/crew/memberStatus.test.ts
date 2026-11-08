import { staffStatus, staffStatusUpdate, staffNotes } from '@/lib/crew/memberStatus'

it.each(['archived', 'quit', 'fired'] as const)('persists %s while using the existing removed access status', status => {
  const update = staffStatusUpdate(status, 'Available weekends')
  expect(update.status).toBe('removed')
  expect(staffStatus(update.status, update.admin_notes)).toBe(status)
  expect(staffNotes(update.admin_notes)).toBe('Available weekends')
  expect(staffStatusUpdate(status, update.admin_notes)).toEqual(update)
})

it('keeps old removed staff archived and can reactivate without losing ordinary notes', () => {
  expect(staffStatus('removed', null)).toBe('archived')
  const archived = staffStatusUpdate('archived', 'Good helper')
  expect(staffStatusUpdate('active', archived.admin_notes)).toEqual({ status: 'active', admin_notes: 'Good helper' })
})
