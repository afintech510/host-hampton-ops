export const dynamic = 'force-dynamic'

/**
 * Domain verification for the ChatGPT directory: OpenAI's plugin portal shows a
 * token and fetches it back from this exact path, expecting the token as plain
 * text and nothing else. Unset (every day but the one you submit) answers 404.
 * docs/ai-agents-launch.md.
 */
export async function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim()
  if (!token) return new Response('Not found', { status: 404 })
  return new Response(token, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
