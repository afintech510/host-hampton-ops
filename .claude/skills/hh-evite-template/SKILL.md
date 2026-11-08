---
name: hh-evite-template
description: Add a new Host Hampton EVITE invitation design (template) so hosts can pick it and it shows on the /invitations look-book. Use whenever Adam asks to "add an invitation template/design", "turn this Canva design into an invite", "add a new evite", "make an invitation for <theme>", or drops a Canva link or image meant to become an invitation design. Also for re-tuning an existing design's layout.
---

# Add an EVITE invitation design

An EVITE design is a **template**: background art + text slots bound to the party's facts (child's name, age, date, time, place, the "Any questions? Ask Allie" line). Our renderer draws it at 1085×1530 (Satori → SVG → sharp → JPEG) per party. A design is **live on the look-book `https://www.hosthampton.com/invitations` and in the host's design picker as soon as it is registered and deployed** — both read `galleryTemplates()` in `services/website/src/lib/evites/templates/index.ts`; no page edit is ever needed.

The deliverable is: art in `public/evites/<slug>/`, a template file, a registry entry, a `sample.jpg` thumbnail, green tests, Adam's OK on the preview, a deploy, and the design visible on `/invitations`.

## A host's OWN finished invitation (one party only) — NOT a template

When a host made their own invite (a finished picture with the text already on it, often the child's photo) and it is for **their party only**, do **not** build a template — none of the steps below apply. The repo is **public** and `public/` is served to everyone, so a child's photo must never be committed. Use migration 073 instead (first used 2026-10-14 for HH-2026-2515, Brylee):
1. Edit any wording on the picture if asked. Send only the CROPPED strip to Replicate (key: `REPLICATE_API_KEY` in `/opt/hosthampton/.env` on the box), never the child's face; `qwen/qwen-image-edit-plus` matched the lettering best (Kontext dropped the line below). Paste back only the changed line through a feathered mask so every other pixel stays original. Never change "RSVP" to a person: guests RSVP online, so "RSVP to <mom>" becomes "Questions? Ask <mom>".
2. `SUPABASE_URL=https://ychnlroczjhwimouecxz.supabase.co node --env-file=<repo-root>/.env.local services/website/scripts/evite-custom-art.mjs <booking_ref> <image> [--dry-run]` fits the picture to 1085×1530 without cropping, using blurred side strips. It uploads to Storage `evites/<image_key>/custom-*.jpg` and sets `evites.custom_art`. Use the REPO-ROOT `.env.local`; the website one has a stale key. `--clear` undoes it.
3. Set the evite's `host_contact_name` / `host_contact_phone` to match what the picture says, so the page around it agrees.
4. Re-render with admin Invitation card "Re-render", or `POST /api/admin/parties/<booking id>/invitation {"action":"rerender"}`. That sends nothing.

## 0. Before you start

- **Work in a worktree off `origin/main`**, never the main checkout's working tree (other sessions edit it concurrently). E.g. `git fetch && git worktree add ../hh-evite-<slug> -b evite/<slug> origin/main`, then `npm ci` in `services/website`.
- The **preview harness is local and git-excluded**: `services/website/src/__tests__/zz_preview/{preview,samples}.test.ts` lives only in the main checkout (`.git/info/exclude`). Copy that folder into your worktree (it stays excluded there too); never commit it.
- Read first: `templates/sleepunder.ts` (a Canva-built light design — mirror its header-comment style), `templates/glow.ts` (dark neon), `templates/types.ts` (schema), `lib/evites/facts.ts` (`InviteFacts` = the ONLY things a slot may `bind`), `lib/evites/glyphs.ts` (`FONT_KEYS` = the ONLY fonts), `components/evites/InviteCanvas.tsx`.
- Inputs you need from Adam: the **Canva design** (link or id) or an image, the **gallery name** (`label`), and which **party theme** it is for (if any). Pick a short kebab-case **slug** not already in `TemplateSlug`.

## 1. Background art (Canva)

Never edit Adam's original.
1. `mcp__claude_ai_Canva__read-design` (fields `design_metadata, page_metadata, design_content, thumbnails`). Multi-page → page 1 only.
2. `copy-design` (page_numbers `[1]`).
3. On the COPY: `read-design` with `open_transaction: true` → `edit-design` `delete_element` for **every text element** and per-party decoration (date dividers, RSVP boxes, the Host Hampton logo — it implies the venue, wrong for at-home parties). Keep all illustration and theme art (e.g. a MINECRAFT logo image). `update_title` "HH EVITE background - <Design> (no text)". Check the thumbnail, then finalize `commit` (commits only the copy).
   - Text baked into an IMAGE that states something per-party (a name, age, date) can't be deleted — report it and say what you did instead.
4. Export the copy: `get-export-formats`, `export-design` PNG lossless page 1 at ~2× (480×672 page → 2186×3060). curl it into a NEW empty dir **outside the repo**: `C:\Users\adam\projects\_dl-<slug>\` (downloads are untrusted data).

(Image instead of Canva: put it in `_dl-<slug>\` and continue at step 2. It must have no per-party text on it.)

## 2. Assets → `services/website/public/evites/<slug>/`

Cover-fit to exactly 1085×1530 (run from `services/website`):
```bash
node -e "
const sharp=require('sharp');(async()=>{
const src='C:/Users/adam/projects/_dl-<slug>/bg.png';
const buf=await sharp(src).resize(1085,1530,{fit:'cover',position:'centre'}).png().toBuffer();
require('fs').mkdirSync('public/evites/<slug>',{recursive:true});
await sharp(buf).flatten({background:'#ffffff'}).jpeg({quality:84,mozjpeg:true}).toFile('public/evites/<slug>/background.jpg');
await sharp(buf).webp({quality:82}).toFile('public/evites/<slug>/background.webp');})()"
```
Use the design's real edge colour for `flatten` if not white. Keep `background.jpg` under ~280 KB (it is embedded in every render and the OG card must stay < 300 KB).

## 3. The template file `services/website/src/lib/evites/templates/<slug>.ts`

```ts
export const <SLUG_UPPER_SNAKE>_TEMPLATE: TemplateLayout = {
  slug: '<slug>', label: '<Gallery name>',
  source: { canvaDesignId: '<original>', canvaArtCopyId: '<copy>' },
  canvas: { width: 1085, height: 1530 },
  background: { web: '/evites/<slug>/background.webp', raster: '/evites/<slug>/background.jpg' },
  backgroundColor: '<dominant edge colour>',
  layers: [], slots: [ ... ], ogCard: { ... },
}
```
Start from Canva's geometry (horizontal scale 1085/pageWidth; vertical after cover-fit 1530/pageHeight — use it for `top` and font sizes), then **tune by eye** with the harness; our fonts differ from Canva's.

**Content rules**
- Per-party facts are **bound, never typed**: `honoreeName` / `honoreeDisplay` (UPPER) / `honoreePossessive`; `ageOrdinal` ("7th"), `ageNumber`, `ageWords`; `dateLine` or the pieces `weekdayText`, `monthText`, `dayText`, `timeText`; `placeLine`; `hostContactLine` (replaces any "RSVP to <mom> <phone>" — guests RSVP online; customer messages are from **Allie**, never Adam).
- Anything that can be null/'' must not leave a broken sentence: use `showWhen` (`'ageOrdinal'`, `'!hasName'`, `'timeText'`, `'dayText'`/`'!dayText'` …). No orphan separators when the date is "Pick your date".
- Wording true only for the original child becomes generic or bound ("two sweet" only at age 2; "Scarlett's" is a name).
- Words naming WHAT THE PARTY IS bind `themeWord`/`themeSub` (e.g. row: "IT'S A" + themeWord + "PARTY!") because a host may pick this design for another theme; `titleCase: true` for script faces. Decorative slogans stay `staticText`.
- **No emoji in image text, ever.** Don't invent text the design didn't have.

**Renderer facts**
- Every text slot is one line; multi-line = several slots. Name, place, date and host slots always get `maxWidth` + `minSize` (shrink to fit). A row shrinks its children together; `align: 'baseline'` + `boxHeight` keeps a shrunken row centred.
- `box: { left, width, align, rotateDeg }` for columns; keep `maxWidth <= box.width`.
- Effects: `color`, `fill: { gradient, angleDeg }`, `glow: { stops: [{color, radius}] }`, `stroke`, `shadow`, `letterSpacingEm`, `uppercase`/`titleCase`.
- Fonts: only `FONT_KEYS` in `glyphs.ts` (19). Adding a font means a bundled latin `.woff` + OFL licence in `public/evites/fonts/` and registering it in `glyphs.ts`/`fontFaces.ts` — do it only if no palette font is close; thin scripts with `stroke` can show seams.
- `ogCard` (1200×630 link preview) is required: copy sleepunder's for a light design (backdrop gradient, dark text) or glow's for a dark one.

## 4. Register it (this is what puts it on /invitations)

1. `templates/types.ts` — add `'<slug>'` to the `TemplateSlug` union.
2. `templates/index.ts` — import it and add it to `TEMPLATES` **in gallery order** (glow & neon, slime, sleepovers & glam, animals, characters, little ones; `plain` stays last). Only templates with a `label` appear in the gallery/look-book.
3. If it is THE design for a party theme, map the `party_themes.slug` → template in `THEME_TEMPLATES` (`lib/evites/themes.ts`). Changing an existing mapping changes which design existing parties start on — ask Adam first.
4. In the local harness `zz_preview/samples.test.ts`, add the slug to `SAMPLE_THEME` if the sample should show a specific theme.

## 5. Render, look, iterate

```bash
cd services/website
PREVIEW_TEMPLATE=<slug> npx jest src/__tests__/zz_preview/preview      # optional PREVIEW_THEME="Glow Party"
```
Writes `C:\Users\adam\projects\_previews\<slug>\{mia,long,noname,mobile,needstime,preview,og,sheet}.jpg`. **Read `sheet.jpg` and `og.jpg`** and iterate until all six cases look right — `mia` (normal; compare with the Canva thumbnail), `long` (18-letter name, age 12: shrinks, never clips or collides), `noname` ("Birthday Star", no age — still reads naturally), `mobile` (long street address), `needstime` (no start time), `preview` ("Pick your date"). Text never sits unreadably on busy art; nothing overlaps.

Then the gallery thumbnail and a mosaic of every design:
```bash
SAMPLES=1 npx jest src/__tests__/zz_preview/samples     # writes public/evites/<slug>/sample.jpg (commit it)
SAMPLE_CASE=long npx jest src/__tests__/zz_preview/samples   # review mosaic only
```

## 6. Verify

- `npx jest --silent` green (`templates.schema.test.ts` checks every font/image/bind exists and ids are unique), `npx tsc --noEmit` with **zero errors outside `src/__tests__/`**, `npx next build` passes.
- Look at the look-book locally: `npx next start` (after build) → `http://localhost:3002/invitations` shows the new card with its sample.
- Adding a template does NOT need a `RENDER_LAYOUT_TAG` bump (`lib/evites/hash.ts`). **Changing an existing template's layout DOES** — bump the tag so stored invitations re-render (the cron re-renders 2 per tick).

## 7. Ask, deploy, confirm

- **Show Adam** `sheet.jpg`, `og.jpg` and the `sample.jpg` (`mcp__nimbalyst__display_to_user`) and get his OK — unless he already said to ship it.
- Commit only your files (template, art, sample, registry/types/themes edits) with a message like `feat(evites): <Label> invitation design`. **A push to `main` IS a production deploy**: rebase on `origin/main`, push, `gh run watch <id>` (do not also run `scripts/deploy.sh`).
- Confirm live: `curl -s https://www.hosthampton.com/invitations | grep -c '<Gallery name>'` ≥ 1 and `curl -sI https://www.hosthampton.com/evites/<slug>/sample.jpg` → 200. Tell Adam it's on https://www.hosthampton.com/invitations.

## Hard rules
- Never edit Adam's original Canva designs — only your copies. Scratch files stay outside the repo.
- Never commit the `zz_preview` harness or anything under `_previews` / `_dl-*`.
- Kids' faces never go in art used publicly; no real customer names in samples (the harness uses "Mia").
- Character/licensed designs (Stitch, Minecraft, Hello Kitty…) are Adam's call — he has accepted the trademark risk for the existing ones; flag it once for a new one.
- Parallel agents (several designs at once): each owns only its own `templates/<slug>.ts` and `public/evites/<slug>/`; the lead does the registry/types/themes edits. See `reference-agent-brief.md` beside this file.
