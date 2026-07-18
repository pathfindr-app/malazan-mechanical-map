# Malazan Atlas — Terrain-First Rebuild

This is the rebuild foundation for a **stylized Google Earth for Malazan**.

The rejected prototype paths were:

- cube-board / toy rectangle terrain,
- source PNG as a finished product.

The current direction is a source-faithful, zoomable map engine foundation that will drive real cartography and terrain generation.

## Current foundation

- Runtime: OpenLayers + React/Vite/TypeScript.
- Projection: custom source-pixel CRS.
- Canonical source extent: `10000 × 5571` pixels.
- Source raster: `public/assets/worldofmalazan-z6-mosaic.png`.
- Tile pyramid: `public/tiles/source/{z}/{x}/{y}.webp`.
- Tile size: `512`.
- Zoom levels: `z0..z5`.
- Tile count: `304`.
- Locations: 602 exact-coordinate POIs from `public/data/locations.json`.
- Draft geography: provisional rivers/basins/biomes from `public/data/prototype-features.json`.
- Styled relief raster: `public/tiles/relief/{z}/{x}/{y}.webp`, generated from the 10k map as a terrain-atlas presentation layer.
- Layer/style modes: Relief atlas, Source map, Blend; Locations, Draft rivers, Draft areas.

## What works now

- Smooth zoom/pan map foundation.
- Exact source-pixel coordinate transform.
- Search across 602 locations.
- Category filters.
- Fly-to bookmarks:
  - whole world,
  - Darujhistan,
  - Pale,
  - Genabackis river slice.
- Exact-coordinate selection cards.
- Draft river/basin/biome overlays.
- Asset validation so we do not accidentally regress to the low-res z3 preview.

## Commands

Install:

```bash
npm install
```

Generate source map tiles:

```bash
npm run tiles:source
```

Validate source assets:

```bash
npm run assets:validate
```

Run locally:

```bash
npm run dev -- --port 5177
```

Build:

```bash
npm run build
```

## Verification performed

```text
npm run tiles:source
npm run assets:validate
npm run build
```

Latest asset validation:

```text
validated source=10000x5571, sourceTiles=304, reliefTiles=304, locations=602
```

Browser QA verified:

- map loads as a tiled atlas foundation,
- no cube grid,
- no arbitrary stylized assets by default,
- search for `Darujhistan` returns `[6782, 1527]`,
- selecting Darujhistan zooms/flys to the correct Genabackis source-map region.

## Public deployment policy

GitHub Pages auto-deploy-on-push is disabled during this rebuild. Deploys are manual only until the build is visually and product-direction approved.

## Research / plans

- `.hermes/plans/terrain-first-rebuild.md`
- `.hermes/plans/subagent-synthesis-and-phase1.md`
- `docs/cartography-gis-pipeline-plan.md`
- `docs/terrain-rendering-research.md`
- `docs/web-architecture-performance-research.md`
- `docs/terrain-first-rebuild-plan.md`

## Next real work

1. Add coordinate/tile/search unit tests.
2. Add layer toggles and clean map mode.
3. Build `public/data/source-crs.json` and `public/data/layers/` schema.
4. Start cartographic extraction scripts:
   - land/water masks,
   - coastlines,
   - rivers,
   - mountain ridges,
   - forest and biome polygons.
5. Build terrain synthesis from those layers:
   - coast gradients,
   - mountain ridge elevation,
   - river carving,
   - water planes,
   - biome material masks.
6. Add stylized Three.js terrain only after geography is correct.
