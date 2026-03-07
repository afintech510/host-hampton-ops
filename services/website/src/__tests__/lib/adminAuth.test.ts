import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status || 200,
      json: () => body,
    }),
  },
}))

describe('isAdminAuthorized', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_PASSWORD: 'test-secret-pw' }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns true for valid Bearer token matching ADMIN_PASSWORD', () => {
    const req = {
      headers: { get: (name: string) => name === 'authorization' ? 'Bearer test-secret-pw' : null },
    } as any

    expect(isAdminAuthorized(req)).toBe(true)
  })

  it('returns false for missing authorization header', () => {
    const req = {
      headers: { get: () => null },
    } as any

    expect(isAdminAuthorized(req)).toBe(false)
  })

  it('returns false for wrong password', () => {
    const req = {
      headers: { get: (name: string) => name === 'authorization' ? 'Bearer wrong-password' : null },
    } as any

    expect(isAdminAuthorized(req)).toBe(false)
  })

  it('returns false for non-Bearer auth', () => {
    const req = {
      headers: { get: (name: string) => name === 'authorization' ? 'Basic test-secret-pw' : null },
    } as any

    expect(isAdminAuthorized(req)).toBe(false)
  })

  it('returns false when no auth header is sent', () => {
    const req = {
      headers: { get: () => null },
    } as any

    // null !== 'Bearer test-secret-pw' → false
    expect(isAdminAuthorized(req)).toBe(false)
  })
})

describe('unauthorizedResponse', () => {
  it('returns 401 status with error message', () => {
    const response = unauthorizedResponse()
    expect(response.status).toBe(401)
    const body = response.json()
    expect(body.error).toBe('Unauthorized')
  })
})
