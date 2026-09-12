import { permanentRedirect } from 'next/navigation'

/**
 * /classes was folded into /events.
 *
 * `permanentRedirect` (308), not `redirect` (307). A 307 tells Google the move
 * is temporary: it keeps /classes in the index showing /events' content, so the
 * two URLs compete and none of /classes' history transfers. A 308 consolidates
 * them. The content move is permanent, so the status code should say so.
 */
export default function Classes() {
  permanentRedirect('/events')
}
