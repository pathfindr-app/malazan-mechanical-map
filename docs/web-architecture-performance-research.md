# Web Architecture / Deployment / Performance Research — Malazan Atlas

## Goal

Build a smooth, Google-Earth-like but stylized atlas from a canonical `10000 × 5571` source map, 602 exact-coordinate locations, traced vector geography, and future 3D terrain. The app must run from static hosting such as GitHub Pages / Molotan and preserve source-pixel coordinates.

## Current repo snapshot

- Stack: Vite + React + TypeScript + Three.js/R3F.
- Current canonical asset: `public/assets/worldofmalazan-z6-mosaic.png`, `10000 × 5571`, ~6.7 MB.
- Existing preview asset: `public/assets/worldofmalazan-z3-mosaic.png`, `1250 × 697`, ~316 KB.
- Data: `public/data/locations.json` has 602 locations, `prototype-features.json` has draft vectors, `terrain-heightmap.json` is ~600 KB.
- Current runtime loads the full 10k PNG as a single Three.js texture. That is acceptable for a prototype, but it is not the right long-term foundation for smooth deep zoom, mobile, or low-memory devices.

## Recommendation summary

Use a **2D tiled atlas foundation** now, with source-pixel coordinates as the app's canonical coordinate system, and add **Three.js terrain as an optional synchronized layer** later.

Recommended path:

1. **Immediate foundation:** OpenLayers + Zoomify/XYZ tile pyramid in pixel projection.
2. **Alternative if staying fully custom WebGL:** deck.gl `TileLayer` + `BitmapLayer` in `OrthographicView`/cartesian coordinates.
3. **Avoid MapLibre as the primary foundation** for this fantasy/pixel atlas unless you intentionally warp the image into fake lon/lat/WebMercator or accept extra projection plumbing.
4. **Use PMTiles later** if file-count management or CDN byte-range delivery becomes more important than plain GitHub Pages simplicity.
5. **Use Three.js/R3F for the stylized terrain layer**, not for the initial raster map tile engine.

## Library evaluation

### OpenLayers — best first foundation

Why it fits:

- Official examples support static image maps with a custom pixel projection where image coordinates directly become map coordinates.
- Official Zoomify example supports deep zoom into high-resolution images using a pixel projection.
- Good pan/zoom inertia, constraints, hit testing, overlays, vector layers, and controls out of the box.
- Works well on static hosting because tiles are just files under `public/tiles/...`.

Use it for:

- Base raster tile pyramid.
- Exact source-coordinate pins and labels.
- Vector authoring overlays for rivers/coasts/mountains/forests/biomes.
- Search selection -> `view.animate({ center, zoom })` fly-to behavior.
- Coordinate readout and tracing desk.

Caveat:

- It is not a 3D renderer. Keep 3D as a sibling layer/route later.

### deck.gl — best if a custom WebGL/data-viz runtime is required

Why it fits:

- `TileLayer` loads only visible tiles and supports non-geospatial views (`OrthographicView`/`OrbitView`), where tile coordinates increment in cartesian space.
- `BitmapLayer`, `GeoJsonLayer`, `ScatterplotLayer`, `TextLayer`, and path/polygon layers are efficient for large overlays.
- Can be composed with React and eventually integrated with luma.gl/WebGPU-oriented paths.

Use it if:

- The team wants one WebGL layer stack for raster tiles, vectors, animated overlays, and custom picking.
- Future heavy vector layer rendering is more important than GIS/editor conveniences.

Caveat:

- More custom work than OpenLayers for map UI, authoring affordances, and pixel-coordinate constraints.
- Three.js/R3F integration can become a two-canvas synchronization problem.

### MapLibre — strong geospatial map renderer, weaker fit for source-pixel fantasy atlas

Why it is not the primary recommendation:

- MapLibre is optimized around style-spec map rendering, WGS84/WebMercator, raster/vector tiles, and geospatial camera semantics.
- Non-Earth flat/pixel maps are possible only with workarounds: fake lon/lat extents, custom tile schemas, or image-to-mercator transforms.
- Exact source-pixel overlays can remain exact internally, but every runtime interaction requires pixel <-> fake-world conversion.

Use MapLibre later if:

- You generate proper vector tiles and want style-spec cartography.
- You want PMTiles vector tile archives and accept a fake CRS mapping.

### Plain Three.js/R3F tiles — good for 3D terrain, not ideal for 2D atlas UX

Why not as the foundation:

- You would need to build your own tile scheduler, cache, visible-tile selection, zoom constraints, pointer/picking logic, label collision, and vector authoring.
- Browser max texture size/memory becomes a constant concern if loading large textures directly.

Use it for:

- Stage 3/4 terrain mesh tiles.
- Stylized mountain/ridge/forest/city 3D generated from source vectors.
- Optional presentation mode once the source-faithful atlas is already solid.

### PMTiles / COG-like image pyramids

- **Plain tile folder** (`/tiles/source/{z}/{x}/{y}.webp`) is simplest for GitHub Pages and easiest to debug.
- **PMTiles** is valuable when a single archive is preferable. MapLibre has a PMTiles protocol; PMTiles supports raster/vector archives and range requests. Verify static host supports HTTP Range requests and correct cache headers.
- **COG** is excellent for GIS/remote sensing rasters and range-request streaming, but it is heavier than needed for a single fantasy art map unless the pipeline also targets QGIS/GeoTIFF workflows. Browser COG support exists, but it adds complexity compared with generated web tiles.

## Tile pyramid design

Canonical source coordinates: `x in [0,10000]`, `y in [0,5571]`, origin at top-left.

Recommended raster tiles:

- Format: WebP for lossy painterly source, PNG only if text/detail loss is unacceptable.
- Tile size: start with **512 px** to reduce HTTP request count; use 256 only if OpenLayers Zoomify defaults or mobile decode behavior require it.
- Overlap: none for standard XYZ; optional 1-2 px gutter if seams appear.
- Max zoom: full native resolution.
- Min zoom: generated overview fitting whole world.

Tile count estimates:

| Tile size | Max z | Full-res grid | Total tiles |
| --- | ---: | ---: | ---: |
| 256 | 6 | 40 × 22 = 880 | 1184 |
| 512 | 5 | 20 × 11 = 220 | 304 |

Use 512 unless labels on the source image visibly blur during deep zoom. 304 files is friendly to GitHub Pages. If using PNG, total size may still be much larger than the 6.7 MB original; WebP/JPEG tiles usually win.

## Runtime architecture

```text
src/
  app/
    AtlasApp.tsx
    atlasStore.ts              # selected feature, layer visibility, camera state
  atlas/
    constants.ts               # SOURCE_WIDTH=10000, SOURCE_HEIGHT=5571
    coordinates.ts             # sourcePx <-> map coordinate helpers
    tileManifest.ts            # generated tiles metadata
  map/
    OpenLayersAtlas.tsx        # primary tiled 2D atlas viewport
    layers/
      SourceRasterLayer.ts
      LocationLayer.ts
      VectorTraceLayer.ts
      AuthoringLayer.ts
      LabelLayer.ts
    interactions/
      flyToSourcePoint.ts
      selectAtPixel.ts
      pointerCoordinateReadout.ts
  data/
    loaders.ts                 # fetch JSON via import.meta.env.BASE_URL
    schemas.ts                 # zod or TS schemas for locations/features
    spatialIndex.ts            # rbush/quadtree index for pins/vectors
  workers/
    vectorIndex.worker.ts      # bbox/quadtree building, simplification
    terrainBake.worker.ts      # future local terrain previews
  search/
    searchIndex.ts             # normalized location/category/name matching
  terrain/
    TerrainScene.tsx           # optional synchronized R3F terrain view
    terrainTiles.ts            # future mesh/height tile loader
    materials.ts
  tests/
    coordinate.test.ts
    tileMath.test.ts
    search.test.ts
scripts/
  generate-map-tiles.mjs
  generate-vector-tiles.mjs
  build-spatial-index.mjs
  validate-atlas-assets.mjs
public/
  tiles/source/{z}/{x}/{y}.webp
  tiles/source/manifest.json
  data/locations.json
  data/features/*.json
  data/index/*.json
```

## Coordinate model

Keep source pixels as the only authoritative data format:

```ts
export const SOURCE_WIDTH = 10000;
export const SOURCE_HEIGHT = 5571;
export type SourcePoint = [number, number];

// OpenLayers pixel projection normally uses bottom-left y-up extents.
// Keep conversion helpers explicit so JSON stays source top-left y-down.
export function sourceToMap([x, y]: SourcePoint): [number, number] {
  return [x, SOURCE_HEIGHT - y];
}

export function mapToSource([x, y]: [number, number]): SourcePoint {
  return [x, SOURCE_HEIGHT - y];
}
```

All pins, vectors, search results, terrain controls, and authoring exports should remain in source pixel space. Renderers may convert at the edge.

## Tile generation script plan

Add `scripts/generate-map-tiles.mjs`:

- Input: `public/assets/worldofmalazan-z6-mosaic.png` or `../site-captures/worldofmalazan/worldofmalazan-z6-mosaic.png`.
- Output: `public/tiles/source/{z}/{x}/{y}.webp` plus `manifest.json`.
- Use `sharp` for deterministic resize/crop/output.
- Generate zoom levels from overview to native:
  - for 512 px tiles: z0 `313×175`, z1 `625×349`, z2 `1250×697`, z3 `2500×1393`, z4 `5000×2786`, z5 `10000×5571`.
- Pad edge tiles with transparency or crop exact dimensions; include actual tile bounds in manifest if cropped.
- Recommended WebP quality: 82-90. Use lossless WebP or PNG for text-critical comparison builds.

Example package additions:

```json
{
  "scripts": {
    "tiles:source": "node scripts/generate-map-tiles.mjs",
    "assets:validate": "node scripts/validate-atlas-assets.mjs",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "sharp": "latest",
    "vitest": "latest",
    "@playwright/test": "latest"
  },
  "dependencies": {
    "ol": "latest",
    "rbush": "latest",
    "zod": "latest"
  }
}
```

## Overlay/vector performance plan

### 602 locations

602 points are tiny. Render all as vector/icon features, but label only selected/high-importance/current-viewport points. Search can scan all 602 in memory.

### Traced lines/polygons

- Store source JSON as source-pixel GeoJSON-like data, not lon/lat.
- Build bbox metadata at generation time.
- Build runtime `RBush`/quadtree in a Web Worker if features become large.
- Simplify per zoom level with Douglas-Peucker / simplify-js or `mapshaper` during preprocessing.
- For very large line/polygon sets, generate vector tiles by z/x/y so the browser only loads visible features.

### Label collision

Start simple: show selected + important labels only. Later add per-zoom label ranking and screen-space collision filtering in a worker or render loop.

## Future 3D terrain architecture

Do not start with Cesium/quantized-mesh unless the project wants a globe/planet engine. The source map is rectangular and custom, so a simpler custom terrain quadtree is better.

Recommended staged approach:

1. Generate tiled heightmaps aligned to raster tiles: `public/tiles/height/{z}/{x}/{y}.png` or binary `.r16`/`.bin`.
2. Generate mesh tiles with skirts at edges to hide cracks.
3. Drive heights from traced geography:
   - water masks flat/low,
   - coasts blend gradients,
   - mountain ridges add falloff,
   - rivers carve valleys/channels,
   - forests/biomes drive material/instance masks.
4. Stream only visible terrain tiles around the camera.
5. Keep 2D map and 3D terrain synchronized through the same source coordinate camera state.

Cesium quantized-mesh is a useful reference: it is a multi-resolution quadtree pyramid of meshes, but it assumes geospatial tiling/earth coordinate conventions. Reuse the concept, not necessarily the format.

## Deployment constraints

### GitHub Pages

- Vite must build with repo base path. Current `vite.config.ts` uses `/malazan-mechanical-map/` when `GITHUB_PAGES=true`; confirm this matches the actual repo URL.
- All assets must be addressed with `import.meta.env.BASE_URL`.
- Keep individual assets reasonably small; tile folders are fine, but thousands of files can slow deploys. 512 tiles keep file count low.
- Verify live URLs for:
  - `index.html`,
  - tile manifest,
  - a min-zoom tile,
  - a max-zoom edge tile,
  - `locations.json`.

### Molotan/static CDN

- Prefer immutable hashed assets or versioned tile paths: `/tiles/source/v1/{z}/{x}/{y}.webp`.
- Set long cache headers for tiles and data generated from versioned directories.
- Ensure Range requests if using PMTiles/COG. Plain XYZ tiles do not require Range support.

## Testing and verification plan

### Unit tests

- `sourceToMap` / `mapToSource` round-trips.
- Tile bounds for edge tiles and max zoom.
- Search normalization and category filters.
- Vector bbox/quadtree hit tests.

### Asset validation script

`node scripts/validate-atlas-assets.mjs` should check:

- manifest dimensions = `10000 × 5571`,
- expected z levels and tile counts,
- all referenced tile files exist,
- selected tiles can be decoded,
- `locations.json.locationsCount === 602`,
- all location centers are within bounds.

### Browser smoke tests

Use Playwright:

1. Load local preview under the same base path used for deployment.
2. Wait for tile manifest and first visible tiles.
3. Assert first viewport shows the atlas canvas and coordinate readout.
4. Search for a known city, select it, assert camera center is near its source coordinate.
5. Zoom to max, assert visible high-z tile requests occurred.
6. Pan to all four corners, assert no blank permanent gaps.
7. Mobile viewport: assert tile count and frame responsiveness remain reasonable.

### Performance budgets

Initial budgets:

- Initial JS bundle: keep under ~1 MB gzip if possible.
- Initial data: locations + manifest under ~250 KB combined.
- Initial raster: only visible overview tiles, not the 6.7 MB full source image.
- Frame budget: pan/zoom should stay near 60 fps desktop and acceptable on mobile.
- Memory: avoid a persistent full 10k texture; cap retained tile cache.

## Concrete implementation sequence

1. Add tile generation script and generate 512 WebP tile pyramid.
2. Add `public/tiles/source/manifest.json`.
3. Add coordinate utilities and tests.
4. Replace default R3F full-texture map with `OpenLayersAtlas` using pixel projection + tile source.
5. Reuse existing location/search data as OpenLayers vector overlays.
6. Port tracing desk overlays to source-pixel OpenLayers features.
7. Add asset validator and Playwright smoke tests.
8. Build with `GITHUB_PAGES=true npm run build`.
9. Run local preview and browser smoke/visual QA.
10. Deploy to GitHub Pages/Molotan, then verify live asset URLs and app behavior.

## Final recommendation

Adopt **OpenLayers pixel-projection tiled atlas + source-pixel data model** as the next architecture milestone. It best matches the immediate needs: deep zoom, smooth pan/fly, exact coordinates, static hosting, and authoring overlays. Keep deck.gl as the alternative for a more custom WebGL-heavy layer stack. Keep MapLibre/PMTiles as a later packaging/vector-tile option, not the first renderer. Keep Three.js/R3F for future stylized terrain tiles once the tiled atlas and traced geography are correct.
