#!/usr/bin/env node
/**
 * Convert optimized photos → WebP, properly named, NO forced crop
 * Keeps the original 3:4 portrait aspect ratio from the source photos.
 * Outputs to services/website/public/images/gallery/
 */

const fs = require('fs');
const path = require('path');
const sharp = require('./node_modules/sharp');

const INPUT_DIR = path.join(__dirname, '..', 'photos', 'optimized');
const OUTPUT_DIR = path.join(__dirname, '..', 'services', 'website', 'public', 'images', 'gallery');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Photo → web-ready name mapping (width only — aspect preserved from source)
const photos = [
  // ── Theme slider images ──
  { src: 'IMG_3007_optimized.jpg',  name: 'glow-accessories.webp',    w: 900 },
  { src: 'IMG_4293_optimized.jpg',  name: 'barbie-photo-booth.webp',  w: 900 },
  { src: 'IMG_4307_optimized.jpg',  name: 'barbie-setup.webp',        w: 900 },
  { src: 'IMG_8107_optimized.jpg',  name: 'spa-party-1.webp',         w: 900 },
  { src: 'IMG_8109_optimized.jpg',  name: 'spa-party-2.webp',         w: 900 },
  { src: 'IMG_3627_optimized.jpg',  name: 'kpop-setup.webp',          w: 900 },
  { src: 'IMG_2798_optimized.jpg',  name: 'donut-decorating.webp',    w: 900 },
  { src: '41A2AF48-997D-429D-BEC2-C278FF475273_optimized.jpg', name: 'toddler-sensory.webp', w: 900 },

  // ── Custom Accessories page (product shots) ──
  { src: 'IMG_5678_optimized.jpg',     name: 'product-pouches-1.webp', w: 800 },
  { src: 'IMG_5678(1)_optimized.jpg',  name: 'product-pouches-2.webp', w: 800 },

  // ── Mobile Party / outdoor ──
  { src: 'IMG_6185_optimized.jpg',  name: 'outdoor-party-setup.webp', w: 900 },

  // ── Room Rental / venue shots ──
  { src: 'IMG_0812_optimized.jpg',  name: 'venue-construction-party.webp', w: 900 },
  { src: 'IMG_0869_optimized.jpg',  name: 'venue-painting-workshop.webp',  w: 900 },
  { src: 'IMG_2022_optimized.jpg',  name: 'venue-craft-station.webp',      w: 900 },
  { src: 'IMG_7140_optimized.jpg',  name: 'activity-bracelet-making.webp', w: 900 },
  { src: 'E987BC30-86D3-4EAB-9323-DF6E42F072E0_optimized.jpg', name: 'venue-activity-setup.webp', w: 900 },

  // ── Homepage / general venue ──
  { src: 'IMG_0814_optimized.jpg',  name: 'venue-party-setup-1.webp', w: 800 },
  { src: 'IMG_0872_optimized.jpg',  name: 'venue-party-setup-2.webp', w: 800 },
  { src: 'IMG_2029_optimized.jpg',  name: 'venue-party-setup-3.webp', w: 800 },
  { src: 'IMG_3897_optimized.jpg',  name: 'venue-party-setup-4.webp', w: 800 },
  { src: 'IMG_5027_optimized.jpg',  name: 'venue-party-setup-5.webp', w: 900 },
  { src: 'IMG_6503_optimized.jpg',  name: 'venue-party-setup-6.webp', w: 900 },
];

async function processPhoto({ src, name, w }) {
  const inputPath = path.join(INPUT_DIR, src);
  const outputPath = path.join(OUTPUT_DIR, name);

  if (!fs.existsSync(inputPath)) {
    console.log(`  ⚠ SKIP: ${src} not found`);
    return;
  }

  await sharp(inputPath)
    .resize(w)  // height auto-calculated — preserves native aspect
    .webp({ quality: 82 })
    .toFile(outputPath);

  const meta = await sharp(outputPath).metadata();
  const stat = fs.statSync(outputPath);
  console.log(`  ✅ ${name} — ${meta.width}x${meta.height}, ${(stat.size / 1024).toFixed(0)} KB`);
}

async function main() {
  console.log(`\n📸 Preparing ${photos.length} photos for web (native aspect)\n`);

  for (const photo of photos) {
    await processPhoto(photo);
  }

  console.log(`\n✅ All photos saved to: ${path.relative(path.join(__dirname, '..'), OUTPUT_DIR)}/\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
