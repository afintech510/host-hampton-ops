# Image tool belt (local tooling)

Local scripts for generating, upscaling and cutting out images for Host Hampton. **Not a
production route**: nothing here is imported by the Next.js app, and nothing it makes is served
until a human approves it in the photo library.

Ported from PARR Studio's `content-engine/image/` (provider abstraction, 429-aware Replicate
client, model verdicts) with the RSE merch conventions (`REPLICATE_API_KEY`, `Authorization:
Token`, recraft for upscales, kontext for single-piece edits). Differences from PARR: a spend
guard and dry-run default, a safety guard, no LoRA training, outputs to a gitignored folder.

## HARD RULE: no children's faces or hair

**Do not use this to alter, swap or synthesise the faces or hair of real children in party
photos.** Not "just the hair", not "just a smile", not "a happier face". For a party photo with a
child in it, the options are: crop, blur, silhouette, or get the parent's consent through the
existing consent-release flow. (Adam asked about face-swapping with Replicate; the answer was no.)

Safe uses: decor and setup mockups, backdrops, merch mockups (RSE, fundraisers), product shots,
and upscaling or cleaning up photos that have **no people** in them.

What the tool enforces, and what it cannot:

- It refuses prompts that ask to swap/alter faces or hair, to change a person's age, or to
  depict children at all. There is no override flag. (`lib/safety.mjs`; `selftest` covers the
  phrasing, including that "hair salon", "hair bows" and "kids birthday party table" pass.)
- Any reference image needs `--face-free`, your statement that it has no people in it.
- If the photo pipeline's face check has run (`audit_scratch/image-tools/face_flags.csv`, columns
  `file,faces`), that answer overrides yours: a flagged or *unchecked* photo is refused.
- **It cannot see the picture.** A regex and a flag are a speed bump, not face detection. The
  rule is a human one; the tool makes breaking it deliberate and leaves a trail.
- Every output gets a `.json` sidecar (`ai_generated: true`, model, prompt, reference names).
  Never present an AI image as a photo of a real party.

## Setup

Needs Node 18+ and no `npm install` (plain `fetch`). The key is `REPLICATE_API_KEY`, found in
this order: the process environment, `HH_ENV_FILE`, the worktree's `.env.local`, the **primary
checkout's** repo-root `.env.local`. It is never printed (the tool shows only "set (N chars)").
`services/website/.env.local` is deliberately not read.

> As of this port **no local file holds a Replicate key**: the root `.env.local` has none and
> the RSE scripts relied on one that exists only in the box's `/opt/hosthampton/.env`. Add
> `REPLICATE_API_KEY=...` to the root `.env.local` (gitignored) before a `--yes` run. Check the
> account first: PARR's key bills a different business.

Output and the ledger go to `audit_scratch/image-tools/` of the **primary** checkout
(gitignored: `git check-ignore -v audit_scratch/image-tools/x` prints the `.gitignore` rule).
Override with `IMAGE_TOOLS_OUT`. Do not commit generated images.

## Use

```bash
T=scripts/image-tools/cli.mjs

node $T models                      # what each model is for, cost, and what went wrong with it
node $T spend                       # today's ledger total vs the cap

# DRY RUN by default: prints the plan and the estimate, sends nothing.
node $T generate --prompt "Place this exact backdrop in a bright party studio, no people" \
     --ref backdrop.png --face-free --aspect 4:5 --res 2K --n 2 --name pink-backdrop
node $T generate ... --yes          # actually spend

node $T upscale room.png --face-free --yes
node $T cutout patch.png --face-free --yes
node $T selftest                    # offline: guards and dispatch, spends nothing
```

## Spend guard (`lib/spend.mjs`)

- Dry run unless `--yes`.
- `--max-usd` per invocation (default **$1.00**): the whole plan's estimate must fit.
- `IMAGE_TOOLS_DAILY_USD_CAP` per UTC day (default **$5.00**), summed from `ledger.jsonl`, and
  re-checked before **every** call in a batch.
- An unreadable ledger stops the run ("could not read what I spent" is not "nothing").
- The ledger holds **estimates**; the API returns no price. Reconcile with the Replicate billing
  page. `models` shows how far each price is trusted (`billing`, `measured`, `estimate`).

## Which model (from PARR's tests and the RSE work)

| Job | Model | Why |
|---|---|---|
| Decor/room mockup from a supplied image | `nano-banana-pro` (default, $0.15) | Composites the supplied art instead of redrawing it; honours wide-shot framing; best text |
| Cheap drafts of the same | `nano-banana-2` ($0.10) | Same fidelity on PARR's test; follows the scene brief literally |
| Throwaway first drafts, flat graphics | `grok-imagine` ($0.02) | Repaints a supplied image and ignores framing; never for finals |
| Words that must be spelled right | `ideogram-v3` | Spelled "RSE" correctly |
| One piece turned into another (design -> embroidered patch) | `kontext-pro` | Give it the piece alone; on a whole product photo it re-renders the product and garbles text |
| Upscale | `recraft-upscale` (default) | Used on the RSE sweatshirts; Real-ESRGAN made chenille look metallic with halos |
| Background removal | `bg-remove` | RSE patch cut-outs |
| Avoid | `flux-2-pro` | ~10% cheaper than the pro once the reference is billed; restyled a painting |

Not ported: PARR's LoRA training, poster/gallery batch runners and the Parr-specific art
catalogue. Port a batch runner when a real Host Hampton batch exists; use `lib/` and `cli.mjs`
as the model for it (plan -> `checkBudget` -> call -> sidecar -> `record`).

## Provider abstraction

`lib/models.mjs` names each model's provider, slug, price and input mapping; `providers/*.mjs`
each export `run({slug, input})` and `download(url, path)`. `fal` is ported from PARR for
parity and has **never run in this repo** (no `FAL_KEY`); add one and do a dry run first.
Replicate has not been run from this tool either (no key here), so the first `--yes` should be
a single `--n 1` call.

## Related: local photos -> photo library

`photo-pipeline/pipeline.py` (prefilter, stronger face check, contact sheets, WebP export in Muse's
CSV format) and the audit behind it are in `docs/photo-library-local-pipeline.md`. Its face check
writes `face_flags.csv`, which this tool's safety guard reads.

## Getting an image onto the site

Generation does not publish anything. A result that should be used goes through the photo
library like any candidate: re-encode to WebP with metadata dropped, import as an **unapproved**
`media_assets` candidate, and a human approves it at `/admin/photo-library`. AI-made images must
be labelled as such in the row's notes and must never be offered as a real party photo.
