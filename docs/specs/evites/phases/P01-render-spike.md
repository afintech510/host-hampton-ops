# P01 — Render spike: Satori + sharp, zero network

**Branch:** `feat/evites`. Spike code lives in `services/website/scripts/evite-spike/` and is deleted or folded in at P04.
**Spec:** §5 (render pipeline), §6 (layout), §3 (facts). Target images: `docs/specs/evites/handoff/mocks/invite_mia.png` and `og_card_mia.jpg`. Reference renderer (Playwright, not to ship): `docs/specs/evites/handoff/prototype/render.js`. Layout: `docs/specs/evites/handoff/templates/glow.layout.json`. Assets: `docs/specs/evites/handoff/assets/glow/`.

**Decides:** go / no-go on Satori + sharp(librsvg), versus `@resvg/resvg-js`, versus a separate Chromium worker.

## Tasks
1. `npm i satori opentype.js` in `services/website`. Add `@fontsource/monoton @fontsource/bungee-outline @fontsource/neonderthaw @fontsource/poppins` as **devDependencies**, only to copy the `.woff` files.
2. Copy the latin `.woff` files (not `.woff2`) for Monoton 400, Bungee Outline 400, Neonderthaw 400 and Poppins 400 + 600 to `services/website/public/evites/fonts/`, with each family's OFL `LICENSE` file.
3. Optimise assets into `services/website/public/evites/glow/`:
   - `background.jpg` (1085×1530, from `background-plain.png`, mozjpeg q≈85)
   - `background.webp`
   - `icon-strip.png`, `squiggle.png`, `star.png`
   Use sharp in a one-off script. **Do not copy `source-svg/`.**
4. Write `scripts/evite-spike/render.mjs`:
   - Plain JS objects as Satori elements (no JSX needed).
   - Renders the Mia invite at 1085×1530 per the layout, then the 1200×630 OG card per `og_card`.
   - Calls `satori(el, {width, height, fonts, embedFont: true})` with **no `loadAdditionalAsset`**.
   - Rasterises with `sharp(Buffer.from(svg)).flatten({background:'#1b0630'}).jpeg({quality, mozjpeg:true})`.
   - Neon glow: stacked `textShadow`. GLOW gradient: `backgroundImage: linear-gradient(...)` + `backgroundClip: 'text'` + `color: 'transparent'`. Brackets, bar and squiggles as positioned layers.
   - Also renders a variant with **no name** ("BIRTHDAY" + star icon) and a long name ("ALEXANDRIA-ROSE") using `opentype.js` measured auto-shrink.
5. Instrument it:
   - Wrap `globalThis.fetch` and `http(s).request` to **throw** if called.
   - Time each render (wall clock) and the longest event-loop block (`perf_hooks.monitorEventLoopDelay`).
   - Record peak RSS.
6. Run locally (Node on Windows). Then write a one-command runner the orchestrator can execute **inside `node:20-alpine` on the box** with `docker run --rm --network none -m 512m -v <dir>:/w node:20-alpine node /w/render.mjs`. **Do not run it on the box yourself.** Copying the folder there and running it is the orchestrator's job.

## Acceptance checks
- [ ] Output: `out/invite_mia.jpg`, `out/og_mia.jpg`, `out/invite_noname.jpg`, `out/og_noname.jpg`, `out/invite_longname.jpg`.
- [ ] OG files are exactly 1200×630, colour type RGB, **< 300,000 bytes** (print the sizes).
- [ ] Zero network calls (the throw-on-fetch guard never fired). Print "network: 0".
- [ ] Timings and peak RSS printed per render.
- [ ] Report a side-by-side judgement against the mocks: GLOW gradient, the neon glow on each line, Neonderthaw script, bracket/bar glow, squiggles, icon strip. List every visible gap honestly.
- [ ] Recommendation: **go** (Satori + sharp), **go with resvg** (if librsvg mis-renders gradients or shadows; try `@resvg/resvg-js` on the same SVG and compare), or **no-go** (Chromium worker), with the evidence.

## Out of scope
App code, routes, DB. The spike must not touch `src/`.
