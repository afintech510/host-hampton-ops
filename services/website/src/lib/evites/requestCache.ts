/**
 * `React.cache` where the runtime has it (the App Router's server React), the
 * identity function where it does not (jest's plain React 18.3).
 *
 * Why it exists: `generateMetadata` and the page need the same invitation, and
 * the rate-limit guard must count ONE request once. Wrapping the guarded loader
 * in `cache()` makes both calls share a single execution per request.
 *
 * A namespace import with a property read, not `import { cache }`: `cache` is not
 * in the stable `react` typings and is undefined under jest, so a named import
 * would fail one or the other.
 */

import * as React from 'react'

type AnyFn = (...args: never[]) => unknown
type CacheFn = <F extends AnyFn>(fn: F) => F

export const requestCache: CacheFn = (React as unknown as { cache?: CacheFn }).cache ?? ((fn) => fn)
