# Synthesis — Terrain-First Atlas Rebuild

## Decision from parallel research

The next foundation is **OpenLayers + pixel projection + static 512px tile pyramid**.

This is the correct base because the project needs a Google-Earth-like atlas interaction model before stylized 3D terrain. The source map is a non-earth fantasy image, so the runtime should preserve `10000 × 5571` source-pixel coordinates directly instead of forcing fake lat/lon or using a Three.js toy board as the primary renderer.

## Architecture choice

### Base atlas engine

- **OpenLayers**
- Custom projection: `MALAZAN_SOURCE_PIXEL`
- Extent: `[0, 0, 10000, 5571]`
- Stored/source JSON coordinates: top-left origin `[x, y]`
- OpenLayers map coordinates: bottom-left y-up, converted at render edge:

```ts
sourceToMap([x, y]) => [x, 5571 - y]
mapToSource([x, y]) => [x, 5571 - y]
```

### Raster foundation

- Input: `public/assets/worldofmalazan-z6-mosaic.png`
- Source: `10000 × 5571`
- Tile size: `512`
- Pyramid: `z0..z5`
- Tile count: `304`
- Output: `public/tiles/source/{z}/{x}/{y}.webp`
- Manifest: `public/tiles/source/manifest.json`

### Existing data carried forward

- `public/data/locations.json` — 602 exact-coordinate locations
- `public/data/prototype-features.json` — draft rivers/basins/biomes
- Search/category filters
- Camera bookmarks/fly-to behavior

## What was implemented immediately

- Added `scripts/generate-map-tiles.mjs`.
- Generated 304 WebP source tiles from the full z6 map.
- Added `scripts/validate-atlas-assets.mjs`.
- Replaced the default R3F/cube-board runtime with an OpenLayers atlas runtime.
- Added exact source-coordinate search/fly-to.
- Rendered locations, draft rivers, and draft basin/biome overlays in source-pixel coordinates.
- Added visible foundation status and cartography queue panels.
- Disabled auto-deploy-on-push until the next public build is intentionally approved.

## Verification already run

```bash
npm run tiles:source
npm run assets:validate
npm run build
```

Results:

```text
validated source=10000x5571, tiles=304, locations=602
npm run build: passed
```

Browser QA:

- Full map loads as a real zoomable atlas foundation.
- No cube board.
- No fake landmark pile.
- Search for `Darujhistan` returns exact coordinate `[6782, 1527]`.
- Selecting result zooms/flys to Genabackis/Darujhistan area.
- Draft river vectors are visible in that region.

## Next implementation phases

### Phase 1A — harden atlas foundation

- Add coordinate unit tests.
- Add tile math tests.
- Add screenshot/Playwright smoke test.
- Add layer toggles for locations/rivers/basins/biomes.
- Add clean mode that hides panels but keeps map engine.
- Improve label decluttering.

### Phase 2 — cartographic extraction workspace

Build `scripts/cartography/`:

- `classify_masks.py`
- `vectorize_masks.py`
- `normalize_layers.py`
- `validate_layers.py`

Create data layout:

```text
public/data/source-crs.json
public/data/layers/
  land.geojson
  water.geojson
  coastlines.geojson
  rivers.geojson
  drainage-basins.geojson
  mountains.geojson
  forests.geojson
  biomes.geojson
```

### Phase 3 — real vector tracing

Start with a Genabackis vertical slice:

- coastline/land-water boundaries,
- visible rivers around Darujhistan/Pale/Lake Azur,
- mountain ridges,
- forest polygons,
- basin polygons.

All features need:

- `certainty`,
- `extraction`,
- `source_image`,
- source-pixel coordinates,
- validation status.

### Phase 4 — terrain synthesis

Generate terrain from vectors:

- land/water mask base elevation,
- coast distance-field gradients,
- mountain ridge falloff,
- river carving,
- lake/ocean water planes,
- forest/biome material masks.

### Phase 5 — stylized Google Earth layer

Only after vector geography is correct:

- Three.js/R3F terrain tiles synchronized with atlas view,
- stylized terrain shaders,
- rivers as terrain-following water strips,
- forests/mountains generated from actual polygons/ridges,
- atmosphere/clouds/DOF as optional polish.

## Guardrails

- Do not deploy decorative or toy terrain as default.
- Do not call source PNG overlay the product.
- Do not invent rivers/mountains/forests by vibes.
- Public builds must be intentional and visually QA'd.
