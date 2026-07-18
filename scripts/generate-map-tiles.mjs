import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const input = path.join(root, 'public/assets/worldofmalazan-z6-mosaic.png');
const outRoot = path.join(root, 'public/tiles/source');
const tileSize = 512;
const maxZoom = 5;
const sourceWidth = 10000;
const sourceHeight = 5571;
const quality = Number(process.env.TILE_WEBP_QUALITY ?? 88);

async function ensureEmpty(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

if (!(await exists(input))) {
  throw new Error(`Missing source image: ${input}`);
}

await ensureEmpty(outRoot);

const manifest = {
  name: 'worldofmalazan-z6-source-pyramid',
  sourceImage: 'worldofmalazan-z6-mosaic.png',
  sourcePixels: [sourceWidth, sourceHeight],
  tileSize,
  maxZoom,
  format: 'webp',
  quality,
  origin: 'top-left',
  coordinateSpace: 'malazan.source-pixel',
  levels: [],
};

for (let z = 0; z <= maxZoom; z += 1) {
  const scale = 2 ** (maxZoom - z);
  const width = Math.ceil(sourceWidth / scale);
  const height = Math.ceil(sourceHeight / scale);
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const levelDir = path.join(outRoot, String(z));
  await fs.mkdir(levelDir, { recursive: true });

  const resizedBuffer = await sharp(input)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  for (let x = 0; x < cols; x += 1) {
    const colDir = path.join(levelDir, String(x));
    await fs.mkdir(colDir, { recursive: true });
    for (let y = 0; y < rows; y += 1) {
      const left = x * tileSize;
      const top = y * tileSize;
      const cropWidth = Math.min(tileSize, width - left);
      const cropHeight = Math.min(tileSize, height - top);
      await sharp(resizedBuffer)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .extend({
          top: 0,
          left: 0,
          right: tileSize - cropWidth,
          bottom: tileSize - cropHeight,
          background: { r: 244, g: 230, b: 194, alpha: 0 },
        })
        .webp({ quality })
        .toFile(path.join(colDir, `${y}.webp`));
    }
  }
  manifest.levels.push({ z, scale, width, height, cols, rows, resolution: scale });
  console.log(`z${z}: ${width}×${height}, ${cols}×${rows} tiles`);
}

await fs.writeFile(path.join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${path.join(outRoot, 'manifest.json')}`);
