# Plan: Terrain-First Malazan Atlas Rebuild

## Mission

Rebuild the atlas as a stylized Google Earth for Malazan. The goal is not a PNG overlay and not a decorative cube board. The goal is an explorable, source-faithful, continuous terrain atlas whose stylization is generated from correct geography.

## Parallel research agents

Three sub-agents have been launched:

1. **Cartography/GIS agent**
   - Source-map coordinate pipeline
   - Raster/vector extraction
   - River/coast/mountain/forest/biome schemas
   - QGIS/MapLibre/GeoJSON/static workflow
   - Validation against `10000 × 5571` source pixels

2. **Terrain generation/rendering agent**
   - Continuous terrain mesh/LOD
   - Heightmap generation from traced layers
   - River carving and water rendering
   - Mountain/forest generation from vectors
   - Stylized low-poly/painterly browser rendering

3. **Web architecture/performance agent**
   - Zoomable Google-Earth-style UX
   - Tile pyramid from 10k source map
   - Static hosting on GitHub/Molotan
   - Three.js/MapLibre/deck.gl architecture choices
   - Worker/tile/quadtree performance plan

## Immediate rebuild principles

- Full z6 map is the source foundation: `site-captures/worldofmalazan/worldofmalazan-z6-mosaic.png`.
- Canonical coordinate system: `10000 × 5571` source pixels.
- Keep all data in source-pixel coordinates.
- Do not place stylized assets unless their generating feature has source coordinates.
- Avoid public deploys until the result is aligned with the north star.

## Implementation phases

### Phase 0 — stop the wrong prototype

- Treat cube-board and PNG-overlay versions as rejected experiments.
- Keep useful pieces only: 602 locations, search logic, trace/editor code, GitHub repo, source-map captures.

### Phase 1 — real atlas foundation

- Generate a tile pyramid from the 10k z6 map.
- Replace the default UI with a smooth zoom/pan/fly map viewport.
- Keep 602 pins/search in exact source pixels.
- Add scale/coordinate readout.
- Make it feel like exploration, not a dashboard demo.

### Phase 2 — geography extraction

- Create/edit vector layers:
  - land mask/coastline,
  - oceans/seas/lakes,
  - rivers,
  - drainage basins,
  - mountain ridges/peaks,
  - forests,
  - deserts/plains/swamps/ice,
  - regions/borders.
- Build authoring/import/export tools around these layers.

### Phase 3 — terrain synthesis

- Convert vector layers into height/terrain controls:
  - water = low/flat,
  - coast = gradient,
  - mountains = ridge falloff,
  - rivers = carved valleys/channels,
  - forests/biomes = material/vegetation masks.
- Generate tiled terrain mesh / heightmaps.

### Phase 4 — stylized Google Earth rendering

- Add painterly/low-poly materials.
- Add coherent mountain ranges from ridges.
- Add visible rivers from actual vectors.
- Add forests from polygons.
- Add cities as subtle exact-coordinate labels/tokens.
- Add clouds/shadows/DOF only after terrain works.

## Acceptance criteria before next public push

- Looks like an explorable terrain/map viewer, not a board.
- Uses the 10k source map and exact coordinates.
- Pins land where they should.
- Rivers are visible and map-derived/draft-labeled.
- No arbitrary decorative cube terrain.
- No random toy assets by default.
- Build passes.
- Browser visual QA passes.
