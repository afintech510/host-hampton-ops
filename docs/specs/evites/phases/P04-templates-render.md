# P04 — Templates, InviteCanvas, render pipeline

**Branch:** `feat/evites`. **Spec:** §5, §6. **Inputs:** the P01 spike (`scripts/evite-spike/`) and its verdict. If P01 chose resvg, use `@resvg/resvg-js` where the spec says sharp-rasterise.

## Tasks
1. `lib/evites/templates/glow.ts` and `plain.ts` per the §6 `TemplateLayout` type, transcribed from the handoff JSON and tuned to what the spike proved. Add a `templates/index.ts` registry.
2. `components/evites/InviteCanvas.tsx`:
   - props `{template, facts, sizes, mode: 'web'|'satori'}`
   - absolutely positioned; every multi-child `div` has `display:flex` (a Satori requirement)
   - `web` mode may add `filter: drop-shadow`
   - image `src` is a public path in web mode and a data URI in satori mode
3. `lib/evites/render.ts`: `renderEvite(supabase, eviteId, {force})` exactly per spec §5 steps 1–8:
   - claim token
   - random object suffix
   - conditional final UPDATE
   - 300,000-byte assert
   - error path
   Plus `queueRender(eviteId)` on `globalThis.__eviteRenderQueue` (concurrency 1, max 20 waiting).
   **No `next/og` import. No `loadAdditionalAsset`.** All image-bound text goes through `screenForImage`, and sizes through `fit.ts`.
4. Storage upload via the supabase client: `.storage.from('evites').upload(path, buf, {contentType:'image/jpeg', cacheControl:'31536000', upsert:false})`. Read `{error}`.
5. Delete `scripts/evite-spike/`, or keep only the runner if the orchestrator wants it for the box check.

## Tests
- Template schema test: fonts, images and binds exist; ids unique.
- `renderEvite` with a fake supabase and a fake storage:
  - output JPEG RGB 1200×630 < 300 KB (use sharp `metadata()`)
  - portrait 1085×1530
  - `fresh` short-circuit
  - `busy` when claimed
  - takeover: the final UPDATE affects 0 rows → result left alone
  - upload failure → `render_error` set, claim cleared, old objects untouched
  - **a global fetch spy records zero calls**
- `InviteCanvas` renders in web mode (RTL smoke test) with name and without (star visible).

## Acceptance checks
- [ ] Jest is green. `tsc` is clean. **`npx next build` passes**, proving satori/yoga wasm resolve under the standalone build.
- [ ] The report includes the rendered Mia OG and portrait written to a temp dir, for the orchestrator to eyeball against the mocks.
