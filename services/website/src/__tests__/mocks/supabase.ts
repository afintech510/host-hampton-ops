/**
 * Mock Supabase client factory.
 * Returns a chainable mock that simulates Supabase PostgREST queries.
 */

export function createMockSupabase(overrides: Record<string, any> = {}) {
  const mockChain: any = {
    _resolveData: null as any,
    _resolveError: null as any,
    _resolveCount: null as number | null,
  }

  // Default return value for terminal operations
  const defaultResult = { data: null, error: null, count: null }

  // Chainable query methods
  const chainMethods = ['from', 'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'order', 'limit',
    'single', 'maybeSingle', 'range']

  const chain: any = {}

  for (const method of chainMethods) {
    chain[method] = jest.fn().mockReturnValue(chain)
  }

  // Terminal methods that return data
  chain.then = undefined // not thenable by default

  // Make select/insert/update/delete return a promise-like with data
  const makeResolvable = () => {
    // The chain itself should resolve when awaited
    const promise = Promise.resolve(overrides.result || defaultResult)
    Object.assign(chain, {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    })
    return chain
  }

  // Override select to be resolvable
  const origSelect = chain.select
  chain.select = jest.fn((...args: any[]) => {
    origSelect(...args)
    makeResolvable()
    return chain
  })

  const origInsert = chain.insert
  chain.insert = jest.fn((...args: any[]) => {
    origInsert(...args)
    makeResolvable()
    return chain
  })

  const origUpdate = chain.update
  chain.update = jest.fn((...args: any[]) => {
    origUpdate(...args)
    makeResolvable()
    return chain
  })

  // rpc mock
  chain.rpc = jest.fn().mockResolvedValue({ data: null, error: null })

  // from always returns the chain
  chain.from = jest.fn().mockReturnValue(chain)

  return chain
}

/**
 * Helper to create a mock that returns specific data for specific table queries.
 */
export function createTableMockSupabase(tableResults: Record<string, { data?: any; error?: any; count?: number }>) {
  const chain: any = {}
  const chainMethods = ['select', 'insert', 'update', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'order', 'limit',
    'single', 'maybeSingle', 'range']

  let currentResult = { data: null, error: null, count: null as number | null }

  for (const method of chainMethods) {
    chain[method] = jest.fn().mockImplementation(() => {
      const promise = Promise.resolve(currentResult)
      chain.then = promise.then.bind(promise)
      chain.catch = promise.catch.bind(promise)
      return chain
    })
  }

  chain.from = jest.fn().mockImplementation((table: string) => {
    const result = tableResults[table]
    if (result) {
      currentResult = { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }
    } else {
      currentResult = { data: null, error: null, count: null }
    }
    return chain
  })

  chain.rpc = jest.fn().mockResolvedValue({ data: null, error: null })

  return chain
}
