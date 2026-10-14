/**
 * Every photo `/rse-merch` points at exists in `public/images`.
 *
 * Most of them are not written out: `shotsFor('tote', ['blue', 'yellow'])`
 * builds `rse-tote-blue-rooster.webp` and friends from the product, its colours
 * and the four patch designs. A colour added to a product without its renders
 * would show a broken image on a live storefront, so this rebuilds the names
 * the same way and checks the disk.
 */
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..', '..')
const page = fs.readFileSync(path.join(root, 'src/app/rse-merch/page.tsx'), 'utf8')
const images = path.join(root, 'public/images')

describe('/rse-merch images', () => {
  const patchKeys = [...page.matchAll(/\{ key: '(\w+)', label: '\w+', art: '\/images\/rse-patch-/g)].map((m) => m[1])
  const calls = [...page.matchAll(/shotsFor\('(\w+)', \[([^\]]*)\]\)/g)]

  it('finds the patch designs and the generated product shots it is checking', () => {
    expect(patchKeys).toEqual(['rooster', 'varsity', 'reggie', 'heart'])
    expect(calls.length).toBeGreaterThanOrEqual(5)
  })

  it('has a render for every product × colour × patch', () => {
    const missing: string[] = []
    let checked = 0
    for (const [, product, list] of calls) {
      const colors = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1])
      for (const c of colors) for (const p of patchKeys) {
        checked++
        const f = `rse-${product}-${c}-${p}.webp`
        if (!fs.existsSync(path.join(images, f))) missing.push(f)
      }
    }
    expect(checked).toBeGreaterThanOrEqual(36)
    expect(missing).toEqual([])
  })

  it('has every image it names literally', () => {
    const literal = [...new Set([...page.matchAll(/\/images\/(rse-[a-z0-9-]+\.webp)/g)].map((m) => m[1]))]
    expect(literal.length).toBeGreaterThanOrEqual(10)
    expect(literal.filter((f) => !fs.existsSync(path.join(images, f)))).toEqual([])
  })
})
