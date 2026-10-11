// Phone-width screenshots of the public invite page (P12). Usage: node shot-p12.mjs <engine> <url> <out.png>
import { chromium, webkit } from '@playwright/test'
const [engine, url, out] = process.argv.slice(2)
const b = await (engine === 'webkit' ? webkit : chromium).launch(process.env.WK ? { executablePath: process.env.WK } : {})
const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: engine !== 'webkit' ? true : true })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const info = await page.evaluate(() => {
  const c = document.querySelector('.hh-inv-canvas, .hh-hi-canvas')
  return c ? { transform: getComputedStyle(c).transform, w: c.getBoundingClientRect().width } : null
})
console.log(JSON.stringify(info))
await page.screenshot({ path: out, fullPage: true })
await b.close()
