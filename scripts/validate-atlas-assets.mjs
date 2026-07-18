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
ok('manifest max zoom 5', manifest.maxZoom === 5);
const tileCount = manifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('source tile count is 304', tileCount === 304);
const reliefManifest = JSON.parse(await fs.readFile(path.join(root, 'public/tiles/relief/manifest.json'), 'utf8'));
ok('relief manifest coordinate space', reliefManifest.coordinateSpace === 'malazan.source-pixel');
ok('relief manifest source pixels', reliefManifest.sourcePixels?.[0] === 10000 && reliefManifest.sourcePixels?.[1] === 5571);
const reliefTileCount = reliefManifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('relief tile count is 304', reliefTileCount === 304);
const premiumManifest = JSON.parse(await fs.readFile(path.join(root, 'public/tiles/premium-relief/manifest.json'), 'utf8'));
ok('premium manifest coordinate space', premiumManifest.coordinateSpace === 'malazan.source-pixel');
ok('premium manifest source pixels', premiumManifest.sourcePixels?.[0] === 10000 && premiumManifest.sourcePixels?.[1] === 5571);
const premiumTileCount = premiumManifest.levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
ok('premium tile count is 304', premiumTileCount === 304);

for (const level of manifest.levels) {
  for (let x = 0; x < level.cols; x += 1) {
    for (let y = 0; y < level.rows; y += 1) {
      const tilePath = path.join(root, 'public/tiles/source', String(level.z), String(x), `${y}.webp`);
      await fs.access(tilePath);
    }
  }
}

const locations = JSON.parse(await fs.readFile(path.join(root, 'public/data/locations.json'), 'utf8'));
ok('602 locations', locations.locations?.length === 602);
for (const loc of locations.locations) {
  const [x, y] = loc.center;
  ok(`location in bounds: ${loc.name}`, x >= 0 && x <= 10000 && y >= 0 && y <= 5571);
}

console.log(`validated source=${meta.width}x${meta.height}, sourceTiles=${tileCount}, reliefTiles=${reliefTileCount}, premiumTiles=${premiumTileCount}, locations=${locations.locations.length}`);
