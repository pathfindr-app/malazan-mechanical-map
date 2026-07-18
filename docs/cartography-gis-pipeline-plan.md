# Cartography/GIS Pipeline Plan — Source-Faithful Malazan Atlas

## Executive decision

Use the World of Malazan z6 mosaic as a **pixel-space GIS source**, not a decorative image. All authoritative features should be stored in `source-pixel` coordinates over the canonical image extent:

```txt
source image: /root/kyle/projects/malazan-mechanical-map/site-captures/worldofmalazan/worldofmalazan-z6-mosaic.png
image size:   10000 × 5571 px
origin:       top-left
x range:      0..10000 left→right
y range:      0..5571 top→bottom
runtime CRS:  Leaflet CRS.Simple / local image coordinates, not Earth lat/lon
existing POI: 602 locations in public/data/locations.json
```

The practical workflow is hybrid:

1. **Preprocess and segment obvious color-coded layers** from the source raster with Python/OpenCV/scikit-image.
2. **Polygonize/skeletonize candidate masks** with GDAL/rasterio/shapely or QGIS Polygonize.
3. **Human-correct in QGIS or an in-app tracing desk** because fantasy-map labels, hill symbols, decorative textures, and anti-aliased linework will create false positives.
4. **Normalize into source-pixel GeoJSON/JSON layers** with strict schemas, provenance, confidence, and validation metrics.
5. **Render from vectors/tiles**, not from guessed terrain assets.

This is the only route that matches the user's "no slop" requirement: automation accelerates extraction, but every layer remains auditable against the 10k source map.

## Research findings / tool choices

- **QGIS Georeferencer** is designed for aligning unreferenced rasters/vectors to coordinate systems with ground control points and can export GeoTIFF/world files. Here we do not need Earth georeferencing; we need a local affine pixel CRS. The useful part is QGIS's raster-backed digitizing, snapping, topology tools, and GeoPackage/GeoJSON export.
- **QGIS raster-to-vector / Polygonize** and **`gdal_polygonize`** convert classified raster pixels into vector polygons. GDAL's polygonize creates polygons for connected regions with the same pixel value and can use masks. This is appropriate for land/water/biome masks after we create clean binary/class rasters.
- **QGIS digitizing + snapping/topology checker** is necessary for correctness: coast rings must close; basin polygons must not self-intersect; river mouths should snap to coast/lake polygons; tributaries should snap to parent rivers.
- **QGIS Raster Tracer / GeoSAM-style plugins** may help semi-automatic tracing, but should be treated as drafting tools. SAM/GeoSAM is useful for click-guided masks but not authoritative; labels and map symbols will confuse it.
- **OpenCV/scikit-image** are best for batch candidate extraction: HSV/LAB color thresholds, morphology cleanup, connected components, contours, thinning/skeletonization, edge detection.
- **Potrace/autotrace** can trace clean monochrome masks but is less useful directly on the full map. Use only after preprocessing a binary mask.
- **Mapshaper** is the cleanup/export tool: simplify, clean, dissolve, filter slivers/islands, reduce coordinate precision, inspect topology, and emit compact GeoJSON/TopoJSON.
- **MapLibre** is excellent for WGS84/WebMercator vector tiles but awkward for arbitrary non-earth pixel coordinates. For the near-term atlas, prefer either:
  - **OpenLayers / Leaflet CRS.Simple** for the 2D source atlas foundation, or
  - **Three.js/R3F custom pixel transform** for terrain rendering.
  If vector tiles become necessary, generate a local tile coordinate system and adapt renderer math, rather than forcing fake lat/lon unless a library requires it.
- **Performance guidance from MapLibre large-GeoJSON docs still applies**: remove unused properties, reduce coordinate precision, simplify geometry, split/chunk large layers, and consider vector tiles for large layers.

## Coordinate model

Keep source pixels as the canonical data. Do not round-trip through lat/lon as storage.

```ts
type SourcePx = [number, number]; // [x, y], image pixels, origin top-left

type SourceCrs = {
  name: 'malazan.source-pixel';
  image: 'worldofmalazan-z6-mosaic.png';
  width: 10000;
  height: 5571;
  origin: 'top-left';
  axis: { x: 'east/right'; y: 'south/down' };
};
```

For RFC GeoJSON compatibility, store geometries as normal GeoJSON coordinates where `coordinates` are `[x, y]` source pixels. Add explicit metadata so no consumer mistakes them for lon/lat:

```json
{
  "type": "FeatureCollection",
  "name": "rivers",
  "crs_local": {
    "name": "malazan.source-pixel",
    "imageWidth": 10000,
    "imageHeight": 5571,
    "origin": "top-left"
  },
  "features": []
}
```

Runtime transforms:

```ts
const MAP_W = 10000;
const MAP_H = 5571;

function pxToUnit([x, y]: SourcePx): [number, number] {
  return [x / MAP_W, y / MAP_H];
}

function pxToThree([x, y]: SourcePx, boardW = 20): [number, number, number] {
  const boardH = boardW * MAP_H / MAP_W;
  return [(x / MAP_W - 0.5) * boardW, 0, (0.5 - y / MAP_H) * boardH];
}

function pxToLeafletSimple([x, y]: SourcePx): [number, number] {
  // Leaflet CRS.Simple expects [lat, lng] = [y, x] style in many APIs.
  return [y, x];
}
```

## Recommended source data layout

Create generated and hand-edited layers separately so machine drafts never overwrite curated data:

```txt
public/data/source-crs.json
public/data/locations.json                         # existing 602 points
public/data/layers/
  land.geojson
  water.geojson
  coastlines.geojson
  rivers.geojson
  drainage-basins.geojson
  mountains.geojson
  forests.geojson
  biomes.geojson
  political-regions.geojson
  labels.geojson
  qa-control-points.geojson
work/cartography/
  masks/                                           # generated binary/class rasters
  drafts/                                          # generated contours/skeletons
  qgis/malazan-atlas.gpkg                          # authoritative editing workspace
  exports/                                         # normalized release candidates
scripts/cartography/
  build_source_tiles.py
  classify_masks.py
  vectorize_masks.py
  normalize_layers.py
  validate_layers.py
  export_static_layers.py
```

## Layer schemas

### Common feature properties

Every vector feature needs traceability and confidence:

```ts
type CommonProps = {
  id: string;
  name?: string;
  layer: string;
  class?: string;
  source: 'worldofmalazan-z6-mosaic';
  source_image: 'worldofmalazan-z6-mosaic.png';
  certainty: 'confirmed' | 'human_traced' | 'machine_draft' | 'inferred';
  extraction: 'manual_qgis' | 'in_app_trace' | 'opencv_threshold' | 'gdal_polygonize' | 'sam_assisted' | 'hybrid';
  reviewed_by?: string;
  reviewed_at?: string;
  min_zoom?: number;
  max_zoom?: number;
  notes?: string;
};
```

### Land / water / coast

- `land.geojson`: `MultiPolygon` land masses and islands.
- `water.geojson`: `Polygon/MultiPolygon` seas, oceans, lakes.
- `coastlines.geojson`: `LineString/MultiLineString` derived from land/water boundary, not separately hand-guessed unless needed.

```ts
type SurfaceProps = CommonProps & {
  class: 'land' | 'ocean' | 'sea' | 'lake' | 'island' | 'bay' | 'strait';
  area_px2: number;
  perimeter_px?: number;
};
```

Validation:

- all land/water rings closed;
- no self-intersections;
- no major gaps between land and water masks;
- islands below threshold tagged/filtered intentionally, not lost accidentally;
- coast overlay visually within ~1-3 px of source at validation zoom for high-confidence areas.

### Rivers

Use directed centerlines from source/headwaters to mouth or vice versa, but be consistent. I recommend `direction: upstream_to_downstream` because it supports flow animation and basin validation.

```ts
type RiverProps = CommonProps & {
  class: 'river' | 'tributary' | 'canal' | 'delta';
  rank: 1 | 2 | 3 | 4 | 5;
  direction: 'upstream_to_downstream';
  parent_id?: string;
  basin_id?: string;
  mouth?: SourcePx;
  width_px?: number;
  intermittent?: boolean;
};
```

Geometry: `LineString` / `MultiLineString` in source pixels.

Validation:

- river endpoints snap to lake/ocean/coast or named confluence within tolerance;
- tributaries snap to parent river, not just visually overlap;
- no random Catmull smoothing that moves lines away from source; smoothing must preserve control points or be rendered-only;
- visual QA samples every river segment against source image.

### Drainage basins

```ts
type BasinProps = CommonProps & {
  class: 'drainage_basin';
  outlet_river_id?: string;
  outlet_px?: SourcePx;
  area_px2: number;
};
```

Geometry: `Polygon/MultiPolygon`.

Validation:

- basin polygons cover target land without overlaps unless explicitly hierarchical;
- basin outlet lies on coast/lake/river mouth;
- contained rivers reference matching `basin_id`.

### Mountains / ridges / peaks

Use ridgelines, not decorative mountain icons, as the terrain control authority.

```ts
type MountainProps = CommonProps & {
  class: 'ridge' | 'peak' | 'pass' | 'foothills' | 'range_area';
  range_name?: string;
  elevation_rank?: 1 | 2 | 3 | 4 | 5;
  terrain_weight?: number;
  width_px?: number;
};
```

Geometry:

- ridges: `LineString/MultiLineString`;
- peaks/passes: `Point`;
- range areas: `Polygon`.

Validation:

- ridge lines follow actual mountain-symbol belts from source;
- forests/cities/water masks do not cover ridge cores unless intentional;
- terrain generation uses these ridges to raise continuous terrain, not random cones.

### Forests and biomes

```ts
type BiomeProps = CommonProps & {
  class: 'forest' | 'jungle' | 'desert' | 'plain' | 'steppe' | 'swamp' | 'ice' | 'hills' | 'wasteland' | 'settled';
  density?: number;       // 0..1 for vegetation/material scatter
  material_rank?: number; // renderer style variation
  area_px2: number;
};
```

Geometry: `Polygon/MultiPolygon`.

Validation:

- polygons follow source texture/symbol regions;
- labels and place names are masked out during automation then repaired manually;
- biome polygon edges do not imply certainty where source is ambiguous; use `certainty: inferred` for fuzzy transitions.

## Extraction workflow by layer

### 0. Source setup

1. Copy/link the z6 mosaic into a cartography work directory.
2. Create `source-crs.json` with image size, hash, path, and origin.
3. Generate a QGIS-friendly GeoTIFF with an affine transform whose pixel coordinates equal map coordinates. Use a local CRS string or no CRS, but set geotransform so extents are `0..10000` and `5571..0` or `0..5571` consistently.
4. Create a QGIS project with raster locked as read-only and vector layers in a GeoPackage.

Example geotransform concept:

```bash
# The key idea: assign pixel-size 1 and top-left origin. Test orientation in QGIS.
gdal_translate -of GTiff \
  -a_ullr 0 0 10000 5571 \
  -a_srs LOCAL_CS["Malazan source pixels"] \
  worldofmalazan-z6-mosaic.png work/cartography/source/malazan-source-px.tif
```

If QGIS displays y-up and inverts the raster, handle the QGIS transform in export scripts, not by changing the canonical stored JSON. Canonical storage remains top-left y-down.

### 1. Land/water/coast candidate extraction

The source map appears strongly color-separated: sampled dominant water is light blue (`~#c4dfff`), with land greens/tans and white labels. Start with color clustering:

1. Downsample for exploratory palettes; classify in LAB/HSV, not raw RGB only.
2. Create binary masks for water-like pixels and land-like pixels.
3. Morphologically close small label gaps and anti-alias speckles.
4. Remove text/label artifacts using connected-component area filters and optional OCR/text masks if needed.
5. Polygonize water and land masks.
6. Dissolve by class, remove slivers, simplify conservatively.
7. Hand-correct coastlines and lakes in QGIS.

Candidate commands/tools:

```bash
python scripts/cartography/classify_masks.py \
  --image site-captures/worldofmalazan/worldofmalazan-z6-mosaic.png \
  --out work/cartography/masks/surfaces.tif

gdal_polygonize.py -8 work/cartography/masks/surfaces.tif \
  -f GPKG work/cartography/drafts/surfaces.gpkg surfaces class_id

mapshaper work/cartography/drafts/surfaces.geojson \
  -clean \
  -filter-slivers min-area=20 \
  -simplify dp 5% keep-shapes \
  -o precision=0.1 public/data/layers/water.geojson
```

### 2. Rivers

Rivers are thin blue linework, so polygonizing the whole map is too noisy. Use a line-specific workflow:

1. Isolate dark/saturated blue/cyan pixels excluding large water bodies.
2. Use morphology to connect short gaps caused by labels and anti-aliasing.
3. Skeletonize mask to 1-pixel centerlines.
4. Vectorize skeleton into candidate polylines.
5. Snap tributary endpoints and simplify with low tolerance.
6. Human-correct in QGIS/in-app tracing desk against source image.
7. Assign `rank`, `parent_id`, `basin_id`, and `mouth`.

Important: generated centerlines are **draft only**. Label collisions will break rivers; manual repair is mandatory.

### 3. Mountains

Mountain ranges are symbol/texture belts, not simple elevation data. Treat extraction as control geometry:

1. Detect mountain-symbol color/texture candidates: tan/brown/gray clusters and edge density.
2. Produce rough `range_area` polygons via segmentation.
3. Have a human trace `ridge` centerlines through the actual mountain belts.
4. Add `peak` and `pass` points only when source labels/symbols justify them.
5. Use ridge width/elevation rank to synthesize terrain.

Do not generate per-mountain cones by noise. If stylized peaks are rendered, scatter them along ridge lines and inside range polygons.

### 4. Forests

Forests have repeated green tree textures/symbol clusters and named forest regions in `locations.json`.

1. Seed forest candidates from existing POIs where `category === 'forest'`.
2. Segment green texture clusters distinct from plains/land fill.
3. Polygonize and dissolve clusters.
4. Human-correct boundaries around named forests.
5. Store vegetation `density` and `certainty`.

### 5. Biomes / basins

Biomes are partly visual and partly inferred. They require conservative labels:

- `confirmed`: source shows clear texture/color boundary or named feature.
- `human_traced`: manually traced from visible map cues.
- `inferred`: needed for renderer continuity but not directly visible.
- `machine_draft`: never public as authoritative.

Drainage basins should be derived after rivers/coast/mountains exist, using ridges as divides and river outlets as anchors, then hand-adjusted.

## QGIS editing rules

Use QGIS as the authoritative correction environment for full-world layers:

- One GeoPackage: `work/cartography/qgis/malazan-atlas.gpkg`.
- Layers named exactly like export names.
- Snapping enabled for rivers↔rivers, rivers↔water, basin↔coast, biome boundaries.
- Topology rules:
  - land/water polygons must not self-intersect;
  - basins must not overlap peers unless a hierarchy field says so;
  - river endpoints must snap within e.g. `5 px` to confluence/mouth target;
  - coastline rings must close;
  - no feature coordinates outside `[0,10000]×[0,5571]`.
- Export through scripts only; do not manually copy QGIS exports into runtime without validation.

## Validation strategy

### Automated validation

`scripts/cartography/validate_layers.py` should check:

- JSON schema per layer.
- Coordinate bounds.
- Geometry validity (`shapely.is_valid`, no self-intersections).
- Minimum vertex/area thresholds and sliver reports.
- Topology:
  - river endpoint snapping;
  - river/basin membership;
  - land/water overlap/gap stats;
  - feature IDs unique and stable.
- Drift against source masks:
  - rasterize vector layer back to source grid or sampled tiles;
  - compare IoU / precision / recall against source-derived masks;
  - emit review tiles for bad areas.

Suggested acceptance gates for public/default layers:

```txt
coordinate bounds: 100% valid
geometry validity: 100% valid for confirmed/human_traced
land/water gross IoU vs reviewed mask: >= 0.97 for main continents/water
coastline visual drift: sampled high-confidence segments <= 3 px median
river endpoints: 100% snapped or explicitly tagged unsnapped_reason
machine_draft visible by default: 0 features
```

### Visual validation

Create `qa-control-points.geojson` with sampled locations around coasts, river mouths, mountain passes, and ambiguous biome boundaries. Build a browser/QGIS QA mode that overlays:

- source raster at 100%/200%;
- extracted vector lines/polygons;
- vertices/control points;
- drift heatmap or sampled error markers;
- status labels (`confirmed`, `draft`, `inferred`).

For each release candidate, export screenshots/tiles for review:

```txt
work/cartography/qa/
  coast-review-grid/*.png
  river-review-grid/*.png
  forest-review-grid/*.png
  biome-review-grid/*.png
  validation-report.json
```

### Runtime validation

In the app:

- Show source coordinate readout under cursor.
- Feature cards display `certainty`, `extraction`, and source image.
- Add toggles for source ghost, vertices, QA control points, and machine drafts.
- Default view should show only confirmed/human-traced layers; drafts off.

## Static delivery / renderer plan

Short term:

- Keep data as compressed external GeoJSON/JSON under `public/data/layers/`.
- Split by layer and possibly by continent/tile if a layer exceeds a few MB.
- Use source-pixel transforms in current R3F code or a 2D Leaflet/OpenLayers viewer.
- Simplify per zoom level: full-detail for close zoom, simplified TopoJSON for world zoom.

Medium term:

- Generate raster tile pyramid from source image.
- Generate vector layer tiles or chunks in the same pixel-tile scheme.
- Use OpenLayers/Leaflet CRS.Simple for 2D atlas mode, with R3F terrain mode consuming the same layer JSON.

MapLibre caution:

- MapLibre's default assumptions are WebMercator/WGS84 and vector tiles. It can render large data well when optimized, but arbitrary fantasy pixel CRS adds friction. Do not adopt MapLibre just because it sounds like Google Maps; choose it only if the team accepts the projection/tile adaptation cost.

## First concrete implementation steps

1. **Create source metadata and image hash**
   - `public/data/source-crs.json` with dimensions/hash/path.
   - Add a script to assert `locations.json.imageWidth/Height` match it.

2. **Create cartography workspace**
   - `work/cartography/{source,masks,drafts,qgis,exports,qa}`.
   - `scripts/cartography/` with repeatable commands.

3. **Generate a source tile pyramid**
   - Required for comfortable tracing/QA and atlas viewer performance.
   - Use `256` or `512` px tiles; retain pixel-coordinate tile math.

4. **Prototype land/water extraction**
   - Write `classify_masks.py` for LAB/HSV thresholding and morphology.
   - Produce `work/cartography/masks/water.tif` and `land.tif`.
   - Polygonize to draft GeoJSON/GPKG.
   - Manually inspect 10 coastal review tiles.

5. **Normalize layer schema**
   - Write `normalize_layers.py` to enforce IDs, metadata, precision `0.1 px`, bounds, and properties.
   - Export `public/data/layers/water.geojson`, `land.geojson`, `coastlines.geojson` as draft/hidden.

6. **Add validation script**
   - Bounds + geometry validity first.
   - Add raster comparison and drift metrics after masks stabilize.

7. **River vertical slice**
   - Pick one high-value region around Genabackis/Darujhistan/Pale where existing prototype has sample rivers.
   - Use automated blue-line skeletonization for candidates.
   - Repair manually and export 3-5 real river features with snapping/mouth metadata.

8. **Wire app to new layer files**
   - Replace `prototype-features.json` with schema-backed layer loads.
   - Render source-faithful overlays with confidence labels.
   - Keep machine drafts behind an explicit off-by-default QA toggle.

9. **Only then synthesize terrain**
   - Generate height controls from land/coast/rivers/ridges.
   - Render stylized mountains/forests from vector layers, never arbitrary random placement.

## What not to do

- Do not manually redraw the world from memory or fandom descriptions.
- Do not infer coastlines from location points.
- Do not store fake lon/lat as authoritative source data.
- Do not run SAM/AI segmentation and treat output as final.
- Do not smooth/coerce lines so they look good if they drift from source pixels.
- Do not hide missing/incorrect geography under painterly effects, clouds, depth-of-field, or city miniatures.

## Minimum done definition for the cartography pipeline

A first real cartography milestone is complete when:

- source CRS metadata exists and is used by scripts/app;
- source tile pyramid exists;
- at least one layer (`water/land/coast`) is generated from source pixels and manually corrected for a review slice;
- at least one river slice is traced with snapping metadata;
- validation reports coordinate bounds and geometry validity;
- browser overlay can toggle source raster + vector layer + vertices;
- all public/default features are `confirmed` or `human_traced`, with machine drafts hidden.
