# The Atlas — Interactive Malazan World Map Prototype

Static React/Vite prototype for Kyle's scale Malazan world atlas.

## Current correction

The public default view is now **Source Map Fidelity Mode**. The app opens on the original World of Malazan source map image with exact-coordinate overlays, rather than the experimental cube/miniature board.

This is intentional: source-map accuracy is the ground truth. Stylized 3D landmarks are disabled by default until they can be traced and placed exactly from the map.

## What it currently does

- Shows the original source map directly in the default view.
- Preserves the source coordinate system: `10000 × 5571 px`.
- Loads all 602 extracted map locations from `public/data/locations.json`.
- Shows exact-coordinate pins, search, and category filters.
- Shows provisional vector overlays for rivers/basins/biomes.
- Includes a tracing desk for exact-pixel river and boundary authoring:
  - active river selector,
  - active basin/biome boundary selector,
  - append points,
  - drag handles,
  - delete selected points,
  - live cursor source-coordinate readout,
  - crosshair preview,
  - localStorage draft autosave,
  - JSON download/export.
- Includes an experimental stylized 3D mode behind the `Stylized landmarks` layer toggle, but this is not the approved visual direction yet.

## Run

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5177
```

Open:

```text
http://localhost:5177/
```

Build:

```bash
npm run build
```

## Source assets

- Source atlas image: `public/assets/worldofmalazan-z3-mosaic.png`
- Extracted locations: `public/data/locations.json`
- Prototype traces: `public/data/prototype-features.json`
- Browser-exported draft traces: `prototype-features.draft.json`

## Next required work

The next real step is not decorative cubes. It is tracing/deriving actual geography from the source map:

1. trace real coast/land masks,
2. trace real rivers from the map,
3. trace actual mountain ranges and forests,
4. classify biomes from the source image,
5. only then generate stylized mountains/rivers/trees from those exact traced layers.
