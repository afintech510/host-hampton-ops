# Local photos -> the photo library: audit and proposed pipeline

Status: **proposal plus a 30-photo pilot.** Nothing was imported, approved or published.
Written 2026-11-05. Numbers marked "sample" come from a random sample and carry wide error bars.

## 1. What exists

**The library** (`media_assets`, migration 083, read from production 2026-11-05):

| Source | Rows | Approved |
|---|---|---|
| `gallery` (the hand-curated `/gallery` set) | 61 | 61 |
| `instagram` (Muse's index, imported as candidates) | 66 | 3 |

No real party theme has an approved photo. Of the nine `party_themes`, none has one
(`sweets-treats` and `spa-party` have no rows at all); the only themed approvals are two
`trucker-hat-party` rows, which is not a `party_themes` slug.

**The local catalog** (`audit_scratch/`, gitignored):

- Source `iCloud Photos\Photos` is 63,959 files. The first pass found `near_studio = 0` only
  because the studio coordinates in the code are wrong; once corrected, **6,371 files lie within
  0.1 mi** and 6,370 were copied to `HostHampton-Content` (4,201 HEIC, 30 JPEG/JPG, 2,139 MOV).
  So the stale note "near_studio = 0, pass was not studio-only" is wrong in its second half: the
  pool *is* the studio. It is simply the whole shop (retail, receipts, notes, staff), not only
  parties.
- `content_scores_merged.csv` scored 6,342 of them (28 missing): 4,212 photos, 2,130 videos, with
  sharpness, brightness and a **Haar** face count.
- The visual triage kept 181 of 290 shortlisted items; the 142 photo picks are about two thirds
  retail merchandise. That is a property of the shortlist (ranked by "faces" and sharpness, and the
  Haar detector fires on shelving and fabric), not of the pool.

**Bug found in passing (not fixed here):** `src/tenant/hosthampton.ts` still has
`latitude: 40.8432, longitude: -72.6823`, which feeds the schema.org `LocalBusiness` markup. The
earlier pass geocoded the address to about `40.8188, -72.7044`, and the photo GPS cluster sits there,
agreeing with it. The site's structured data points roughly 1.9 mi away.

## 2. Funnel (measured, and sample-extrapolated)

| Stage | Count | How |
|---|---|---|
| Scored photos | 4,212 | existing catalog |
| No Haar face | 2,281 | existing catalog |
| Sharp (>=300 Laplacian var) and exposed (80-210) | 1,804 | `pipeline.py prefilter` |
| One frame per burst (90 s) | **779** | same; 1,025 burst frames dropped |
| ...and **no face by YuNet + profile** | **~280** (sample: 86 of 240 = 36%) | `pipeline.py faces`, 240 random |
| ...and a venue / decor / setup shot | **~85-110** (sample: 9-12 of 30) | hand-tagged pilot |

The key finding is the fourth row: **the Haar "faces = 0" the old catalog trusted is wrong in the
dangerous direction.** 64% of the Haar-zero, burst-deduped sample (154 of 240) still has a face
found by YuNet or the profile cascade. About half of those were weak detections (score under 0.5,
75 of 154, likely shelving and mannequins), so some are recoverable by a human; none should be
recovered automatically.

The last row is a 30-photo sample: 9 clear decor/setup shots (30%), 3 more that are brand or
activity shots (venue sign, trucker-hat bar), 4 retail, and the rest unusable (a POS screen, a
ceiling, a hand-written note with a name and phone number, a torn cloth, wrists). A 95% interval on
30% of 30 is roughly 15-49%, so read "~85-110" as "tens, not hundreds, and not a handful".

**Expect roughly 100 usable local photos from the pre-filtered pool**, concentrated in
in-studio setups: soft-play/toddler rooms, dessert carts and balloon towers, table settings,
neon and candy walls, the Barbie photo frame. That would fill real theme gaps (toddler, sweets and
treats, Barbie, trucker-hat, Treat Yourself) but contributes **no `mobile_party` photos**: those were
taken at clients' homes and sit in the "GPS elsewhere" and "no GPS" pools (about 18,000 and 6,757 files
before the correction) that were never copied or triaged.

## 3. Pilot (30 photos, run 2026-11-05)

Random 30 of the face-clean sample; contact sheets viewed by hand; 13 tagged; `export` ran.

- **11 exported** as WebP (<=1200 px, EXIF/GPS/ICC verified absent after re-encode) with a CSV in Muse's
  columns: `audit_scratch/image-tools/photo-pilot/pilot-muse-format.csv`,
  `.../pilot-webp/`, contact sheet `.../pilot-candidates-sheet.jpg`.
- **2 correctly refused** (a child's hair from behind, and a table with a person far in the background):
  the tagger said `unsure`, and only an explicit `no` passes, the same rule `screenMuseRow` applies.
- **Nothing was approved.** These are candidates for a human to review.

## 4. Tag vocabulary (Muse's, from 242 rows over five batches)

Use exactly these; `export` refuses a tag outside them.

- `party_type`: `in_studio_theme`, `mobile_party`, `public_event`, `not_a_party`
- `venue`: `studio`, `at_home`, `outside_venue`, `unsure`
- `theme_slug`: `custom`, `trucker-hat-party`, `swiftie-party`, `glow-party`, `kpop-party`,
  `barbie-party`, `sweets-treats`, `spa-party`, `toddler-party`, `slime-party`, `race-car-party`,
  `sleep-under-party`, `none`
- `activities` (pipe-separated): `character-visit`, `trucker-hat-bar`, `permanent-jewelry`, `soft-play`,
  `hair-tinsel`, `photo-booth`, `dance-party`, `canvas-painting`, `balloon-dog-painting`,
  `donut-decorating`, `sand-art`, `seashell-decorating`, `manicure`, `cake-decorating`,
  `glitter-tattoos`, `lip-gloss-charms`, `perfume-making`, `bracelet-making`, `decoden`
- `decor_tags`: `table-setup`, `balloon-garland`, `backdrop`, `cake`, `treat-table`, `glow-lights`,
  `candy-wall`, `neon-sign`, `balloon-arch`, `balloon-tower`, `tents`
- `identifiable_child_face`: only `no` is ever imported. `quality` 1-5, `confidence` low/medium/high.

## 5. Proposed pipeline

```
HostHampton-Content (local originals, never modified)
  1. prefilter     existing scores -> photos, no Haar face, sharp, exposed, one per burst
  2. faces         YuNet + profile cascade; ANY hit = reject; writes face_flags.csv
  3. dedupe        perceptual hash vs the 61 gallery WebPs and the Instagram rows  (NOT BUILT)
  4. tag           vision model or a human, Muse's vocabulary and prompt; strict `no` for faces
  5. human look    contact sheets; the owner rejects anything with a person, a name, a number
  6. export        WebP <=1200 px, metadata dropped, verified; CSV in Muse's columns + source_key
  7. import        the phone-album importer (upload-album.mjs); rows land approved=false
  8. approve       at /admin/photo-library, by a person, as today
```

Steps 1, 2, 6 and the contact sheets are built (`scripts/image-tools/photo-pipeline/pipeline.py`).
Run them with `python -I`. The tool belt's safety guard also reads `face_flags.csv`, so a photo with a face
(or no check on record) is refused as a reference image by the generator.

**Tagging at scale (step 4).** Tagging 779 photos by hand is a few hours. A vision model can do it with
Muse's schema; the repository already has an Anthropic key. Do not run it blind: tag the 86-photo clean
set from this sample first, compare with a human on 30, and only then run the roughly 280.
Cost depends on the model and image size; measure on 20 images and multiply, rather than trusting a
figure written here.

**The safety layers, in order:** the detector rejects anything with a face; the tagger must say `no`;
`export` re-checks both; the importer takes the same `no` rule and sets `approved = false`; the database
CHECK forbids approval without `no_identifiable_faces`; a person approves. The detector is the weakest
link for faces turned away or very small, which is exactly why a human look (step 5) is not optional.

## 6. Gaps (reuse vs. rebuild)

1. **RESOLVED (2026-11-05): the Instagram importer could not take a local file.** Another session shipped a phone-album importer
   (`importLocalPhoto`, `POST /api/admin/photo-library/album`, `lib/mediaImage.ts`) while this was written, so this branch uses it rather
   than carrying a second one. `pipeline.py export` now writes its CSV (`<name>-album.csv`: `ig_permalink` = a private album reference,
   `media_url` = `items/<file>`), and `photo-pipeline/upload-album.mjs <name> [--yes]` plans, then uploads one photo per request
   (dry run by default; needs `HH_ADMIN_PASSWORD`). A test pins that an exported row passes the album screen.
2. **Tags are not validated on import.** `screenMuseRow` passes `party_type` and `theme_slug` through as
   free text. Muse's vocabulary has 13 themes and `party_themes` has 9 (`custom` and `trucker-hat-party`
   are not in it). Decide whether `theme_slug` means "a planner theme" or "any theme Muse saw".
3. **No marker for AI-generated images.** The tool belt makes images; `media_assets` has no
   `ai_generated` flag and `source` has no value for it. Before any generated image can become a
   candidate, add the marker, so `findPhotos` and the Assistant can never present one as a real party.
4. **No dedupe against what is already live.** The 61 gallery WebPs carry no link to their originals.
   A perceptual-hash pass is the only way to avoid re-importing them.
5. **The old shortlist's face column is unreliable** (section 2); do not reuse `shortlist_*` or
   `curated_*` for the library. They are fine as a record of what was reviewed.
6. **28 files unscored, 2,139 videos unaddressed.** The library is photo-only; Instagram video thumbnails
   are the model for video (one still frame per clip, same face rule). Out of scope until decided.
7. **Mobile parties:** the pool that would supply them was never triaged, and location is no longer a
   usable filter there. Likely a date-and-content pass instead, or asking for client-approved photos.
8. **Consent path:** a photo with a child in it is not recoverable by editing. The options remain crop,
   blur, silhouette, or a parent's consent through the existing consent-release flow, and a photo
   used that way would need its own approved row and a recorded consent, not a face check.

## 7. Open decisions for the owner

1. ~~Import path~~ done (the album importer, adapted). Decide when to upload the 11 pilot candidates (unapproved).
2. Run the vision tagging on the ~280 clean photos, or tag by hand? And the model and budget.
3. Should weakly flagged photos (detector score under 0.5, about 31% of the sample) get a human rescue
   pass? They are probably shelving, but a person must say so.
4. Is an in-studio room with the studio's retail stock visible acceptable, or should retail shelves be a
   crop-out criterion?
5. Mobile-party photos: triage the off-site pools, or request approved photos from clients?
6. Fix the studio coordinates in `src/tenant/hosthampton.ts` (separate change)?

## 8. Reels (Instagram): tags attach to the reel, nobody needs the slices

Muse tagged 5 sampled frames ("slices") from each of 48 reels, plus a 3-reel pilot (255 rows). The decision (owner, 2026-11-05): the slice
pictures are not imported and not needed; a visitor **watches the reel on Instagram** (click-to-load embed; the library already holds each
reel's permalink); Muse's slice tags are folded into **one row per reel** and attached to it.

- **Aggregation** (`photo-pipeline/reel_aggregate.py`): tags are the union across slices; party type, venue and theme the commonest; quality the
  median; the child verdict the **worst** of the five (any `yes` makes the reel `yes`, else any `unsure`, and only all-`no` is `no`).
  Result: 28 reels `no`, 11 `unsure`, 12 `yes` (of 51).
- **Import** (`POST /api/admin/photo-library/import` with `source: "reels"`, `lib/media.ts importReelTags`, driven by `upload-reels.mjs`):
  an existing reel is re-tagged; a reel with a child flagged loses its face flag **and** any approval in the same write; a new reel is added
  unapproved, with a face-free still where one exists and otherwise the placeholder (`/images/reel-placeholder.svg`). A child-flagged reel
  never gets a picture stored. `dryRun: true` reports the plan and writes nothing. Nothing here can approve.
- **The Instagram data export** (reels.json + media files) holds only Nov 2025 onward: 37 reels as mp4, none of the 22 older Muse reels.
  It has no shortcode, so a reel is matched to Muse's by posting date (+-1 day); 26 of the 29 in-range reels matched one video.
  `ig_export_reels.py --posters` cuts a still for each all-`no` reel with exactly one matching video, from a frame where a face detector at a
  deliberately low threshold finds none (17 made; the other 11 all-`no` reels have no export video and get the placeholder).
  The export also holds DMs, comments and ~1,400 story files: it must stay out of the repository (`.gitignore` now covers `instagram-*/`).
- **A caution the numbers support:** Muse's five frames are a sample of a 20-30 s video. A 1-frame-per-second face scan found a face somewhere
  in 12 of the 14 matched reels Muse called all-`no`; the detector has false positives (blur, patches, jars), but a spot check also found children
  in two reels Muse had called `no`. The owner chose to take the all-`no` reels as Muse tagged them; approval is still a person
  watching. `ig_export_reels.py --scan` writes the per-reel scan if a review queue ordered by risk is wanted later.
