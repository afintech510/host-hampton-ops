/**
 * A reader for the outbound-template sources, used by
 * `src/__tests__/lib/emailTemplateEscaping.test.ts`.
 *
 * Why this exists at all: the escaping gap in `lib/emailTemplates.ts` survived
 * two reviews because *nothing fails* when somebody adds a 26th template that
 * interpolates a customer-written field straight into markup. A test that reads
 * the sources off disk is the only thing that stops the next one, the same way
 * `slugSafety.test.ts` walks `src/app` and `experimentsSchema.test.ts` parses a
 * migration. It deliberately reads the FILE, not the rendered output, because a
 * rendered-output test only covers the templates somebody remembered to render.
 *
 * It is a lexer, not a type checker. It finds every `${…}` inside a template
 * literal, works out whether that literal is building HTML, and decides whether
 * the interpolated expression still reaches a data field without passing through
 * `escapeHtml` (for text) or a URL screen (for an `href`/`src`).
 */

import fs from 'fs'
import path from 'path'

export const WEBSITE_SRC = path.resolve(__dirname, '../../')

/** Calls whose ARGUMENT is neutralised, i.e. the escape/screen vocabulary. */
const NEUTRALISING_CALLS = [
  'escapeHtml',
  'safeSiteLink',
  'safeImageUrl',
  'encodeURIComponent',
  'encodeURI',
]

/** Roots that name caller-supplied data inside a template function. */
const DATA_ROOTS = ['d', 'data', 'p', 'params', 'row', 'item', 'i', 's', 'v', 'e', 'opts', 'input']

/**
 * Expressions that are safe by construction and would otherwise be noise: the
 * brand palette, the shared static blocks, and pure arithmetic.
 */
const STRUCTURALLY_SAFE = /^(?:BRAND\.[A-Za-z]+|footer|contactBlock|SITE_URL|SITE_ORIGIN)$/

export interface Interp {
  file: string
  line: number
  /** Source text of the expression between `${` and its matching `}`. */
  expr: string
  /** True when the enclosing template literal is building markup. */
  html: boolean
  /** `href` / `src` / `url(` when the interpolation lands inside one. */
  urlAttr: string | null
  /** Data references that survive after neutralising calls are stripped. */
  rawRefs: string[]
  /** Nearest preceding function/const declaration name. */
  fn: string
  /** True when the whole expression is a call to a function declared in this file. */
  inFileCall: boolean
  /** Every symbol the expression still reaches after screens are stripped. */
  symbols: string[]
}

/**
 * Remove quoted string literals from an expression.
 *
 * Load-bearing: without it, the prose inside a literal is read as identifiers,
 * and `footerTagline('Your space. Your vision. We make it happen.')` was
 * reported as interpolating a field called `vision`. A scanner that invents
 * findings is worse than one that misses them, because the next person turns it
 * off (rule 15's shape, applied to a test).
 */
export function stripStringLiterals(expr: string): string {
  return expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
}

/** Every identifier / member path left after neutralising calls are stripped. */
export function survivingSymbols(expr: string): string[] {
  const stripped = stripStringLiterals(stripNeutralised(expr))
  const out = new Set<string>()
  const re = /(?:^|[^A-Za-z0-9_$.'"])([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)/g
  for (const m of stripped.matchAll(re)) {
    const sym = m[1]
    if (/^(?:true|false|null|undefined|new|typeof|Math|Number|String|Date|Object|JSON|length|toFixed|map|join|split|slice|replace|filter|toLocaleString|toUpperCase|toLowerCase|trim|padStart|charAt)$/.test(sym)) continue
    if (STRUCTURALLY_SAFE.test(sym)) continue
    out.add(sym)
  }
  return [...out]
}

interface Literal {
  start: number
  end: number
  html: boolean
  interps: { start: number; end: number; expr: string }[]
  /** static text of the literal with `${…}` removed */
  statics: string
}

/* ── lexing ──────────────────────────────────────────────────── */

const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c)

/**
 * Walk the source and return every TOP-LEVEL template literal with the
 * interpolations it contains (nested literals are walked too, and their
 * interpolations are attributed to the nested literal, because that is the
 * literal whose HTML-ness decides how the value must be treated).
 */
export function templateLiterals(src: string): Literal[] {
  const out: Literal[] = []
  let i = 0
  const n = src.length

  // A minimal scanner over strings, comments, regexes and template literals.
  const scan = (from: number, stopAtBrace: boolean): number => {
    let depth = 0
    let j = from
    while (j < n) {
      const c = src[j]
      const c2 = src[j + 1]
      if (c === '/' && c2 === '/') {
        j = src.indexOf('\n', j)
        if (j === -1) return n
        continue
      }
      if (c === '/' && c2 === '*') {
        const k = src.indexOf('*/', j + 2)
        j = k === -1 ? n : k + 2
        continue
      }
      if (c === "'" || c === '"') {
        j = skipQuoted(src, j)
        continue
      }
      if (c === '`') {
        j = readTemplate(src, j, out)
        continue
      }
      if (stopAtBrace) {
        if (c === '{') depth++
        else if (c === '}') {
          if (depth === 0) return j
          depth--
        }
      }
      j++
    }
    return j
  }

  const readTemplate = (s: string, open: number, sink: Literal[]): number => {
    const lit: Literal = { start: open, end: -1, html: false, interps: [], statics: '' }
    let j = open + 1
    while (j < s.length) {
      const c = s[j]
      if (c === '\\') {
        lit.statics += s[j + 1] ?? ''
        j += 2
        continue
      }
      if (c === '`') {
        lit.end = j
        break
      }
      if (c === '$' && s[j + 1] === '{') {
        const exprStart = j + 2
        const exprEnd = scan(exprStart, true)
        lit.interps.push({ start: exprStart, end: exprEnd, expr: s.slice(exprStart, exprEnd) })
        j = exprEnd + 1
        continue
      }
      lit.statics += c
      j++
    }
    if (lit.end === -1) lit.end = s.length
    lit.html = /<[A-Za-z!/]/.test(lit.statics) || /style\s*=\s*"/.test(lit.statics)
    sink.push(lit)
    return lit.end + 1
  }

  const skipQuoted = (s: string, open: number): number => {
    const q = s[open]
    let j = open + 1
    while (j < s.length) {
      if (s[j] === '\\') {
        j += 2
        continue
      }
      if (s[j] === q) return j + 1
      if (s[j] === '\n') return j // unterminated; bail rather than run away
      j++
    }
    return j
  }

  i = scan(0, false)
  return out
}

/* ── expression analysis ─────────────────────────────────────── */

/** Remove the arguments of every neutralising call, nesting-aware. */
export function stripNeutralised(expr: string): string {
  let out = expr
  for (const name of NEUTRALISING_CALLS) {
    let guard = 0
    for (;;) {
      const idx = findCall(out, name)
      if (idx === -1) break
      const open = out.indexOf('(', idx)
      const close = matchParen(out, open)
      out = out.slice(0, idx) + '«safe»' + out.slice(close + 1)
      if (++guard > 200) break
    }
  }
  return out
}

function findCall(s: string, name: string): number {
  let from = 0
  for (;;) {
    const idx = s.indexOf(name + '(', from)
    if (idx === -1) return -1
    const before = idx === 0 ? '' : s[idx - 1]
    if (!isIdentChar(before) && before !== '.') return idx
    from = idx + 1
  }
}

function matchParen(s: string, open: number): number {
  let depth = 0
  for (let j = open; j < s.length; j++) {
    if (s[j] === '(') depth++
    else if (s[j] === ')') {
      depth--
      if (depth === 0) return j
    }
  }
  return s.length - 1
}

const DATA_REF = new RegExp(
  '(?:^|[^A-Za-z0-9_$.])(' + DATA_ROOTS.join('|') + ')\\.([A-Za-z_$][A-Za-z0-9_$]*)',
  'g'
)

/** Data references in an expression that are NOT inside a neutralising call. */
export function rawDataRefs(expr: string, taintedLocals: Set<string>): string[] {
  const stripped = stripNeutralised(expr)
  const refs = new Set<string>()
  for (const m of stripped.matchAll(DATA_REF)) refs.add(`${m[1]}.${m[2]}`)
  for (const local of taintedLocals) {
    const re = new RegExp('(?:^|[^A-Za-z0-9_$.])' + local + '(?![A-Za-z0-9_$])')
    if (re.test(stripped)) refs.add(local)
  }
  return [...refs]
}

/**
 * Locals whose initializer reaches a data field raw.
 *
 * A local initialised from a TEMPLATE LITERAL is not tainted — it is an HTML
 * fragment whose own interpolations are checked individually. A local
 * initialised from a plain expression touching `d.x` is tainted, which is what
 * makes `const firstName = d.customerName.split(' ')[0]` visible.
 */
export function taintedLocals(src: string): Set<string> {
  const out = new Set<string>()
  const re = /(?:^|\n)\s*(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*([^\n]*)/g
  for (const m of src.matchAll(re)) {
    const name = m[1]
    const init = m[2].trim()
    if (init.startsWith('`')) continue
    const stripped = stripNeutralised(init)
    if (DATA_REF.test(stripped)) out.add(name)
    DATA_REF.lastIndex = 0
  }
  return out
}

/* ── URL attribute detection ─────────────────────────────────── */

/**
 * Look back through the static text for an unterminated `href="`, `src="` or
 * `url(`. The lookback is the literal's own static text, so an interpolation in
 * the body of the mail never reads as a URL just because a link appeared
 * earlier.
 */
export function urlAttrBefore(statics: string): string | null {
  const tail = statics.slice(-400)
  const m = tail.match(/(href|src|url|action|background)\s*=\s*"([^"]*)$/i)
  if (m) return m[1].toLowerCase()
  const p = tail.match(/url\(\s*'?([^)'"]*)$/i)
  if (p) return 'url()'
  return null
}

/* ── the scan ────────────────────────────────────────────────── */

/** Functions declared in this file — a call to one is that function's business. */
export function declaredFunctions(src: string): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1])
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) out.add(m[1])
  return out
}

export function scanSource(file: string, src: string): Interp[] {
  const locals = taintedLocals(src)
  const lits = templateLiterals(src)
  const declared = declaredFunctions(src)
  const out: Interp[] = []
  const lineOf = lineIndexer(src)
  const fnOf = fnIndexer(src)

  for (const lit of lits) {
    // rebuild the static prefix before each interpolation
    for (const interp of lit.interps) {
      const prefix = staticPrefix(src, lit, interp.start)
      out.push({
        file,
        line: lineOf(interp.start),
        expr: interp.expr.trim(),
        html: lit.html,
        urlAttr: lit.html ? urlAttrBefore(prefix) : null,
        rawRefs: rawDataRefs(interp.expr, locals),
        fn: fnOf(lit.start),
        symbols: survivingSymbols(interp.expr),
        inFileCall: isWholeCallTo(interp.expr, declared),
      })
    }
  }
  return out
}

/**
 * Is the whole expression a single call to a function declared in this file?
 *
 * `${detailCard([…])}` and `${newsletterHeader(preheader)}` are builders: their
 * output is markup by construction and their bodies are scanned in their own
 * right, so judging the CALL would ask the wrong question of the wrong line.
 */
function isWholeCallTo(expr: string, declared: Set<string>): boolean {
  const m = expr.trim().match(/^([A-Za-z_$][\w$]*)\s*\(/)
  if (!m || !declared.has(m[1])) return false
  return matchParen(expr, expr.indexOf('(')) === expr.trim().length - 1
}

function staticPrefix(src: string, lit: Literal, upto: number): string {
  // walk the literal from its opening backtick to `upto`, dropping nested `${…}`
  let out = ''
  let j = lit.start + 1
  while (j < upto - 2) {
    if (src[j] === '\\') {
      out += src[j + 1] ?? ''
      j += 2
      continue
    }
    if (src[j] === '$' && src[j + 1] === '{') {
      const inner = lit.interps.find(x => x.start === j + 2)
      j = inner ? inner.end + 1 : j + 2
      out += '' // a placeholder, so an attribute value is not left open
      continue
    }
    out += src[j]
    j++
  }
  return out
}

function lineIndexer(src: string) {
  const starts: number[] = [0]
  for (let j = 0; j < src.length; j++) if (src[j] === '\n') starts.push(j + 1)
  return (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function fnIndexer(src: string) {
  const decls: { at: number; name: string }[] = []
  const re = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[=:])/g
  for (const m of src.matchAll(re)) decls.push({ at: m.index ?? 0, name: m[1] || m[2] })
  return (offset: number) => {
    let name = '(top level)'
    for (const d of decls) {
      if (d.at <= offset) name = d.name
      else break
    }
    return name
  }
}

export function scanFile(rel: string): Interp[] {
  const abs = path.join(WEBSITE_SRC, rel)
  return scanSource(rel, fs.readFileSync(abs, 'utf8'))
}
