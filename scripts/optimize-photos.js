#!/usr/bin/env node
/**
 * Host Hampton Photo Optimizer
 *
 * Process: analyze photo → generate prompt → send to Replicate flux-kontext-pro → save
 * Usage: node scripts/optimize-photos.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('./node_modules/sharp');

// ── Config ──
const REPLICATE_KEY = (() => {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const match = env.match(/^REPLICATE_API_KEY=(.+)$/m);
  return match ? match[1].trim() : '';
})();

const MODEL = 'black-forest-labs/flux-kontext-pro';
const INPUT_DIR = path.join(__dirname, '..', 'photos', 'converted');
const OUTPUT_DIR = path.join(__dirname, '..', 'photos', 'optimized');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const POLL_INTERVAL = 3000;  // 3s
const MAX_POLLS = 120;       // 6 min max per image
const CONCURRENCY = 1;       // 1 at a time — rate limit is 6/min with $<5 credit
const INTER_REQUEST_DELAY = 12000; // 12s between requests to stay under 6/min

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Photo Analysis + Prompt Generation ──
// Each photo gets a tailored enhancement prompt based on visual analysis.

const photoPrompts = {
  // ── Indoor Setup / Room Shots (empty — enhance ambiance) ──
  'IMG_0812': {
    category: 'setup-construction-party',
    prompt: 'Enhance this party room photo: brighten the lighting to warm golden tones, increase color vibrancy of the yellow and orange balloons, add subtle warm glow to the ceiling area, make the wood floor look polished and inviting. Professional event photography look with bright airy feel.',
  },
  'IMG_0869': {
    category: 'setup-painting-workshop',
    prompt: 'Enhance this painting workshop setup photo: warm up the cool fluorescent lighting to soft warm white, make the red tablecloth more vibrant and saturated, brighten the overall scene, add a subtle warm glow. Make it look like a professional event space photo for a boutique venue.',
  },
  'IMG_0872': {
    category: 'setup-party',
    prompt: 'Enhance this party setup photo: improve lighting to warm natural tones, boost color saturation, add subtle golden glow, make it feel bright and inviting. Professional event venue photography style.',
  },
  'IMG_2022': {
    category: 'setup-craft-activity',
    prompt: 'Enhance this craft activity station photo: sharpen the foreground sign, warm up the background lighting, add soft bokeh sparkle to the background. Make it look bright, warm, and inviting. Boutique event space photography style.',
  },
  'IMG_2029': {
    category: 'setup-party',
    prompt: 'Enhance this party setup photo: brighten overall, warm up the lighting from cool to golden, boost color vibrancy, add soft ambient glow. Make the space feel premium and inviting. Professional event photography.',
  },

  // ── K-Pop / Theme Backdrop ──
  'IMG_3627': {
    category: 'setup-kpop-theme',
    prompt: 'Enhance this K-Pop Demon Hunters themed party setup: boost the colors of the anime backdrop to be more vivid, warm up the treat cart area, add subtle sparkle effects to the cupcakes area, brighten the ceiling. Make it look vibrant and exciting. Professional event venue photography.',
  },

  // ── Glow Party Accessories (dark) ──
  'IMG_3007': {
    category: 'glow-accessories',
    prompt: 'Enhance this glow party accessories photo: brighten the overall exposure while keeping the purple/blue glow mood, make the star sunglasses and disco balls more visible and sparkly, add shimmer and light flare effects to the sequin fabric. Make it look magical and party-ready.',
  },

  // ── Barbie Box Photo Prop ──
  'IMG_4293': {
    category: 'setup-barbie-box',
    prompt: 'Enhance this Barbie photo booth box: boost the hot pink colors to be more vivid and saturated, add sparkle and shimmer to the tinsel curtain, brighten the pink LED lights, add a soft glamorous glow. Make it look like a premium Instagram-worthy photo prop.',
  },
  'IMG_4307': {
    category: 'setup-barbie',
    prompt: 'Enhance this Barbie party photo: boost pink tones, add warm glamorous lighting, increase vibrancy, add soft sparkle. Premium event photography style.',
  },

  // ── Spa Party Setup ──
  'IMG_8107': {
    category: 'setup-spa-party',
    prompt: 'Enhance this spa party setup: warm up the lighting to soft golden tones, make the pink decorations and table runner more vibrant, add a soft dreamy glow to the balloons, make the gold number 5 balloon shimmer. Bright airy boutique event photography style.',
  },
  'IMG_8109': {
    category: 'setup-spa-party',
    prompt: 'Enhance this spa party photo: warm golden lighting, boost pink and blush tones, add soft sparkle to any metallic elements, bright airy feel. Premium event venue photography.',
  },

  // ── Outdoor Party Setup ──
  'IMG_6185': {
    category: 'outdoor-party-setup',
    prompt: 'Enhance this outdoor party table setup: boost the pink and purple colors of the plates and decorations, make the sequin table runner shimmer and sparkle, warm up the natural sunlight, add vibrant color pop. Bright sunny outdoor event photography style.',
  },

  // ── Activity Shots (with people) ──
  'IMG_7140': {
    category: 'activity-bracelet-making',
    prompt: 'Enhance this bracelet-making activity photo: brighten the colors of the beads to be more vivid and rainbow-like, warm up the natural sunlight, add vibrancy to skin tones, sharpen the details of the bead containers. Keep it natural looking but more vibrant. Bright outdoor event photography.',
  },
  'IMG_2798': {
    category: 'activity-donut-decorating',
    prompt: 'Enhance this donut decorating activity photo: warm up the lighting, make the frosting colors more vibrant, brighten the scene, add warmth to skin tones. Natural-looking but elevated. Boutique kids party photography style.',
  },

  // ── Sensory / Toddler Play ──
  '41A2AF48-997D-429D-BEC2-C278FF475273': {
    category: 'setup-sensory-table',
    prompt: 'Enhance this sensory play table photo: warm up the cold white lighting, make the colorful toys more vibrant, add a soft warm ambient glow, brighten the sand area. Make it feel warm and inviting for a kids play space. Bright boutique event photography.',
  },
  'E987BC30-86D3-4EAB-9323-DF6E42F072E0': {
    category: 'setup-activity',
    prompt: 'Enhance this party activity setup: warm up lighting, boost color vibrancy, add soft golden glow, make the space feel bright and inviting. Premium event venue photography.',
  },

  // ── Product Flat Lays ──
  'IMG_5678': {
    category: 'product-custom-pouches',
    prompt: 'Enhance this custom pouch product photo: brighten the lighting, reduce harsh shadows, make the pastel colors (pink, lavender, mint, blue) more vibrant and saturated, add a subtle clean glow. Professional product photography for an e-commerce boutique.',
  },
  'IMG_5678(1)': {
    category: 'product-custom-pouches',
    prompt: 'Enhance this custom pouch product photo: brighten overall, reduce shadows, boost pastel colors, add clean product photography lighting. Professional boutique product shot.',
  },

  // ── Other Indoor Shots ──
  'IMG_0814': {
    category: 'setup-party',
    prompt: 'Enhance this party setup photo: warm golden lighting, boost color saturation, brighten overall, add ambient glow. Professional event venue photography.',
  },
  'IMG_3897': {
    category: 'setup-party',
    prompt: 'Enhance this party venue photo: warm up fluorescent lighting to golden tones, boost colors, add soft ambient glow, make space feel premium and inviting. Event photography style.',
  },
  'IMG_5027': {
    category: 'setup-party',
    prompt: 'Enhance this party photo: warm bright lighting, vibrant colors, soft sparkle, premium event venue photography style.',
  },
  'IMG_6503': {
    category: 'setup-party',
    prompt: 'Enhance this party setup: warm lighting, boost vibrancy, add golden ambient glow, professional event photography feel.',
  },
};

// Default prompt for any photos not in the map (social media graphics, etc.)
const DEFAULT_PROMPT = 'Enhance this image: boost color vibrancy and saturation by 20%, warm up the lighting to golden tones, add subtle sparkle and shimmer effects where appropriate, increase brightness slightly. Make it look premium and Instagram-ready. Professional boutique brand photography style.';

// ── Replicate API helpers ──

async function createPrediction(imageUrl, prompt) {
  const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        input_image: imageUrl,
        prompt,
        aspect_ratio: 'match_input_image',
        output_format: 'png',
        safety_tolerance: 2,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate create failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function pollPrediction(id) {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` },
    });
    const data = await res.json();
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Prediction ${id} ${data.status}: ${data.error || 'unknown'}`);
    }
    process.stdout.write('.');
  }
  throw new Error(`Prediction ${id} timed out after ${MAX_POLLS * POLL_INTERVAL / 1000}s`);
}

async function downloadImage(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Convert to high-quality JPEG for web use
  await sharp(buf)
    .jpeg({ quality: 92 })
    .toFile(outPath);
}

// Convert local file to base64 data URI (works cross-platform, no upload needed)
function toDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ── Main Pipeline ──

async function processPhoto(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const inputPath = path.join(INPUT_DIR, fileName);
  const outputPath = path.join(OUTPUT_DIR, baseName + '_optimized.jpg');

  // Skip if already processed
  if (fs.existsSync(outputPath)) {
    console.log(`  ⏭ ${baseName} — already processed, skipping`);
    return { file: baseName, status: 'skipped', outputPath };
  }

  const config = photoPrompts[baseName] || {};
  const prompt = config.prompt || DEFAULT_PROMPT;
  const category = config.category || 'uncategorized';

  console.log(`  📸 ${baseName} [${category}]`);
  console.log(`     Prompt: ${prompt.slice(0, 80)}...`);

  try {
    // 1. Convert to base64 data URI (no upload needed)
    process.stdout.write('     Encoding...');
    const imageDataUri = toDataUri(inputPath);
    console.log(` done (${(Buffer.byteLength(imageDataUri) / 1024 / 1024).toFixed(1)} MB)`);

    // 2. Create prediction
    process.stdout.write('     Processing');
    const prediction = await createPrediction(imageDataUri, prompt);

    // 3. Poll until complete
    const result = await pollPrediction(prediction.id);
    console.log(' done');

    // 4. Download and save
    const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
    if (!outputUrl) throw new Error('No output URL in prediction result');

    process.stdout.write('     Saving...');
    await downloadImage(outputUrl, outputPath);
    console.log(` saved → ${path.relative(path.join(__dirname, '..'), outputPath)}`);

    return {
      file: baseName,
      status: 'success',
      category,
      prompt,
      outputPath,
      predictionId: prediction.id,
      replicateUrl: outputUrl,
    };
  } catch (err) {
    console.error(`\n     ❌ FAILED: ${err.message}`);
    return { file: baseName, status: 'failed', error: err.message };
  }
}

async function main() {
  console.log('\n🎨 Host Hampton Photo Optimizer');
  console.log(`   Model: ${MODEL}`);
  console.log(`   Input: ${INPUT_DIR}`);
  console.log(`   Output: ${OUTPUT_DIR}\n`);

  if (!REPLICATE_KEY) {
    console.error('❌ REPLICATE_API_KEY not found in .env');
    process.exit(1);
  }

  // Get all JPG files (skip social media graphics)
  const allFiles = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.jpg'));

  // Separate real photos from social media graphics
  const photos = allFiles.filter(f => !f.startsWith('Neutral_') && !f.startsWith('Vintage_'));
  const graphics = allFiles.filter(f => f.startsWith('Neutral_') || f.startsWith('Vintage_'));

  console.log(`📋 Found ${photos.length} venue photos + ${graphics.length} social graphics (skipping graphics)\n`);

  const results = [];

  // Process in batches of CONCURRENCY
  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    console.log(`── Batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(photos.length / CONCURRENCY)} ──`);

    const batchResults = await Promise.all(batch.map(f => processPhoto(f)));
    results.push(...batchResults);

    // Delay between batches to respect rate limits
    if (i + CONCURRENCY < photos.length) {
      process.stdout.write(`     ⏳ Waiting ${INTER_REQUEST_DELAY / 1000}s for rate limit...`);
      await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY));
      console.log(' ready');
    }
    console.log('');
  }

  // Write manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    totalPhotos: photos.length,
    processed: results.filter(r => r.status === 'success').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  // Summary
  console.log('═══════════════════════════════════════');
  console.log(`✅ Processed: ${manifest.processed}`);
  console.log(`⏭ Skipped:   ${manifest.skipped}`);
  console.log(`❌ Failed:    ${manifest.failed}`);
  console.log(`📁 Output:    photos/optimized/`);
  console.log(`📋 Manifest:  photos/optimized/manifest.json`);
  console.log('═══════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
