// safety.mjs - the one hard rule, enforced where it can be.
//
//   This tool must NOT be used to alter, swap or synthesise the faces or hair of real children
//   in party photos. Safe uses: decor/setup mockups, backdrops, merch mockups, product shots,
//   upscaling and cleanup of FACE-FREE photos.
//
// What this module can and cannot do, honestly:
//   * It cannot look at a picture. It does not detect faces. It is a speed bump that makes the
//     operator say, out loud and in the ledger, that a reference image has no people in it.
//   * It refuses prompts that ask for the forbidden edit, and prompts that ask for photoreal
//     children at all. There is no override flag for either.
//   * It refuses any reference image that the photo pipeline's face check has flagged (or has not
//     checked, when a face-flag file exists), so the two tools reinforce each other.
// The alternative for a photo with a child in it is to crop, blur, silhouette, or get the
// parent's consent through the existing consent-release flow. Not to regenerate the child.

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { outRoot } from './env.mjs'

const CHILD = '(?:child|children|kid|kids|toddler|toddlers|baby|babies|girl|girls|boy|boys|birthday\\s+(?:girl|boy)|daughter|teen|teens|tween|tweens|minor|minors|infant)'
const ALTER = '(?:swap|swapped|replace|replaced|change|changed|alter|altered|edit|edited|restyle|restyled|fix|fixed|redo|retouch|retouched|beautify|smooth|de-?age|age|morph|re-?render|regenerate|recolou?r|dye|dyed|braid|braided|style|styled|cut)'
// "hair" alone is a person's hair; a hair salon / hair bar / hair bows party is decor and must pass.
const FACE = '(?:face|faces|facial|hair(?!\\s*(?:salon|bar|studio|bows?|clips?|ties|bands?|accessor\\w*|dryers?|stylists?))|hairstyle|hairdo|haircut|expression|smile|eyes|skin|head|likeness|features)'

const BLOCKED = [
  // the forbidden edit itself
  [/\bface[\s-]?swap/i, 'face swapping'],
  [/\b(?:swap|replace|change|alter|edit|restyle|redo|fix|retouch|beautify|morph)\b[^.]{0,40}\b(?:the|their|her|his|its)\s+(?:face|faces|hair(?!\s*(?:salon|bar|studio|bows?|clips?|ties|bands?))|hairstyle|hairdo|haircut|likeness)\b/i, 'altering a face or hair'],
  [new RegExp(`\\b${CHILD}\\b[^.]{0,60}\\b${FACE}\\b[^.]{0,40}\\b${ALTER}\\b`, 'i'), 'a child\'s face or hair'],
  [new RegExp(`\\b${ALTER}\\b[^.]{0,60}\\b${CHILD}\\b[^.]{0,60}\\b${FACE}\\b`, 'i'), 'a child\'s face or hair'],
  [new RegExp(`\\b${FACE}\\b[^.]{0,40}\\b${ALTER}\\b[^.]{0,40}\\b${CHILD}\\b`, 'i'), 'a child\'s face or hair'],
  [/\b(?:de-?age|age[\s-]?(?:up|down|progress))/i, 'changing a person\'s apparent age'],
  [/\b(?:remove|erase|blur out|cover)\b[^.]{0,30}\b(?:face|faces)\b[^.]{0,20}\b(?:and|then)\b[^.]{0,30}\b(?:generate|draw|paint|fill|synthesi[sz]e|invent)/i, 'regenerating faces'],
  // photoreal children as a subject, even "fictional" ones
  [new RegExp(`\\b(?:photo|photograph|portrait|picture|image|shot|snapshot)s?\\s+of\\s+(?:(?:an?|the|two|three|four|five|six|some|several|many|young|little|small|happy|cute|smiling|\\d+)\\s+)*${CHILD}\\b`, 'i'), 'a depiction of children'],
  [new RegExp(`\\b${CHILD}\\s+(?:are\\s+|is\\s+)?(?:smiling|laughing|posing|playing|dancing|holding|sitting|standing|looking|running|jumping|hugging)\\b`, 'i'), 'children as a subject'],
]

/** Throw if the prompt asks for something this tool will not do. */
export function screenPrompt(prompt) {
  for (const [re, what] of BLOCKED) {
    if (re.test(prompt)) {
      throw new Error(
        `refused: the prompt asks for ${what}. This tool never alters, swaps or synthesises real ` +
          'children\'s faces or hair, and does not depict children at all. For a party photo with a ' +
          'child in it: crop, blur, silhouette, or get the parent\'s consent via the consent-release flow.',
      )
    }
  }
}

/** The pipeline's face check writes this: one row per photo, `file,faces`. */
export function faceFlagsPath() {
  return join(outRoot(), 'face_flags.csv')
}

function loadFaceFlags() {
  const file = faceFlagsPath()
  if (!existsSync(file)) return null
  const flags = new Map()
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const head = lines.shift().split(',')
  const fi = head.indexOf('file')
  const ni = head.indexOf('faces')
  if (fi < 0 || ni < 0) throw new Error(`${file} needs "file" and "faces" columns`)
  for (const l of lines) {
    const cols = l.split(',')
    flags.set(basename(cols[fi].replace(/^"|"$/g, '')).toLowerCase(), Number(cols[ni]))
  }
  return flags
}

/**
 * Gate a reference image. `faceFree` is the operator's attestation (--face-free). If the face
 * check has run, its answer overrides the attestation: a flagged or unchecked file is refused.
 */
export function screenReference(path, { faceFree }) {
  if (!faceFree) {
    throw new Error(
      `refused: ${basename(path)} is a reference image and --face-free was not given. Pass it only ` +
        'for a picture with no people in it (decor, a room, a product, merch). Never for a party photo ' +
        'with a child in it.',
    )
  }
  const flags = loadFaceFlags()
  if (flags) {
    const n = flags.get(basename(path).toLowerCase())
    if (n === undefined) {
      throw new Error(
        `refused: ${basename(path)} is not in face_flags.csv. The face check has run on other photos ` +
          'but not this one, and an unchecked photo is not a face-free photo.',
      )
    }
    if (!(n === 0)) {
      throw new Error(`refused: the face check found ${Number.isNaN(n) ? 'an unreadable result for' : n + ' face(s) in'} ${basename(path)}.`)
    }
  }
}
