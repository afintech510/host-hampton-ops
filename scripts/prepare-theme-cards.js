#!/usr/bin/env node
/**
 * Convert social media graphics → WebP theme card images
 * Also generates missing Spa Party + Sleep Under Party cards
 * using sharp SVG text overlay on venue photos.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('./node_modules/sharp');

const CONVERTED_DIR = path.join(__dirname, '..', 'photos', 'converted');
const OPTIMIZED_DIR = path.join(__dirname, '..', 'photos', 'optimized');
const OUTPUT_DIR = path.join(__dirname, '..', 'services', 'website', 'public', 'images');

// ── Existing graphics → theme card mapping ──
const graphics = [
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_2.jpg',  name: 'theme-barbie.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_3.jpg',  name: 'theme-glow.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_6.jpg',  name: 'theme-kpop.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_7.jpg',  name: 'theme-swiftie.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_8.jpg',  name: 'theme-toddler.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_9.jpg',  name: 'theme-slime.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_10.jpg', name: 'theme-sweets.webp' },
  // Non-theme graphics → gallery
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_4.jpg',  name: 'gallery/card-painting-party.webp' },
  { src: 'Neutral_Minimalist_Social_Media_Tips_Carousel_Instagram_Post_-_5.jpg',  name: 'gallery/card-trucker-hat-bar.webp' },
  { src: 'Vintage_Scrapbook_Birthday_Photo_Collage_Instagram_Story__Instagram_Post__45___png.jpg', name: 'gallery/card-barbie-collage.webp' },
];

// ── Missing theme cards to generate ──
const generated = [
  { photo: 'IMG_8107_optimized.jpg', name: 'theme-spa.webp',        text: ['SPA', 'PARTY'] },
  { photo: 'IMG_8109_optimized.jpg', name: 'theme-sleepunder.webp', text: ['SLEEP', 'UNDER', 'PARTY'] },
];

function makeTextOverlaySvg(width, height, lines) {
  const fontSize = Math.round(width * 0.13);
  const lineHeight = fontSize * 1.15;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (height + totalTextHeight) / 2 - lineHeight * 0.2;

  const textElements = lines.map((line, i) => {
    const y = startY - (lines.length - 1 - i) * lineHeight;
    return `<text x="${width / 2}" y="${y}"
      font-family="'Libre Baskerville', 'Playfair Display', Georgia, serif"
      font-size="${fontSize}" font-weight="700" fill="white"
      text-anchor="middle" letter-spacing="2"
      stroke="rgba(0,0,0,0.3)" stroke-width="2" paint-order="stroke">${line}</text>`;
  }).join('\n    ');

  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${textElements}
  </svg>`);
}

async function convertGraphic({ src, name }) {
  const inputPath = path.join(CONVERTED_DIR, src);
  const outputPath = path.join(OUTPUT_DIR, name);

  if (!fs.existsSync(inputPath)) {
    console.log(`  ⚠ SKIP: ${src} not found`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await sharp(inputPath)
    .resize(900)
    .webp({ quality: 85 })
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  const meta = await sharp(outputPath).metadata();
  console.log(`  ✅ ${name} — ${meta.width}x${meta.height}, ${(stat.size / 1024).toFixed(0)} KB`);
}

async function generateCard({ photo, name, text }) {
  const inputPath = path.join(OPTIMIZED_DIR, photo);
  const outputPath = path.join(OUTPUT_DIR, name);

  if (!fs.existsSync(inputPath)) {
    console.log(`  ⚠ SKIP: ${photo} not found`);
    return;
  }

  // Resize photo to target, then overlay text
  const resized = await sharp(inputPath).resize(900).toBuffer();
  const meta = await sharp(resized).metadata();

  const svg = makeTextOverlaySvg(meta.width, meta.height, text);

  await sharp(resized)
    .composite([{ input: svg, top: 0, left: 0 }])
    .webp({ quality: 85 })
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  console.log(`  ✅ ${name} — ${meta.width}x${meta.height}, ${(stat.size / 1024).toFixed(0)} KB (generated)`);
}

async function main() {
  console.log('\n📸 Converting social media graphics to theme cards\n');

  for (const g of graphics) {
    await convertGraphic(g);
  }

  console.log('\n🎨 Generating missing theme cards\n');

  for (const g of generated) {
    await generateCard(g);
  }

  console.log('\n✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
