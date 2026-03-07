/**
 * Mock NextRequest/NextResponse for API route testing.
 * Creates a minimal NextRequest-like object.
 */

export function createMockNextRequest(options: {
  method?: string
  url?: string
  body?: any
  headers?: Record<string, string>
  searchParams?: Record<string, string>
} = {}) {
  const url = new URL(options.url || 'http://localhost:3002/api/test')

  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value)
    }
  }

  const headers = new Headers(options.headers || {})

  return {
    method: options.method || 'GET',
    url: url.toString(),
    nextUrl: url,
    headers: {
      get: (name: string) => headers.get(name),
      has: (name: string) => headers.has(name),
      entries: () => headers.entries(),
    },
    json: jest.fn().mockResolvedValue(options.body || {}),
    text: jest.fn().mockResolvedValue(
      typeof options.body === 'string' ? options.body : JSON.stringify(options.body || {})
    ),
  }
}

/**
 * Extract the response body and status from NextResponse.json() calls.
 */
export function parseNextResponse(response: any) {
  // NextResponse.json returns an object with status and json() method
  return {
    status: response.status,
    body: response.json ? response.json() : null,
  }
}
