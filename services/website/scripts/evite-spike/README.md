# EVITE P01 render spike (throwaway; folded into P04)

Satori -> SVG -> sharp(librsvg) -> JPEG, zero network at render time.

Local (Windows/mac/linux), from `services/website`:

    node scripts/evite-spike/optimize-assets.mjs   # one-off, already run: writes public/evites/glow/*
    node scripts/evite-spike/render.mjs            # writes scripts/evite-spike/out/*.jpg
    RENDER_ENGINE=resvg node scripts/evite-spike/render.mjs   # comparison only, needs @resvg/resvg-js
    EXPERIMENT_FILTER=1 node ...                   # also writes out/exp_shadow.jpg (GLOW via textShadow layers)
    node scripts/evite-spike/compare.mjs <mock> <mine> <out.jpg>   # mock | mine | 3x abs diff

On the box (orchestrator): `box/` is a self-contained folder (render.mjs + public/evites + linux-musl node_modules).
Rebuild it on the laptop with `node scripts/evite-spike/build-box.mjs`, then:

    ssh hampton-vps 'rm -rf /tmp/evite-spike'
    scp -r services/website/scripts/evite-spike/box hampton-vps:/tmp/evite-spike
    ssh hampton-vps 'docker run --rm --network none -m 512m -v /tmp/evite-spike:/w node:20-alpine node /w/render.mjs'
    scp -r hampton-vps:/tmp/evite-spike/out ./box-out      # images rendered on the box

Add `-e RENDER_ENGINE=resvg` to compare the resvg rasteriser. Exit code is 1 if any network call was attempted.
