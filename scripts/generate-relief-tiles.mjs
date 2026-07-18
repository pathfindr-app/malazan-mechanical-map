import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const input = path.join(root, 'public/assets/worldofmalazan-z6-mosaic.png');
const reliefPng = path.join(root, 'work/cartography/generated/stylized-relief.png');
const tileRoot = path.join(root, 'public/tiles/relief');
const tileSize = 512;
const maxZoom = 5;
const sourceWidth = 10000;
const sourceHeight = 5571;

async function ensureEmpty(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}
function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, v)); }
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function mix(a, b, t) { return a + (b - a) * t; }
function terrainPalette(r, g, b) {
  const [h, s, v] = rgbToHsv(r, g, b);
  const water = (h > 0.47 && h < 0.66 && s > 0.13) || (b > r * 1.12 && b > g * 0.98);
  const forest = h > 0.20 && h < 0.43 && s > 0.16 && g > r * 0.82;
  const mountain = v < 0.62 && s < 0.25;
  const desert = h > 0.08 && h < 0.18 && s > 0.16 && r > b * 1.1;
  if (water) return [mix(r, 65, 0.38), mix(g, 145, 0.32), mix(b, 195, 0.28), -0.18];
  if (forest) return [mix(r, 72, 0.24), mix(g, 128, 0.22), mix(b, 66, 0.18), 0.16 + s * 0.08];
  if (mountain) return [mix(r, 142, 0.16), mix(g, 122, 0.14), mix(b, 96, 0.12), 0.34 + (1 - v) * 0.35];
  if (desert) return [mix(r, 216, 0.20), mix(g, 172, 0.18), mix(b, 92, 0.12), 0.10 + s * 0.08];
  return [mix(r, 183, 0.12), mix(g, 166, 0.10), mix(b, 108, 0.08), 0.08 + s * 0.05 + (1 - v) * 0.08];
}

await fs.mkdir(path.dirname(reliefPng), { recursive: true });
const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(data.length);
const height = new Float32Array(sourceWidth * sourceHeight);

for (let y = 0; y < sourceHeight; y += 1) {
  for (let x = 0; x < sourceWidth; x += 1) {
    const i = (y * sourceWidth + x) * info.channels;
    const [rr, gg, bb, hh] = terrainPalette(data[i], data[i + 1], data[i + 2]);
    height[y * sourceWidth + x] = hh;
    out[i] = rr; out[i + 1] = gg; out[i + 2] = bb;
  }
}

// Cheap shaded relief from the synthetic height field. Use a wider sample so it reads at atlas scale.
for (let y = 0; y < sourceHeight; y += 1) {
  for (let x = 0; x < sourceWidth; x += 1) {
    const idx = y * sourceWidth + x;
    const xl = Math.max(0, x - 6), xr = Math.min(sourceWidth - 1, x + 6);
    const yu = Math.max(0, y - 6), yd = Math.min(sourceHeight - 1, y + 6);
    const dx = height[y * sourceWidth + xr] - height[y * sourceWidth + xl];
    const dy = height[yd * sourceWidth + x] - height[yu * sourceWidth + x];
    const shade = clamp(224 + (-dx * 720) + (-dy * 420), 152, 255) / 224;
    const i = idx * info.channels;
    // Preserve cartographic detail by blending relief with original linework/labels.
    const ink = Math.min(data[i], data[i+1], data[i+2]);
    const lineBoost = ink < 90 ? 0.72 : ink < 145 ? 0.86 : 1;
    out[i] = clamp(out[i] * shade * lineBoost);
    out[i + 1] = clamp(out[i + 1] * shade * lineBoost);
    out[i + 2] = clamp(out[i + 2] * shade * lineBoost);
  }
}

await sharp(out, { raw: { width: sourceWidth, height: sourceHeight, channels: info.channels } }).png().toFile(reliefPng);
console.log(`wrote ${reliefPng}`);

await ensureEmpty(tileRoot);
const manifest = {
  name: 'worldofmalazan-stylized-relief-pyramid',
  sourceImage: 'stylized-relief.png',
  sourcePixels: [sourceWidth, sourceHeight],
  tileSize,
  maxZoom,
  format: 'webp',
  quality: 88,
  origin: 'top-left',
  coordinateSpace: 'malazan.source-pixel',
  levels: [],
};

for (let z = 0; z <= maxZoom; z += 1) {
  const scale = 2 ** (maxZoom - z);
  const width = Math.ceil(sourceWidth / scale);
  const heightPx = Math.ceil(sourceHeight / scale);
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(heightPx / tileSize);
  const levelDir = path.join(tileRoot, String(z));
  await fs.mkdir(levelDir, { recursive: true });
  const resizedBuffer = await sharp(reliefPng).resize(width, heightPx, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  for (let x = 0; x < cols; x += 1) {
    const colDir = path.join(levelDir, String(x));
    await fs.mkdir(colDir, { recursive: true });
    for (let y = 0; y < rows; y += 1) {
      const left = x * tileSize, top = y * tileSize;
      const cropWidth = Math.min(tileSize, width - left), cropHeight = Math.min(tileSize, heightPx - top);
      await sharp(resizedBuffer)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .extend({ top: 0, left: 0, right: tileSize - cropWidth, bottom: tileSize - cropHeight, background: { r: 244, g: 230, b: 194, alpha: 0 } })
        .webp({ quality: 88 })
        .toFile(path.join(colDir, `${y}.webp`));
    }
  }
  manifest.levels.push({ z, scale, width, height: heightPx, cols, rows, resolution: scale });
  console.log(`relief z${z}: ${width}×${heightPx}, ${cols}×${rows} tiles`);
}
await fs.writeFile(path.join(tileRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${path.join(tileRoot, 'manifest.json')}`);
