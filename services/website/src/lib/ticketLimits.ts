/**
 * How many tickets one order may carry.
 *
 * Its own module, and not a `const` in either checkout route, for two reasons:
 * both routes need the same number (rule 11 — a constant declared in two files is
 * a constant nothing is checking), and **a Next App Router `route.ts` may export
 * only the handler names and the framework's own config keys.** `export const FOO`
 * in a route file is a build-time type error that neither jest nor
 * `tsc --noEmit` reports — link 19 shipped exactly that and only
 * `npx next build` caught it.
 */
export const MAX_TICKETS_PER_ORDER = 50
