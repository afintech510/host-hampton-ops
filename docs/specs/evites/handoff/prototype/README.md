# Render prototype

Reference implementation used to produce `../mocks/`. Not production code: it shows the exact layering, fonts and glow treatment the real renderer (Satori/`next/og` or headless Chromium) must reproduce.

```bash
npm install
npx playwright install chromium   # if no Chromium is available
npm run render                    # writes out/invite.png and out/og.jpg
```

Edit the `d` object at the top of `render.js` to change name, age, date, place, host and phone.
Fonts are self-hosted from `@fontsource` packages (no Google Fonts network calls).
