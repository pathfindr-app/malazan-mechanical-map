# Terrain Generation/Rendering Research — Malazan Stylized Google Earth

## Scope and product target

The browser atlas should become a **stylized Google Earth-like fantasy atlas**: continuous explorable terrain, source-faithful geography, visible rivers/coasts/mountain ranges/forests, and later painterly charm. The source authority is:

- `/root/kyle/projects/malazan-mechanical-map/site-captures/worldofmalazan/worldofmalazan-z6-mosaic.png`
- Verified dimensions: `10000 × 5571`, RGB.
- Runtime copy currently exists at `atlas-web/public/assets/worldofmalazan-z6-mosaic.png` (~6.7 MB).

The current app already uses React/Vite/Three.js/R3F and contains useful pieces: exact source-pixel coordinate transform, 602 locations, a high-res z6 map asset, provisional traced rivers/basins/biomes, and a simple raised mesh from `public/data/terrain-heightmap.json`. The rejected direction was the cube-board/PNG-overlay feel. The rebuild should treat the source map as diagnostic alignment and extract/synthesize terrain from vector/raster layers.

## Recommended architecture

### 1. Coordinate and data model

Keep **source pixel coordinates** as the single canonical CRS, not lat/lon:

```ts
type Px = [number, number]; // x,y in 10000x5571 source image

type TerrainLayerManifest = {
  sourcePixels: [10000, 5571];
  tileSizePx: 256 | 512;
  maxZoom: number;
  heightScaleMeters?: number; // fantasy/relative, not real-world
  layers: Record<string, { version: string; confidence: string; url: string }>;
};

type RiverFeature = {
  id: string;
  name?: string;
  rank: 1 | 2 | 3 | 4;
  certainty: 'confirmed' | 'inferred' | 'draft';
  points: Px[];
  widthPx?: number;
  mouth?: Px;
  basinId?: string;
};

type AreaFeature = {
  id: string;
  name?: string;
  kind: 'land' | 'ocean' | 'lake' | 'forest' | 'mountain' | 'desert' | 'swamp' | 'ice' | 'plain' | 'basin' | 'political';
  certainty: 'confirmed' | 'inferred' | 'draft';
  rings: Px[][];
};

type TerrainControl = {
  id: string;
  kind: 'coast' | 'ridge' | 'peak' | 'valley' | 'riverbed' | 'plateau' | 'cliff';
  weight: number;
  radiusPx?: number;
  points: Px[];
};
```

Every generated raster/tile should carry a manifest with source image path, transform, script version, date, and layer confidence.

### 2. Offline/static preprocessing pipeline

Do as much terrain synthesis offline as possible, then serve static tiles to the browser. This keeps GitHub Pages/static hosting viable and avoids blocking the main thread.

Recommended folders:

```text
scripts/
  extract_map_layers.py          # raster masks from source image colors + cleanup
  trace_layers.py                # converts masks to polygons/polylines; manual override friendly
  synthesize_height_tiles.py     # generates tiled height/normal/material masks
  build_terrain_manifest.py
public/terrain/
  manifest.json
  imagery/{z}/{x}/{y}.webp       # source map pyramid / painterly imagery pyramid
  height/{z}/{x}/{y}.png         # 16-bit PNG or encoded RGBA height
  normal/{z}/{x}/{y}.webp        # optional precomputed normals
  masks/{z}/{x}/{y}.png          # channels: water, forest, mountain, desert/other
  vector/{z}/{x}/{y}.json        # clipped rivers/coasts/labels for visible tile region
src/terrain/
  coordinates.ts
  TerrainTileManager.ts
  TerrainTile.tsx
  materials/TerrainMaterial.ts
  workers/tileWorker.ts
```

For tile generation in source pixels, choose a quadtree tile scheme over the rectangle. A 10k-wide image at 256px tiles is about `40 × 22` tiles at full resolution; with overviews this is manageable. Use `512px` tiles for fewer requests if the R3F terrain consumes height maps directly, or `256px` for standard map-like tile pyramids.

### 3. Runtime rendering stack

Use R3F/Three.js directly for the terrain-first experience rather than MapLibre as the core 3D renderer. MapLibre/OpenLayers are useful for a 2D source-map foundation, but stylized terrain, carved rivers, painterly materials, and Google-Earth-like camera/fly controls fit better in a custom Three scene.

Recommended runtime components:

- **Camera controller:** custom fly/orbit hybrid over source-pixel terrain. Keep current `pxToWorld` but generalize world units so source pixels map consistently to tile meshes.
- **Tile manager:** determines visible tiles from camera footprint; loads height/imagery/mask/vector tiles; caches with an LRU.
- **Terrain tile mesh:** regular grid initially; later RTIN/LOD mesh. Each tile knows source-pixel bounds and samples height texture/mask texture.
- **Vector overlays:** rivers/coasts/borders rendered as geometry clipped per visible tile. Rivers should sit in carved valleys and remain visible at all zoom levels.
- **Labels/pins:** existing 602 locations can remain as exact-coordinate markers, with clustering/decluttering by zoom.
- **Effects:** atmosphere, cloud shadows, DOF, bloom only after terrain/geography are verified.

## Heightmap generation from map-derived layers

The source map is cartographic art, not a physical DEM, so the height field should be synthesized from explicit controls:

1. **Base classes**
   - Ocean/sea: below zero, flat.
   - Lakes: flat local water level, slightly above ocean if inland.
   - Land: low positive base, with subtle low-frequency noise.
   - Coasts: smooth elevation ramp from water to land.

2. **Distance fields**
   Generate signed/distance fields from vector masks:
   - `d_coast`: distance to coastline; controls beach/shore gradient.
   - `d_river`: distance to nearest river polyline; controls river carving.
   - `d_ridge`: distance to mountain ridge polylines; controls ridge uplift.
   - `d_forest`: distance/inside forest polygons; controls material/vegetation, usually not height.

3. **Mountains**
   Use traced ridgelines and peaks, not random cones. For each ridge segment:
   - Raise along the ridge with anisotropic falloff perpendicular to the line.
   - Add asymmetric shoulders and secondary ridges via filtered noise.
   - Respect water masks; mountains should not spill across lakes/seas unless the source says cliffs/islands.
   - Generate separate `mountainMask` and `slopeMask` for material shading and snow/rock accents.

   Example height contribution:

   ```ts
   ridgeHeight = ridgeWeight * exp(-(distanceToRidge / radiusPx)^2) * ridgeProfileAlongLine;
   peakHeight = peakWeight * exp(-(distanceToPeak / peakRadiusPx)^2);
   ```

4. **River carving**
   Rivers need both visible blue geometry and terrain deformation:
   - Burn river polylines into a distance field.
   - Carve a V/U valley: `height -= depth * smoothstep(widthOuter, widthInner, d_river)`.
   - For rank 1 rivers, add a flat/wet inner channel below land height.
   - Ensure downstream monotonicity where possible by smoothing height along the polyline from source to mouth.
   - At lake/ocean mouths, widen and flatten channels to avoid floating/blocked water.

   If full hydrology is too expensive early, start with visual coherence: the river mesh samples the terrain height and is slightly offset above it, while height tiles include shallow carved channels.

5. **Coasts and cliffs**
   - Coastline from land/water mask controls beach ramps and ocean plane intersection.
   - Cliff controls can be explicit `TerrainControl(kind:'cliff')` where the source map shows steep coastal/mountain edges.
   - Render water as a large ocean plane at sea level plus lake polygons at local flat heights.
   - Add foam/shoreline ribbons from coast vectors after the coastline is stable.

6. **Forests/biomes**
   Forest polygons should drive material and instanced vegetation density, not arbitrary tree scatter. Runtime can use:
   - Low-cost canopy impostors/instanced low-poly trees at mid/close zoom.
   - Painterly green material splat at far zoom.
   - Density masks baked per tile; deterministic blue-noise sampling for tree instances.

## Layer extraction strategy from the source map

The z6 mosaic appears color-coded enough for semi-automatic extraction (quick palette sampling showed large water/background color families plus green/brown/gray land classes), but labels/line art will interfere. Use a hybrid approach:

1. **Automated first pass**
   - Downsample/crop by region for iteration.
   - Convert to perceptual color space (Lab/HSV).
   - Segment likely water/land/forest/mountain/desert by color thresholds and clustering.
   - Morphological cleanup: remove text speckles, fill holes, simplify regions.
   - Vectorize masks with contour tracing (`opencv-python`, `skimage.measure.find_contours`, or potrace-style bitmap tracing).

2. **Line extraction for rivers/coasts**
   - Rivers often require manual/semi-manual tracing because labels and coastlines share dark strokes.
   - Use the existing Trace Studio/editor as a human-in-the-loop tool.
   - Add snapping/smoothing and source-map zoom levels; export draft GeoJSON-like source-pixel vectors.

3. **Manual QA**
   - Render every layer over the source map with confidence labels.
   - Do not promote `draft` to `confirmed` until visually reviewed.
   - Start with one vertical slice (e.g. Genabackis/Darujhistan/Pale) before full-world extraction.

Suggested Python tooling: Pillow, OpenCV, scikit-image, numpy/scipy distance transforms, shapely for geometry cleanup, simplification via mapshaper or simplify-js, and optional QGIS for manual corrections. Browser-only extraction is not recommended for the full 10k map.

## Mesh, tiling, and LOD options

### Baseline: regular grid terrain tiles

Start with regular grid `PlaneGeometry` tiles displaced from height textures/data:

- Tile size: 256 or 512 source pixels.
- Geometry: `65 × 65` vertices per close tile, `33 × 33` mid, `17 × 17` far.
- Load lower LOD first, refine around the camera.
- Stitch seams by sharing edge samples or using skirts around tile edges.

This is easiest to implement in R3F and adequate for the first credible terrain slice.

### Next: quadtree LOD

Use a quadtree keyed by source-pixel bounds. Split when screen-space error exceeds threshold. Add skirts or edge morphing to hide cracks. Maintain no more than 1 LOD difference between neighboring tiles.

### Advanced: RTIN / MARTINI / Delatin

Relevant libraries found:

- **Mapbox MARTINI** (`mapbox/martini`): JavaScript real-time RTIN terrain mesh generation from height data. It builds a hierarchy of triangular meshes of varying precision and supports larger index buffers with `Uint32Array`.
- **Mapbox Delatin**: JavaScript terrain mesh tool that approximates a height field with Delaunay triangulation, minimizing points/triangles for a maximum error.

Recommendation: do **not** start here. Implement regular grid tiles first; add MARTINI/Delatin only when terrain tile count or triangle budget becomes a measured bottleneck. RTIN is strongest for natural DEM-like terrain; this fantasy map terrain will be stylized and masks/vectors may matter more than height compression early.

## Materials and stylized rendering

### Terrain material

Use a custom shader material or `onBeforeCompile`/`THREE-CustomShaderMaterial` style approach:

Inputs per tile:
- height texture/data,
- normal map or derivative normals,
- mask texture channels: water/shore, forest, mountain/rock, desert/plain/snow,
- source imagery/painterly base tile.

Shader responsibilities:
- Palette-map the source imagery into a cohesive painterly look.
- Blend biome colors by mask channels and slope/height.
- Add low-frequency noise/dither to avoid flat gradients.
- Use ramp/toon-ish lighting for a stylized low-poly/painterly feel.
- Optional faceted normals for low-poly mode, but avoid turning terrain into cubes.

### Water

Use two levels:

1. **Far/cheap:** flat ocean/lake meshes clipped by water polygons or one ocean plane under land, with transparent stylized blue material.
2. **Near/stylized:** shader-based water with time-varying normals/foam; rivers are ribbons/tubes/strips following actual polylines and terrain height.

R3F stylized water tutorials demonstrate a performant approach: simple water plane, custom shader uniforms for water level/colors, foam/noise, and material consistency. Keep water cheap and legible; this is an atlas, not a physical ocean simulation.

### Rivers

Best approach:
- Build a strip mesh along each river polyline with width by rank.
- Sample synthesized height at strip vertices; offset by a few centimeters/world units.
- Add emissive/bright blue outline only in fantasy mode, but keep geometry aligned.
- Use confluence joins and rank-based widths.
- At far zoom render as screen-space/vector lines; at near zoom render as inset water ribbons in carved channels.

### Forests and mountains

- Mountains: render terrain uplift first; optional stylized ridge meshes/rock outcrops from ridge vectors at close zoom.
- Forests: baked green canopy splat at far zoom; deterministic instanced tree clusters in polygons near the camera. Use instanced meshes and cap counts aggressively.
- Cities: exact-coordinate labels/tokens; avoid oversized miniatures by default until regional terrain is correct.

## Performance constraints and budgets

Target static-browser performance:

- Initial load under ~5–10 MB compressed for the default view; defer high-res tiles and vector details.
- Keep visible triangles under ~200k–500k on desktop, ~75k–150k on mobile.
- Cap device pixel ratio: desktop `[1, 1.8]`, mobile `[1, 1.25]`.
- Tile cache: ~100–200 MB decoded texture/geometry max on desktop; much lower on mobile.
- Workers for tile decode, mask processing, vector clipping, and geometry assembly if CPU spikes appear.
- Use compressed image assets: WebP/JPEG for imagery, PNG only where exact masks/height precision matter.
- Avoid one giant JSON heightmap for the final product; `terrain-heightmap.json` is okay for a prototype but not a scalable global terrain source.
- Use instancing for trees/rocks/markers; cluster labels by zoom.

## Library/technology recommendations

Keep:
- React/Vite/R3F/Three.js.
- Zustand for UI/camera/layer state.
- Existing exact-coordinate locations/search and trace editor concepts.

Add/evaluate:
- `@react-three/drei` helpers already present for controls/text; continue using selectively.
- `martini` or `delatin` later for RTIN terrain LOD if measured bottleneck.
- `geojson-vt` or static pre-tiled vector JSON for large vector layers; useful for clipping rivers/coasts/biomes by tile.
- Python preprocessing stack: Pillow, OpenCV/scikit-image, numpy/scipy, shapely, mapshaper/simplify-js.
- Playwright/browser screenshots for visual QA.

Avoid as core renderer:
- A pure MapLibre-only solution for the final 3D terrain. It can be excellent for 2D source-map inspection but will fight the custom stylized terrain goal.
- Procedural/noise terrain not anchored to traced controls.
- Full-resolution global geometry/one giant texture in a single Three mesh.

## Staged milestones

### Milestone 0 — research-to-plan handoff

- Document architecture and choose first vertical slice.
- Confirm source image, current data, and rejected constraints.
- Define tile/layer manifests.

### Milestone 1 — tile-pyramid terrain foundation

- Generate source imagery tile pyramid from z6 mosaic.
- Replace full 10k texture usage with tiled imagery.
- Implement tile manager and regular grid terrain tile meshes.
- Start with a neutral heightfield and exact coordinate/camera mapping.
- Keep 602 pins/search working.

Acceptance: fast zoom/pan/fly across the full world, no cube-board, no single PNG panel feel.

### Milestone 2 — vertical-slice extraction

- Pick Darujhistan/Pale/Genabackis slice.
- Trace/derive coastline/water/lake, key rivers, basin, mountain ridges, forest polygons.
- Render source overlay + derived layers for QA.
- Store vectors in source-pixel coordinates with `draft` confidence.

Acceptance: rivers/coasts/forests/mountains visibly align to the source map in the slice.

### Milestone 3 — height synthesis and river carving

- Generate tiled height/mask data from vector controls.
- Add coast gradients, mountain ridge uplift, river carving, lake/ocean flattening.
- Render rivers as terrain-following strips.
- Add material masks for water/shore/rock/forest/plain.

Acceptance: continuous terrain explains the map geography even with source texture dimmed/off.

### Milestone 4 — stylized materials and close-detail

- Add painterly terrain shader, slope/height/biome blending.
- Add stylized water shader and shoreline foam/ribbons.
- Add instanced forest/rock details from masks/vectors near camera.
- Add tasteful labels/city markers.

Acceptance: cute/cool premium atlas style without geography drift.

### Milestone 5 — full-world rollout and performance hardening

- Expand extraction layer-by-layer across the full 10k map.
- Pre-tile vector layers and height/mask textures.
- Add worker decoding/clipping and LOD refinement.
- Add mobile constraints and visual regression screenshots.

Acceptance: full-world source-derived terrain works on desktop and degrades gracefully on mobile.

### Milestone 6 — atmosphere/presentation

Only after the terrain is credible:
- Clouds/shadows,
- DOF/cinematic bookmarks,
- guided tours,
- screenshot/presentation mode.

Acceptance: effects enhance the atlas, not hide incomplete terrain.

## Key risks

- **Source-map ambiguity:** color segmentation may confuse labels, roads, rivers, and borders. Mitigation: human-in-loop tracing and confidence labels.
- **Height is invented unless controls are explicit:** cartographic maps do not contain real elevation. Mitigation: derive from mountain/ridge/coast/river controls and label as stylized terrain.
- **Performance regressions from giant assets:** current 10k texture and JSON heightmap are useful prototypes but not scalable. Mitigation: tile everything.
- **Visual temptation:** adding clouds/DOF/cute miniatures too early will repeat the rejected direction. Mitigation: default view shows source-derived terrain layers first.

## Bottom-line recommendation

Build the atlas as a static tiled terrain engine over source-pixel coordinates:

1. image/height/mask/vector tile pyramid from the 10k source map;
2. regular grid terrain tiles first, quadtree/RTIN later only if needed;
3. height synthesized from traced coasts, water, rivers, ridges, forests, and biomes;
4. rivers/coasts rendered as real aligned geometry, not decorative overlays;
5. painterly/low-poly materials and atmosphere after terrain correctness is visible.
