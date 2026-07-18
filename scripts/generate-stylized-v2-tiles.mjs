import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceImage = path.join(root, 'work/cartography/v2/stylized-relief-v2-preview.png');
const tileRoot = path.join(root, 'public/tiles/stylized-v2');
const tileSize = 512;
const maxZoom = 5;
const W = 10000;
const H = 5571;

await fs.rm(tileRoot, { recursive: true, force: true });
await fs.mkdir(tileRoot, { recursive: true });

const manifest = {
  name: 'malazan-stylized-v2-relief-pyramid',
  sourceImage: 'work/cartography/v2/stylized-relief-v2-preview.png',
  sourcePixels: [W, H],
  tileSize,
  maxZoom,
  format: 'webp',
  quality: 94,
  origin: 'top-left',
  coordinateSpace: 'malazan.source-pixel',
  renderer: 'scripts/generate-cartography-v2-preview.mjs',
  notes: 'v2 source-derived stylized relief: open-water source blend disabled, protected labels/ink, biome textures, measured source-artifact suppression.',
  levels: [],
};

for (let z = 0; z <= maxZoom; z++) {
  const scale = 2 ** (maxZoom - z);
  const width = Math.ceil(W / scale);
  const heightPx = Math.ceil(H / scale);
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(heightPx / tileSize);
  const levelDir = path.join(tileRoot, String(z));
  await fs.mkdir(levelDir, { recursive: true });
  const resized = await sharp(sourceImage).resize(width, heightPx, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  for (let tx = 0; tx < cols; tx++) {
    await fs.mkdir(path.join(levelDir, String(tx)), { recursive: true });
    for (let ty = 0; ty < rows; ty++) {
      const left = tx * tileSize;
      const top = ty * tileSize;
      const cropWidth = Math.min(tileSize, width - left);
      const cropHeight = Math.min(tileSize, heightPx - top);
      await sharp(resized)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .extend({ top: 0, left: 0, right: tileSize - cropWidth, bottom: tileSize - cropHeight, background: { r: 15, g: 55, b: 72, alpha: 0 } })
        .webp({ quality: 94 })
        .toFile(path.join(levelDir, String(tx), `${ty}.webp`));
    }
  }
  manifest.levels.push({ z, scale, width, height: heightPx, cols, rows, resolution: scale });
  console.log(`stylized-v2 z${z}: ${width}×${heightPx}, ${cols}×${rows} tiles`);
}
await fs.writeFile(path.join(tileRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${path.join(tileRoot, 'manifest.json')}`);
