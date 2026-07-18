# The Atlas — Interactive Malazan World Board Prototype

Static Three.js / React prototype for Kyle's scale Malazan world map idea.

## What it currently does

- Loads the existing World of Malazan stitched source image as a ghost atlas texture.
- Adds cute/cool 3D city miniatures for Darujhistan and Pale, including gaslight glow/siege smoke styling, anchored to exact source coordinates.
- Adds camera bookmark chips for Whole slice, Darujhistan, Pale, and Rivers; each smoothly flies the 3D camera and updates the info card.
- Adds a reusable miniature landmark-token family for mountains/hills, forests, lakes, and ruins, with clickable exact-coordinate info cards.
- Adds a compact clickable map key so the token/overlay visual language is legible during demos.
- Adds a magical selected-location aura: animated glow ring, soft beacon, and point light follow the selected marker/search result.
- Adds presentation / clean screenshot mode, hiding HUD panels while preserving a single exit control for polished demo captures.
- Adds guided-tour mode that enters presentation view and auto-flies through Whole slice, Darujhistan, Pale, and Rivers; generic pins are hidden during presentation for cleaner captures.
- Adds a polished guided-tour caption card in presentation mode so screenshots/demos explain the current stop without restoring the full HUD.
- Adds a hand-drawn-style compass rose and source-pixel scale ribbon inside the overview card, reinforcing that the cute board still has exact cartographic grounding.
- Adds a real search-results panel: typing a place/category shows ranked results; selecting a result updates the card and smoothly flies the camera to that source coordinate.
- Adds category filter chips for all, settlements, places, water, mountains, terrain, and forests; these filter both pins and search results, with the current filter reflected in stats.
- Preserves the source coordinate system: `10000 × 5571 px`.
- Loads all 602 extracted map locations into `public/data/locations.json`.
- Renders a cute/cool voxel-style miniature board with:
  - raised terrain blocks
  - enamel-like sea edge
  - soft clouds/cloud shadows
  - optional cinematic DOF/bloom toggle
  - clickable/filterable location pins
  - prototype Genabackis river/basin/biome authoring layers
- Starts focused on the Darujhistan/Pale vertical slice.
- Includes a first **river tracing desk** overlay: source atlas crop underneath, rivers/basins/biomes as clickable exact-pixel vector overlays, and per-feature point counts for refinement.
- The tracing desk now supports draft river and boundary editing: choose an active river or basin/biome boundary, append source-pixel points, drag existing handles, delete a selected point, undo the last river point, auto-save the draft to browser localStorage, download `prototype-features.draft.json`, reset to checked-in data, and copy a generated JSON export back into `prototype-features.json`.
- The tracing desk also includes a live source-coordinate cursor readout, crosshair preview, and draggable glowing river-point handles so authoring new river geometry is precise.
- The tracing desk toolbar is grouped into Targets, Edit, Repair, and Draft sections, with the 3D board callout hidden while authoring so the desk stays clean.

## Run

```bash
cd /root/kyle/projects/malazan-mechanical-map/atlas-web
npm install
npm run dev -- --port 5177
```

## Build

```bash
npm run build
```

Verified passing on 2026-07-18.

## Important source discipline

The river/basin/biome layers in `public/data/prototype-features.json` are **prototype visual traces**, not canon-complete geography. The app is intentionally structured so those can be replaced with high-detail hand-traced river polylines, drainage basins, and terrain polygons in exact source pixel coordinates.

## Next upgrades

1. Add an authoring/editor mode for tracing rivers and polygons over the source atlas.
2. Build the first polished Genabackis dataset: Pale, Darujhistan, Lake Azur, Gadrobi Hills, Blackdog Forest, nearby coast/water systems.
3. Replace broad procedural terrain with source-derived biome/height tiles.
4. Connect selected locations to spoiler-safe Malazan companion notes.
5. Add saved camera bookmarks and cinematic focus transitions.
