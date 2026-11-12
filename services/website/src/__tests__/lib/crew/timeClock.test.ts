import {
  distanceFromStudio, etWeekStart, weeklyBreakdown, haversineM, hoursLabel, minutesWorked, onStudioNetwork, punchFlags, screenFix,
  type PunchRow, type TimeConfig,
} from '@/lib/crew/timeClock'

const cfg: TimeConfig = { studio_ips: ['203.0.113.7'], studio_lat: 40.8187586, studio_lng: -72.7044091, radius_m: 150 }

const punch = (over: Partial<PunchRow> = {}): PunchRow => ({
  id: 'p', member_id: 'm', punched_in_at: '2026-11-09T14:00:00Z', punched_out_at: '2026-11-09T22:00:00Z',
  in_lat: null, in_lng: null, in_accuracy_m: null, in_location_status: 'ok', in_distance_m: 20, in_ip: null, in_on_studio_network: true,
  out_lat: null, out_lng: null, out_accuracy_m: null, out_location_status: 'ok', out_distance_m: 30, out_ip: null, out_on_studio_network: true,
  edited_by: null, edited_at: null, admin_note: null, ...over,
})

describe('screenFix', () => {
  it('keeps a good fix', () => {
    expect(screenFix({ lat: 40.8, lng: -72.7, accuracy: 12.4 })).toEqual({ status: 'ok', lat: 40.8, lng: -72.7, accuracyM: 12 })
  })
  it('reads denied as denied and drops any coordinates sent with it', () => {
    expect(screenFix({ locationStatus: 'denied', lat: 1, lng: 1 })).toEqual({ status: 'denied', lat: null, lng: null, accuracyM: null })
  })
  it.each([[{}], [{ lat: 'x', lng: 1 }], [{ lat: 91, lng: 0 }], [{ lat: 0, lng: 181 }], [{ lat: NaN, lng: 0 }]])('refuses %j as unavailable', body => {
    expect(screenFix(body).status).toBe('unavailable')
  })
})

describe('distance and network', () => {
  it('is zero at the studio and about 1.1 km per 0.01 degree of latitude', () => {
    expect(haversineM(40.8187586, -72.7044091, 40.8187586, -72.7044091)).toBe(0)
    const d = haversineM(40.8187586, -72.7044091, 40.8287586, -72.7044091)
    expect(d).toBeGreaterThan(1100); expect(d).toBeLessThan(1120)
  })
  it('has no distance without a fix', () => {
    expect(distanceFromStudio({ status: 'denied', lat: null, lng: null, accuracyM: null }, cfg)).toBeNull()
  })
  it('network: true / false / unknown', () => {
    expect(onStudioNetwork('203.0.113.7', cfg)).toBe(true)
    expect(onStudioNetwork('198.51.100.1', cfg)).toBe(false)
    expect(onStudioNetwork(null, cfg)).toBeNull()
    expect(onStudioNetwork('203.0.113.7', { ...cfg, studio_ips: [] })).toBeNull()
  })
})

describe('punchFlags', () => {
  it('is empty for a clean shift', () => {
    expect(punchFlags(punch(), cfg)).toEqual([])
  })
  it('flags denied location, far away, off network, open shift and edits', () => {
    const f = punchFlags(punch({ in_location_status: 'denied', out_distance_m: 5200, out_on_studio_network: false, punched_out_at: null, edited_at: '2026-11-10T00:00:00Z' }), cfg)
    expect(f).toEqual(expect.arrayContaining(['In: location denied', 'Out: 5.2 km from the studio', 'Out: not on the studio network', 'Still clocked in', 'Edited by admin']))
  })
  it('an unknown network is not a flag', () => {
    expect(punchFlags(punch({ in_on_studio_network: null, out_on_studio_network: null }), cfg)).toEqual([])
  })
})

describe('hours', () => {
  it('counts minutes and labels them', () => {
    expect(minutesWorked(punch())).toBe(480)
    expect(hoursLabel(485)).toBe('8h 05m')
  })
  it('an open shift runs to now', () => {
    expect(minutesWorked(punch({ punched_out_at: null }), new Date('2026-11-09T15:30:00Z'))).toBe(90)
  })
  it('weeks start on Monday, Eastern', () => {
    expect(etWeekStart('2026-11-09T14:00:00Z')).toBe('2026-11-09') // Monday
    expect(etWeekStart('2026-11-15T03:00:00Z')).toBe('2026-11-09') // Saturday night ET
    expect(etWeekStart('2026-11-16T04:30:00Z')).toBe('2026-11-09') // still Sunday night ET
  })
})

describe('weeklyBreakdown', () => {
  it('groups punches by Eastern Monday week, newest first, with a total per week', () => {
    const now = new Date('2026-11-11T18:00:00Z')
    const weeks = weeklyBreakdown([
      punch({ id: 'a', punched_in_at: '2026-11-09T14:00:00Z', punched_out_at: '2026-11-09T22:00:00Z' }),
      punch({ id: 'b', punched_in_at: '2026-11-10T14:00:00Z', punched_out_at: '2026-11-10T16:30:00Z' }),
      punch({ id: 'c', punched_in_at: '2026-11-03T14:00:00Z', punched_out_at: '2026-11-03T15:00:00Z' }),
    ], now)
    expect(weeks.map(w => [w.weekStart, w.minutes])).toEqual([['2026-11-09', 630], ['2026-11-02', 60]])
    expect(weeks[0].punches.map(p => p.id)).toEqual(['b', 'a'])
  })
  it('counts an open shift up to now', () => {
    const weeks = weeklyBreakdown([punch({ punched_in_at: '2026-11-11T14:00:00Z', punched_out_at: null })], new Date('2026-11-11T15:30:00Z'))
    expect(weeks[0].minutes).toBe(90)
  })
  it('a Sunday-night punch belongs to the week that began the Monday before', () => {
    const weeks = weeklyBreakdown([punch({ punched_in_at: '2026-11-09T03:00:00Z', punched_out_at: '2026-11-09T04:00:00Z' })])
    expect(weeks[0].weekStart).toBe('2026-11-02')
  })
})
