# P05 — Public invite page `/i/[slug]`, chrome gating, GA/Meta, view beacon

**Branch:** `feat/evites`. **Spec:** §7.1, §7.4, §11, §13.

## Read first
- `app/checkin/[token]/page.tsx` + `layout.tsx` (the closest analogue).
- `lib/seo.ts` (`NOINDEX`), `lib/rateLimit.ts`, `lib/publicOrigin.ts`.
- `components/{Nav,Footer,MetaPixel,AttributionCapture,BenchworksAttribution,GoogleAnalytics}.tsx`, `src/__tests__/**/navHookOrder.test.ts`.
- `lib/content/slugSafety.ts`, `next.config.js`.

## Tasks
1. **`lib/rateLimit.ts`:** add `guardRateHeaders(headers, rule)` (shares buckets with `guardRate`; derive the caller key from `cf-connecting-ip` / `x-real-ip` the same way `callerKey` does) and `DAY_MS`. Add `eviteViewRule` (per caller 60 / route 1,500 per 10 min) and `eviteRsvpRule` (10 / 600).
2. **`lib/evites/resolve.ts`:** `resolveEviteBySlug(supabase, slug)` per §7.4. Outcomes: `ok`, `redirect` (from `previous_slugs`, a 308), `notFound`. Throws on a read error.
3. **`app/i/[slug]/page.tsx`**: rate limit, then resolve, then render; `generateMetadata`; no `loading.tsx`. Plus `not-found.tsx` (one unavailable page) and `error.tsx`. `layout.tsx` sets `NOINDEX` and the no-referrer meta. Render `InviteCanvas mode="web"` and a placeholder RSVP island (buttons disabled; P06 wires them). Show state ribbons per §4.
4. **`next.config.js` `headers()`** for `/i/:path*`: `X-Robots-Tag` and `Referrer-Policy`.
5. **Chrome:** `Nav`, `Footer`, `AttributionCapture`, `BenchworksAttribution` return null on `/i/`. `MetaPixel` returns null and its effect skips on `/i/` and `/my-booking/invitation`. **Every early return goes after all hooks.** Update or extend `navHookOrder.test.ts` to cover each component.
6. **`GoogleAnalytics.tsx`:** for `/i/` paths, `gtag('set', {page_location: origin+'/i/invite', page_title:'Party invitation', page_referrer:''})` before the configs, and skip the `GADS_ID` config.
7. **`app/api/i/[slug]/event/route.ts`:** POST `{event}` with the allow-list `invite_viewed | rsvp_started`; `guardRate`; the `invite_viewed` dedupe cookie; `recordEviteEvent`; `sendMetaViewContent` on `invite_viewed`. 204.
8. **`lib/evites/analytics.ts`:** `recordEviteEvent` (reads `{error}`, never throws) and `sendMetaViewContent(req)` per §11. `META_GRAPH_VERSION` comes from env; there is no hard-coded version except a documented default. No-op without a token; 2 s `AbortController` timeout.
9. **`lib/content/slugSafety.ts`:** add `/i` to `STATIC_ROUTE_PATTERNS`.
10. **`publicIntakeSurface`:** add `/api/i/[slug]/event` to `DELIBERATELY_PUBLIC`, with a reason.

## Tests
- Page: unknown slug, archived and flag-off all produce identical not-found output. An alias produces a 308. Metadata has width/height/type and `robots` noindex. No other RSVP's data in the HTML.
- Event route: allow-list, rate limit, cookie dedupe, and the Meta payload contains no slug or name (assert the body).
- Chrome components return null on `/i/x` with the hook order intact.
- GA script for an `/i/` path contains the `set` call and no `GADS` config.
- `slugSafety` test passes.

## Acceptance checks
- [ ] Jest is green, including `publicIntakeSurface`, `slugSafety` and `navHookOrder`. `tsc` is clean. `next build` passes.
- [ ] The report lists the exact curl checks the orchestrator should run after deploy: an unknown slug gives 404, `X-Robots-Tag` is present, the OG tags are present.
