/**
 * The Photo Booth section on an opened booking card (/admin/crew/bookings): paste the Fotoshare link, preview,
 * email and/or text it. It reuses the Parties tab's sender and its `send_photo_album` action, so the confirm,
 * the already-sent guard and the 8am-9pm text rule are the ones already tested in adminPhotoAlbum.test.ts.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

describe('Photo Booth section on the booking card', () => {
  const tile = read('app/admin/crew/_components/BookingTile.tsx')

  it('is a collapsed section on the open booking, below Staffing', () => {
    expect(tile).toMatch(/const \[expanded, setExpanded\] = useState\(false\)/)
    expect(tile).toContain('Photo Booth')
    expect(tile.indexOf('<Staffing tile=')).toBeLessThan(tile.indexOf('<PhotoBooth booking='))
    expect(tile.indexOf('<PhotoBooth booking=')).toBeLessThan(tile.indexOf('<PartyActions'))
  })

  it('sends through the existing PhotoAlbumSender with the admin auth header', () => {
    expect(tile).toMatch(/import PhotoAlbumSender, \{ type PhotoAlbumBooking \} from '\.\.\/\.\.\/PhotoAlbumSender'/)
    expect(tile).toMatch(/<PhotoAlbumSender key=\{booking\.id\} booking=\{booking\} headers=\{adminAuthHeaders\(\)\}/)
    expect(read('app/admin/crew/_components/adminCrew.tsx')).toMatch(/export function adminAuthHeaders\(\)/)
  })

  it('the sender still posts the guarded action', () => {
    const s = read('app/admin/PhotoAlbumSender.tsx')
    expect(s).toContain("action: 'send_photo_album', confirm: true")
    expect(s).toContain('confirm(`Send the photo booth album')
  })

  it('the booking detail route hands over exactly the sender\'s booking fields', () => {
    const r = read('app/api/admin/crew-app/booking/[id]/route.ts')
    for (const col of ['contact_name', 'contact_email', 'contact_phone', 'child_name', 'event_type', 'party_type', 'photo_gallery_url']) {
      expect(r).toMatch(new RegExp(`select\\([^)]*\\b${col}\\b`))
      expect(r).toMatch(new RegExp(`${col}: row\\.${col}`))
    }
    expect(r).toMatch(/photoAlbum: \{\s*id: row\.id,/)
    // It is the admin-only route: the gate is still the first line of the handler.
    expect(r).toMatch(/export async function GET\([^)]*\)\s*\{\s*if \(!isAdminAuthorized\(req\)\) return unauthorizedResponse\(\)/)
  })
})
