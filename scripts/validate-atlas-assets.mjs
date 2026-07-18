import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const checks = [];
function ok(name, value) { checks.push({ name, ok: Boolean(value) }); if (!value) throw new Error(`Asset validation failed: ${name}`); }

const source = path.join(root, 'public/assets/worldofmalazan-z6-mosaic.png');
const meta = await sharp(source).metadata();
ok('z6 source width is 10000', meta.width === 10000);
ok('z6 source height is 5571', meta.height === 5571);

const manifestPath = path.join(root, 'public/tiles/source/manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
ok('manifest coordinate space', manifest.coordinateSpace === 'malazan.source-pixel');
ok('manifest source pixels', manifest.sourcePixels?.[0] === 10000 && manifest.sourcePixels?.[1] === 5571);
ok('manifest tile size 512', manifest.tileSize === 512);
ok('manifest max zoom 6', manifest.maxZoom === 6);
const tileCount = manifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('source tile count is 305', tileCount === 305);
const reliefManifest = JSON.parse(await fs.readFile(path.join(root, 'public/tiles/relief/manifest.json'), 'utf8'));
ok('relief manifest coordinate space', reliefManifest.coordinateSpace === 'malazan.source-pixel');
ok('relief manifest source pixels', reliefManifest.sourcePixels?.[0] === 10000 && reliefManifest.sourcePixels?.[1] === 5571);
const reliefTileCount = reliefManifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('relief tile count is 305', reliefTileCount === 305);
const premiumManifest = JSON.parse(await fs.readFile(path.join(root, 'public/tiles/premium-relief/manifest.json'), 'utf8'));
ok('premium manifest coordinate space', premiumManifest.coordinateSpace === 'malazan.source-pixel');
ok('premium manifest source pixels', premiumManifest.sourcePixels?.[0] === 10000 && premiumManifest.sourcePixels?.[1] === 5571);
const premiumTileCount = premiumManifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('premium tile count is 305', premiumTileCount === 305);
const v2Manifest = JSON.parse(await fs.readFile(path.join(root, 'public/tiles/stylized-v2/manifest.json'), 'utf8'));
ok('stylized v2 manifest coordinate space', v2Manifest.coordinateSpace === 'malazan.source-pixel');
ok('stylized v2 manifest source pixels', v2Manifest.sourcePixels?.[0] === 10000 && v2Manifest.sourcePixels?.[1] === 5571);
const v2TileCount = v2Manifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('stylized v2 tile count is 305', v2TileCount === 305);

for (const level of manifest.levels) {
  for (let x = 0; x < level.cols; x += 1) {
    for (let y = 0; y < level.rows; y += 1) {
      const tilePath = path.join(root, 'public/tiles/source', String(level.z), String(x), `${y}.webp`);
      await fs.access(tilePath);
    }
  }
}

const locations = JSON.parse(await fs.readFile(path.join(root, 'public/data/locations.json'), 'utf8'));
const prototypeFeatures = JSON.parse(await fs.readFile(path.join(root, 'public/data/prototype-features.json'), 'utf8'));
const waterFeatures = JSON.parse(await fs.readFile(path.join(root, 'public/data/water-features.json'), 'utf8'));
ok('water features coordinate space', waterFeatures.coordinateSpace === 'malazan.source-pixel');
ok('water features source pixels', waterFeatures.sourcePixels?.[0] === 10000 && waterFeatures.sourcePixels?.[1] === 5571);
ok('water features extracted', waterFeatures.featureCount > 0 && waterFeatures.features?.length === waterFeatures.featureCount);
const lakeAzur = waterFeatures.features.find((feature) => feature.id === 'water_lake_azur');
ok('Lake Azur source-derived water feature exists', lakeAzur);
ok('Lake Azur bbox near Darujhistan source coordinate', lakeAzur?.bbox_px?.[0]?.[0] >= 6600 && lakeAzur?.bbox_px?.[1]?.[0] <= 6900 && lakeAzur?.bbox_px?.[0]?.[1] >= 1400 && lakeAzur?.bbox_px?.[1]?.[1] <= 1550);
ok('Lake Azur polygon has enough points', lakeAzur?.points_px?.length >= 6);
const terrainFeatures = JSON.parse(await fs.readFile(path.join(root, 'public/data/terrain-features.json'), 'utf8'));
ok('terrain features coordinate space', terrainFeatures.coordinateSpace === 'malazan.source-pixel');
ok('terrain features source pixels', terrainFeatures.sourcePixels?.[0] === 10000 && terrainFeatures.sourcePixels?.[1] === 5571);
ok('terrain features extracted', terrainFeatures.featureCount > 0 && terrainFeatures.features?.length === terrainFeatures.featureCount);
for (const kind of ['forest', 'desert', 'ice', 'mountain']) {
  ok(`terrain has ${kind} features`, terrainFeatures.countsByType?.[kind] > 0);
}
ok('terrain feature polygons have points', terrainFeatures.features.every((feature) => feature.points_px?.length >= 4 && feature.center_px?.length === 2));
const coastlineFeatures = JSON.parse(await fs.readFile(path.join(root, 'public/data/coastline-features.json'), 'utf8'));
ok('coastline features coordinate space', coastlineFeatures.coordinateSpace === 'malazan.source-pixel');
ok('coastline features source pixels', coastlineFeatures.sourcePixels?.[0] === 10000 && coastlineFeatures.sourcePixels?.[1] === 5571);
ok('coastline features extracted', coastlineFeatures.featureCount > 0 && coastlineFeatures.features?.length === coastlineFeatures.featureCount);
ok('coastline polygons have points', coastlineFeatures.features.every((feature) => feature.points_px?.length >= 4 && feature.center_px?.length === 2));
ok('major landmass coastline present', coastlineFeatures.features.some((feature) => feature.maskPixels > 90000));
const riverCandidates = JSON.parse(await fs.readFile(path.join(root, 'public/data/river-candidates.json'), 'utf8'));
ok('river candidates are explicitly unverified', riverCandidates.status === 'unverified-candidates-only');
ok('river candidates coordinate space', riverCandidates.coordinateSpace === 'malazan.source-pixel');
ok('river candidates source pixels', riverCandidates.sourcePixels?.[0] === 10000 && riverCandidates.sourcePixels?.[1] === 5571);
ok('river candidates extracted', riverCandidates.featureCount > 0 && riverCandidates.features?.length === riverCandidates.featureCount);
ok('river candidates are not marked verified', riverCandidates.features.every((feature) => feature.status !== 'verified' && feature.certainty?.includes('candidate-only')));
ok('Lake Azur guard remains active for river candidates', Array.isArray(riverCandidates.lakeAzurGuardPx) && riverCandidates.lakeAzurGuardPx.join(',') === '6200,1200,7200,1900');
ok('Lake Azur guard candidates are blocked', riverCandidates.features.filter((feature) => feature.touchesLakeAzurGuard).every((feature) => feature.blockedReason?.includes('Lake Azur')));
ok('no provisional Lake Azur/Darujhistan rivers remain', (prototypeFeatures.rivers ?? []).every((river) => {
  const pts = river.points_px ?? [];
  return !pts.some(([x, y]) => x >= 6200 && x <= 7200 && y >= 1200 && y <= 1900);
}));
ok('602 locations', locations.locations?.length === 602);
for (const loc of locations.locations) {
  const [x, y] = loc.center;
  ok(`location in bounds: ${loc.name}`, x >= 0 && x <= 10000 && y >= 0 && y <= 5571);
}

console.log(`validated source=${meta.width}x${meta.height}, sourceTiles=${tileCount}, reliefTiles=${reliefTileCount}, premiumTiles=${premiumTileCount}, v2Tiles=${v2TileCount}, locations=${locations.locations.length}`);
