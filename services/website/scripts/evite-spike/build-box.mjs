// Builds scripts/evite-spike/box/: a self-contained folder to copy to the VPS and run in node:20-alpine with --network none.
//   node scripts/evite-spike/build-box.mjs        (run on the laptop, needs network for npm once)
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const box = path.join(here, 'box')
const pub = path.resolve(here, '../../public/evites')
fs.rmSync(path.join(box, 'public'), { recursive: true, force: true })
fs.mkdirSync(box, { recursive: true })
fs.copyFileSync(path.join(here, 'render.mjs'), path.join(box, 'render.mjs'))
fs.cpSync(pub, path.join(box, 'public/evites'), { recursive: true })
fs.writeFileSync(path.join(box, 'package.json'), JSON.stringify({ name: 'evite-spike-box', private: true, type: 'module' }, null, 2))
// pin to the versions the app resolves
const app = JSON.parse(fs.readFileSync(path.resolve(here, '../../package-lock.json'), 'utf8')).packages
const v = (n) => app[`node_modules/${n}`].version
const deps = [`sharp@${v('sharp')}`, `satori@${v('satori')}`, `opentype.js@${v('opentype.js')}`, '@resvg/resvg-js@2']
execSync(`npm install --no-audit --no-fund --os=linux --libc=musl --cpu=x64 ${deps.join(' ')}`, { cwd: box, stdio: 'inherit' })
console.log('box ready:', box)
