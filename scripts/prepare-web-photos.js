#!/usr/bin/env node
/**
 * Convert optimized photos → WebP, downscaled, properly named
 * Outputs to services/website/public/images/gallery/
 */

const fs = require('fs');
const path = require('path');
const sharp = require('./node_modules/sharp');

const INPUT_DIR = path.join(__dirname, '..', 'photos', 'optimized');
const OUTPUT_DIR = path.join(__dirname, '..', 'services', 'website', 'public', 'images', 'gallery');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Photo → web-ready name mapping with sizing config
const photos = [
  // ── Theme slider images (crop to 16:9 for slider, max 1200px wide) ──
  { src: 'IMG_3007_optimized.jpg',  name: 'glow-accessories.webp',    w: 1200, ratio: 16/9 },
  { src: 'IMG_4293_optimized.jpg',  name: 'barbie-photo-booth.webp',  w: 1200, ratio: 16/9 },
  { src: 'IMG_4307_optimized.jpg',  name: 'barbie-setup.webp',        w: 1200, ratio: 16/9 },
  { src: 'IMG_8107_optimized.jpg',  name: 'spa-party-1.webp',         w: 1200, ratio: 16/9 },
  { src: 'IMG_8109_optimized.jpg',  name: 'spa-party-2.webp',         w: 1200, ratio: 16/9 },
  { src: 'IMG_3627_optimized.jpg',  name: 'kpop-setup.webp',          w: 1200, ratio: 16/9 },
  { src: 'IMG_2798_optimized.jpg',  name: 'donut-decorating.webp',    w: 1200, ratio: 16/9 },
  { src: '41A2AF48-997D-429D-BEC2-C278FF475273_optimized.jpg', name: 'toddler-sensory.webp', w: 1200, ratio: 16/9 },

  // ── Custom Accessories page (product shots, square crop) ──
  { src: 'IMG_5678_optimized.jpg',     name: 'product-pouches-1.webp', w: 800, ratio: 16/9 },
  { src: 'IMG_5678(1)_optimized.jpg',  name: 'product-pouches-2.webp', w: 800, ratio: 16/9 },

  // ── Mobile Party / outdoor ──
  { src: 'IMG_6185_optimized.jpg',  name: 'outdoor-party-setup.webp', w: 1200, ratio: 16/9 },

  // ── Room Rental / venue shots (16:9 for cards) ──
  { src: 'IMG_0812_optimized.jpg',  name: 'venue-construction-party.webp', w: 1200, ratio: 16/9 },
  { src: 'IMG_0869_optimized.jpg',  name: 'venue-painting-workshop.webp',  w: 1200, ratio: 16/9 },
  { src: 'IMG_2022_optimized.jpg',  name: 'venue-craft-station.webp',      w: 1200, ratio: 16/9 },
  { src: 'IMG_7140_optimized.jpg',  name: 'activity-bracelet-making.webp', w: 1200, ratio: 16/9 },
  { src: 'E987BC30-86D3-4EAB-9323-DF6E42F072E0_optimized.jpg', name: 'venue-activity-setup.webp', w: 1200, ratio: 16/9 },

  // ── Homepage / general venue (square for hero grid, 16:9 for cards) ──
  { src: 'IMG_0814_optimized.jpg',  name: 'venue-party-setup-1.webp', w: 800, ratio: 1 },
  { src: 'IMG_0872_optimized.jpg',  name: 'venue-party-setup-2.webp', w: 800, ratio: 1 },
  { src: 'IMG_2029_optimized.jpg',  name: 'venue-party-setup-3.webp', w: 800, ratio: 1 },
  { src: 'IMG_3897_optimized.jpg',  name: 'venue-party-setup-4.webp', w: 800, ratio: 1 },
  { src: 'IMG_5027_optimized.jpg',  name: 'venue-party-setup-5.webp', w: 1200, ratio: 16/9 },
  { src: 'IMG_6503_optimized.jpg',  name: 'venue-party-setup-6.webp', w: 1200, ratio: 16/9 },
];

async function processPhoto({ src, name, w, ratio }) {
  const inputPath = path.join(INPUT_DIR, src);
  const outputPath = path.join(OUTPUT_DIR, name);

  if (!fs.existsSync(inputPath)) {
    console.log(`  ⚠ SKIP: ${src} not found`);
    return;
  }

  const img = sharp(inputPath);
  const meta = await img.metadata();
  const srcW = meta.width;
  const srcH = meta.height;

  // Calculate crop dimensions to match target aspect ratio (center crop)
  const targetH = Math.round(srcW / ratio);
  let cropW = srcW;
  let cropH = targetH;

  if (targetH > srcH) {
    // Image is too short — crop width instead
    cropH = srcH;
    cropW = Math.round(srcH * ratio);
  }

  await img
    .extract({
      left: Math.round((srcW - cropW) / 2),
      top: Math.round((srcH - cropH) / 2),
      width: cropW,
      height: cropH,
    })
    .resize(w)
    .webp({ quality: 82 })
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  console.log(`  ✅ ${name} — ${w}px, ${(stat.size / 1024).toFixed(0)} KB`);
}

async function main() {
  console.log(`\n📸 Preparing ${photos.length} photos for web\n`);

  for (const photo of photos) {
    await processPhoto(photo);
  }

  console.log(`\n✅ All photos saved to: ${path.relative(path.join(__dirname, '..'), OUTPUT_DIR)}/\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
