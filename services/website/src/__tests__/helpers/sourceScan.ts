import fs from 'fs'
import path from 'path'

/**
 * Helpers for source-reading rules (the repo's "tripwire" style).
 *
 * `decomment` blanks comments WHILE PRESERVING OFFSETS, in one left-to-right
 * pass (see publicIntakeSurface.test.ts for why two passes corrupt files whose
 * line comments mention a block-comment opener). CRLF-tolerant by construction:
 * it never matches on a bare newline. Do not use it for proximity windows
 * without collapsing whitespace first (AGENTS.md: it preserves offsets).
 */
export function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}

/** A file under `services/website/src`, comment-stripped. */
export function readSrc(...parts: string[]): string {
  return decomment(fs.readFileSync(path.join(process.cwd(), 'src', ...parts), 'utf8'))
}
