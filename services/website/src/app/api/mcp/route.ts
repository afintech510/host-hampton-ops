import { NextRequest, NextResponse } from 'next/server'
import { featureEnabled } from '@/tenant'
import { guardRate, MINUTE_MS } from '@/lib/rateLimit'
import { handleRpc, type RpcResponse } from '@/lib/mcp/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mcp — the public Model Context Protocol endpoint (Streamable HTTP,
 * stateless, JSON responses). Add it in ChatGPT (Settings → Connectors /
 * Apps) or Claude (Connectors → Add custom connector) as
 * `https://<site>/api/mcp`, no authentication.
 *
 * GET answers 405: this server opens no server-to-client stream, which the
 * spec allows.
 */

// Generous: an assistant makes several calls per conversation, and ChatGPT's
// egress addresses are shared by many users, so a tight per-caller bucket would
// throttle everyone at once. The per-route ceiling is the half that holds.
const mcpRule = { route: 'mcp', perCaller: 200, perRoute: 2000, windowMs: 10 * MINUTE_MS }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version, mcp-session-id',
}

const MAX_BODY_BYTES = 64_000
const MAX_BATCH = 20

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  return NextResponse.json(
    { error: 'This MCP server accepts POST (Streamable HTTP, JSON responses).' },
    { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } },
  )
}

export async function POST(req: NextRequest) {
  if (!featureEnabled('publicMcp')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS })
  }
  const limited = guardRate(req, mcpRule)
  if (limited) {
    limited.headers.set('Access-Control-Allow-Origin', '*')
    return limited
  }

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } },
      { status: 413, headers: CORS },
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS })
  }

  const batch = Array.isArray(parsed)
  const messages = (batch ? (parsed as unknown[]) : [parsed]).slice(0, MAX_BATCH)
  const replies: RpcResponse[] = []
  for (const m of messages) {
    const r = await handleRpc((m && typeof m === 'object' ? m : {}) as never, req)
    if (r) replies.push(r)
  }

  // Only notifications/responses arrived: 202 with no body, per the spec.
  if (replies.length === 0) return new NextResponse(null, { status: 202, headers: CORS })
  return NextResponse.json(batch ? replies : replies[0], { status: 200, headers: CORS })
}
