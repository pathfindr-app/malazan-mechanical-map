import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const projectRoot = path.resolve(root, '..');
const terrainRoot = path.join(projectRoot, 'terrain-data');
const sourcePath = path.join(root, 'public/assets/worldofmalazan-z6-mosaic.png');
const outFull = path.join(root, 'work/cartography/generated/premium-relief-atlas.png');
const tileRoot = path.join(root, 'public/tiles/premium-relief');
const tileSize = 512;
const maxZoom = 6;
const W = 10000;
const H = 5571;

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function mix(a, b, t) { return a + (b - a) * t; }
function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function fract(n) { return n - Math.floor(n); }
function noise2(x, y) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123); }
function fbm(x, y) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { v += amp * noise2(x * f, y * f); amp *= 0.5; f *= 2.04; }
  return v;
}
async function resizeGray(file) {
  const { data } = await sharp(path.join(terrainRoot, file))
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

await fs.mkdir(path.dirname(outFull), { recursive: true });
await fs.rm(tileRoot, { recursive: true, force: true });
await fs.mkdir(tileRoot, { recursive: true });

const [{ data: source, info }, height, land, water, mountain, mountainBroad, forest, desert, ice, coastal, micro] = await Promise.all([
  sharp(sourcePath).raw().toBuffer({ resolveWithObject: true }),
  resizeGray('world_height_controlled_16bit.png'),
  resizeGray('land_mask.png'),
  resizeGray('water_mask.png'),
  resizeGray('mountain_mask.png'),
  resizeGray('mountain_broad_mask.png'),
  resizeGray('forest_mask.png'),
  resizeGray('desert_mask.png'),
  resizeGray('ice_mask.png'),
  resizeGray('coastal_rise_mask.png'),
  resizeGray('micro_relief.png'),
]);

const out = Buffer.alloc(W * H * 3);
const waterDeep = [31, 91, 116];
const waterShallow = [89, 166, 184];
const waterFoam = [186, 231, 221];
const plains = [177, 172, 122];
const grass = [105, 154, 82];
const forestCol = [31, 103, 52];
const desertCol = [206, 157, 77];
const mountainCol = [166, 105, 62];
const snowCol = [232, 240, 229];

for (let y = 0; y < H; y++) {
  const yOff = y * W;
  for (let x = 0; x < W; x++) {
    const i = yOff + x;
    const si = i * info.channels;
    const sr = source[si], sg = source[si + 1], sb = source[si + 2];
    const h = height[i] / 255;
    const l = land[i] / 255;
    const w = water[i] / 255;
    const m = mountain[i] / 255;
    const mb = mountainBroad[i] / 255;
    const f = forest[i] / 255;
    const d = desert[i] / 255;
    const ic = ice[i] / 255;
    const co = coastal[i] / 255;
    const mic = micro[i] / 255;
    const left = height[yOff + Math.max(0, x - 10)] / 255;
    const right = height[yOff + Math.min(W - 1, x + 10)] / 255;
    const up = height[Math.max(0, y - 10) * W + x] / 255;
    const down = height[Math.min(H - 1, y + 10) * W + x] / 255;
    const dx = right - left;
    const dy = down - up;
    const hill = clamp(214 + (-dx * 780) + (-dy * 520), 126, 255) / 218;
    const n = fbm(x / 900, y / 900);
    const fine = fbm(x / 190, y / 190);
    let col;
    if (w > 0.50 && l < 0.45) {
      const depth = smoothstep(0.15, 0.94, 1 - co);
      const wave = 0.5 + 0.5 * Math.sin((x * 0.021 + y * 0.014) + n * 4.5);
      col = mix3(waterShallow, waterDeep, 0.52 + depth * 0.34);
      col = mix3(col, [126, 205, 210], wave * 0.045 + fine * 0.025);
      col = mix3(col, waterFoam, co * 0.16);
    } else {
      col = mix3(plains, grass, 0.35 + h * 0.25);
      col = mix3(col, forestCol, Math.min(0.75, f * 0.82));
      col = mix3(col, desertCol, Math.min(0.78, d * 0.84));
      col = mix3(col, mountainCol, Math.min(0.86, mb * 0.32 + m * 0.74));
      col = mix3(col, snowCol, Math.min(0.95, ic * 0.94 + m * smoothstep(0.48, 0.95, h) * 0.46));
      col = mix3(col, [221, 205, 139], co * 0.14);
      const material = 0.94 + (fine - 0.5) * 0.08 + (mic - 0.5) * 0.11;
      col = col.map(c => c * hill * material);
    }

    // Let source labels, roads, coastlines, and authored river strokes survive at zoom.
    const L = lum(sr, sg, sb);
    const blueInk = sb > sr * 1.14 && sb > sg * 0.90 && L < 190;
    const redInk = sr > 135 && sg < 110 && sb < 125 && L < 160;
    const darkInk = L < 116;
    if (darkInk || blueInk || redInk) {
      const ink = blueInk ? [36, 77, 139] : redInk ? [145, 52, 48] : [36, 32, 29];
      col = mix3(col, ink, blueInk ? 0.50 : redInk ? 0.48 : 0.62);
    } else {
      // Mildly keep original detail so labels don't vanish into posterization.
      col = mix3(col, [sr, sg, sb], 0.10);
    }

    // Premium warm grade without making the ocean black.
    col = mix3(col, [255, 235, 190], 0.04);
    const oi = i * 3;
    out[oi] = clamp(col[0]); out[oi + 1] = clamp(col[1]); out[oi + 2] = clamp(col[2]);
  }
  if (y % 700 === 0) console.log(`styled rows ${y}/${H}`);
}

await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(outFull);
console.log(`wrote ${outFull}`);

const manifest = {
  name: 'malazan-premium-relief-pyramid',
  sourceImage: 'premium-relief-atlas.png',
  sourcePixels: [W, H],
  tileSize,
  maxZoom,
  format: 'webp',
  quality: 93,
  origin: 'top-left',
  coordinateSpace: 'malazan.source-pixel',
  inputs: ['world_height_controlled_16bit.png','land_mask.png','water_mask.png','mountain_mask.png','forest_mask.png','desert_mask.png','ice_mask.png','micro_relief.png','worldofmalazan-z6-mosaic.png'],
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
  const resized = await sharp(outFull).resize(width, heightPx, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  for (let tx = 0; tx < cols; tx++) {
    await fs.mkdir(path.join(levelDir, String(tx)), { recursive: true });
    for (let ty = 0; ty < rows; ty++) {
      const left = tx * tileSize, top = ty * tileSize;
      const cropWidth = Math.min(tileSize, width - left), cropHeight = Math.min(tileSize, heightPx - top);
      await sharp(resized)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .extend({ top: 0, left: 0, right: tileSize - cropWidth, bottom: tileSize - cropHeight, background: { r: 31, g: 91, b: 116, alpha: 0 } })
        .webp({ quality: 93 })
        .toFile(path.join(levelDir, String(tx), `${ty}.webp`));
    }
  }
  manifest.levels.push({ z, scale, width, height: heightPx, cols, rows, resolution: scale });
  console.log(`premium z${z}: ${width}×${heightPx}, ${cols}×${rows} tiles`);
}
await fs.writeFile(path.join(tileRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${path.join(tileRoot, 'manifest.json')}`);
