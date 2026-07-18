import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const projectRoot = path.resolve(root, '..');
const terrainRoot = path.join(projectRoot, 'terrain-data');
const sourcePath = path.join(root, 'public/assets/worldofmalazan-z6-mosaic.png');
const outDir = path.join(root, 'work/cartography/v2');

const SOURCE_W = 10000;
const SOURCE_H = 5571;
const SCALE = Number(process.env.V2_SCALE ?? 0.5);
const W = Math.round(SOURCE_W * SCALE);
const H = Math.round(SOURCE_H * SCALE);

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function mix(a, b, t) { return a + (b - a) * t; }
function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function fract(n) { return n - Math.floor(n); }
function hash(x, y) { return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123); }
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
function fbm(x, y, oct = 5) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += amp * valueNoise(x * f, y * f); norm += amp; amp *= 0.52; f *= 2.03; }
  return v / norm;
}
function ridgeWave(x, y, angle, freq, warp = 0) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  return 0.5 + 0.5 * Math.sin((x * ca + y * sa) * freq + warp);
}
function at(buf, x, y) {
  return buf[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))] / 255;
}
async function gray(file, kernel = 'lanczos3') {
  const { data } = await sharp(path.join(terrainRoot, file)).resize(W, H, { fit: 'fill', kernel }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
}
async function rgb(file) {
  const { data, info } = await sharp(file).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

await fs.mkdir(outDir, { recursive: true });

console.log(`v2 preview size ${W}x${H} (scale ${SCALE})`);
const [{ data: source, info }, height, mountainHeight, baseHeight, regionalDelta, regionalMult, land, water, mountain, mountainBroad, forest, desert, ice, coastal, micro] = await Promise.all([
  rgb(sourcePath),
  gray('world_height_controlled_16bit.png'),
  gray('world_mountain_height_16bit.png'),
  gray('world_base_height_16bit.png'),
  gray('regional_height_delta_16bit.png'),
  gray('regional_height_multiplier_16bit.png'),
  gray('land_mask.png'),
  gray('water_mask.png'),
  gray('mountain_mask.png'),
  gray('mountain_broad_mask.png'),
  gray('forest_mask.png'),
  gray('desert_mask.png'),
  gray('ice_mask.png'),
  gray('coastal_rise_mask.png'),
  gray('micro_relief.png'),
]);

// Protected ink/label mask: detect existing text, coast/river linework, city rings, red labels.
const ink = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const si = i * info.channels;
  const r = source[si], g = source[si + 1], b = source[si + 2];
  const L = lum(r, g, b);
  const dark = L < 118 && !(b > r + 20 && g > r + 4 && L > 92); // keep most black/brown type/linework
  const blueLine = b > r * 1.16 && b > g * 0.92 && L < 182;
  const redLine = r > 132 && g < 118 && b < 130 && L < 165;
  const x = i % W;
  const y = Math.floor(i / W);
  const inSourceLegendBox = x < Math.round(1700 * SCALE) && y < Math.round(1120 * SCALE);
  const guideBandWidth = Math.max(20, Math.round(45 * SCALE));
  const redGuideLine = redLine && Math.abs(y - Math.round(2785 * SCALE)) < guideBandWidth;
  const sourceGuideArtifact = Math.abs(y - Math.round(2785 * SCALE)) < guideBandWidth && x < Math.round(780 * SCALE);
  if (!inSourceLegendBox && !redGuideLine && !sourceGuideArtifact && (dark || blueLine)) ink[i] = blueLine ? 180 : 220;
}
const halo = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!ink[i]) continue;
    for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
      const d = xx * xx + yy * yy;
      if (d > 9) continue;
      const nx = x + xx, ny = y + yy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) halo[ny * W + nx] = Math.max(halo[ny * W + nx], 132 - d * 11);
    }
  }
}

const out = Buffer.alloc(W * H * 3);
const waterDeep = [12, 49, 68];
const waterMid = [30, 100, 124];
const waterShallow = [82, 164, 166];
const shoreFoam = [190, 226, 203];
const plain = [194, 187, 126];
const grass = [113, 156, 86];
const forestDark = [18, 76, 38];
const forestLight = [58, 133, 58];
const desertWarm = [224, 169, 82];
const ridgeOchre = [211, 126, 59];
const ridgeShadow = [65, 45, 35];
const ridgeLight = [238, 178, 96];
const snow = [234, 238, 224];
const iceBlue = [219, 236, 232];

for (let y = 0; y < H; y++) {
  const yOff = y * W;
  for (let x = 0; x < W; x++) {
    const i = yOff + x;
    const si = i * info.channels;
    const sr = source[si], sg = source[si + 1], sb = source[si + 2];
    const inSourceLegendBox = x < Math.round(1700 * SCALE) && y < Math.round(1120 * SCALE);
    const sourceGuideBand = Math.abs(y - Math.round(2785 * SCALE)) < Math.max(20, Math.round(45 * SCALE));
    const sourceRedGuide = sourceGuideBand && sr > 95 && sg < 155 && sb < 155 && lum(sr, sg, sb) < 200;
    const sourceGuideArtifact = sourceGuideBand && (sourceRedGuide || x < Math.round(780 * SCALE));
    const h = height[i] / 255;
    const mh = mountainHeight[i] / 255;
    const bh = baseHeight[i] / 255;
    const rhd = regionalDelta[i] / 255;
    const rhm = regionalMult[i] / 255;
    let l = land[i] / 255;
    let w = water[i] / 255;
    const m = mountain[i] / 255;
    const mb = mountainBroad[i] / 255;
    const f = forest[i] / 255;
    const d = desert[i] / 255;
    const ic = ice[i] / 255;
    let co = coastal[i] / 255;
    const mic = micro[i] / 255;

    // Known non-map source artifacts live in open ocean; render them as authored ocean,
    // not as source-derived mask/ink/height. This avoids pasted/inpainted repair scars.
    if (inSourceLegendBox || sourceGuideArtifact) {
      l = 0;
      w = 1;
      co = 0;
    }

    // Multi-scale NW hillshade and local ambient occlusion.
    const dx1 = at(height, x + 3, y) - at(height, x - 3, y);
    const dy1 = at(height, x, y + 3) - at(height, x, y - 3);
    const dx2 = at(height, x + 14, y) - at(height, x - 14, y);
    const dy2 = at(height, x, y + 14) - at(height, x, y - 14);
    const dx3 = at(height, x + 42, y) - at(height, x - 42, y);
    const dy3 = at(height, x, y + 42) - at(height, x, y - 42);
    const mdx1 = at(mountainHeight, x + 4, y) - at(mountainHeight, x - 4, y);
    const mdy1 = at(mountainHeight, x, y + 4) - at(mountainHeight, x, y - 4);
    const mdx2 = at(mountainHeight, x + 18, y) - at(mountainHeight, x - 18, y);
    const mdy2 = at(mountainHeight, x, y + 18) - at(mountainHeight, x, y - 18);
    const curvature = Math.abs(at(mountainHeight, x + 5, y) + at(mountainHeight, x - 5, y) + at(mountainHeight, x, y + 5) + at(mountainHeight, x, y - 5) - mh * 4);
    const baseSlope = Math.hypot(at(baseHeight, x + 18, y) - at(baseHeight, x - 18, y), at(baseHeight, x, y + 18) - at(baseHeight, x, y - 18));
    const reliefEnergy = Math.min(1, mh * 0.74 + mb * 0.34 + Math.max(0, rhd - 0.48) * 0.80 + Math.max(0, rhm - 0.44) * 0.42);
    const shadeFine = clamp(0.98 + (-dx1 * 3.9) + (-dy1 * 2.7) + (-mdx1 * 2.5) + (-mdy1 * 1.8), 0.42, 1.74);
    const shadeMed = clamp(1.00 + (-dx2 * 2.9) + (-dy2 * 2.1) + (-mdx2 * 2.6) + (-mdy2 * 1.85), 0.48, 1.66);
    const shadeBroad = clamp(1.00 + (-dx3 * 1.8) + (-dy3 * 1.25), 0.62, 1.42);
    const slope = Math.min(1, Math.hypot(dx1, dy1) * 9.2 + Math.hypot(dx2, dy2) * 3.2 + Math.hypot(mdx1, mdy1) * 5.5 + baseSlope * 2.0);
    const ao = 1 - slope * (0.12 + mb * 0.13 + m * 0.24);

    const paper = fbm(x / 310, y / 310, 5);
    const grain = hash(x, y);
    const terrainNoise = fbm(x / 62, y / 62, 4);
    let col;

    if (w > 0.52 && l < 0.42) {
      // Water is authored as water only — no new fake blue river strokes.
      const depth = smoothstep(0.06, 0.92, 1 - co);
      const current = 0.5 + 0.5 * Math.sin((x * 0.012 + y * 0.007) + fbm(x / 720, y / 720) * 6.2);
      const bathy = 0.5 + 0.5 * Math.sin((x * 0.004 - y * 0.005) + fbm(x / 1100, y / 1100) * 7.0);
      col = mix3(waterShallow, waterMid, 0.50 + depth * 0.31);
      col = mix3(col, waterDeep, depth * 0.42);
      col = mix3(col, [106, 185, 186], current * 0.034 + paper * 0.020 + bathy * 0.016);
      col = mix3(col, [7, 42, 60], depth * bathy * 0.045);
      col = mix3(col, shoreFoam, Math.min(0.36, co * 0.30));
      // keep ice bright but distinct from ocean
      col = mix3(col, iceBlue, ic * 0.86);
      col = col.map(c => c * (0.94 + (grain - 0.5) * 0.018));
    } else {
      const nonSpecial = 1 - Math.max(f, d, m, ic);
      const canopy = fbm(x / 18, y / 18, 4);
      const canopyClumps = smoothstep(0.42, 0.74, canopy + hash(Math.floor(x / 9), Math.floor(y / 9)) * 0.18);
      const duneWarp = fbm(x / 180, y / 180, 4) * 4.5 + h * 3.0;
      const duneA = ridgeWave(x, y, -0.48, 0.034, duneWarp);
      const duneB = ridgeWave(x, y, 0.82, 0.020, duneWarp * 0.7);
      const dune = d * (duneA * 0.68 + duneB * 0.32);
      const iceFacet = ic * (0.5 + 0.5 * Math.sin(x * 0.018 - y * 0.024 + fbm(x / 230, y / 230, 3) * 5.2));
      const plainMottle = nonSpecial * (fbm(x / 140, y / 140, 4) - 0.5);

      col = mix3(plain, grass, 0.28 + h * 0.18 + terrainNoise * 0.12 + plainMottle * 0.14);
      col = mix3(col, [151, 166, 93], nonSpecial * smoothstep(0.48, 0.82, fbm(x / 260, y / 260, 4)) * 0.18);
      col = mix3(col, forestLight, f * (0.34 + canopyClumps * 0.20));
      col = mix3(col, forestDark, f * (0.44 + terrainNoise * 0.18 + canopyClumps * 0.24));
      col = mix3(col, [11, 54, 31], f * canopyClumps * 0.22);
      col = mix3(col, desertWarm, d * 0.78);
      col = mix3(col, [244, 197, 111], dune * 0.20);
      col = mix3(col, [167, 103, 55], d * (1 - duneA) * 0.12);
      col = mix3(col, ridgeOchre, Math.min(0.92, mb * 0.36 + m * 0.62 + reliefEnergy * 0.24));
      col = mix3(col, ridgeLight, reliefEnergy * smoothstep(0.16, 0.76, slope) * Math.max(0, -mdx2 - mdy2 - dx2 * 0.45 - dy2 * 0.45) * 1.08);
      col = mix3(col, ridgeShadow, (m * 0.34 + reliefEnergy * 0.22) * slope);
      col = mix3(col, iceBlue, ic * 0.28);
      col = mix3(col, [247, 247, 232], iceFacet * 0.16);
      col = mix3(col, snow, Math.min(0.96, ic * 0.78 + reliefEnergy * smoothstep(0.56, 0.92, Math.max(h, mh)) * 0.44));
      col = mix3(col, [224, 207, 143], co * 0.16);

      // Biome texture language: forest stipple, desert grain, ridge roughness, plains paper.
      const forestStipple = f * ((hash(Math.floor(x / 3), Math.floor(y / 3)) - 0.5) * 0.13 - canopyClumps * 0.045);
      const desertGrain = d * ((fbm(x / 34, y / 34, 3) - 0.5) * 0.15 + (dune - 0.5) * 0.10);
      const plainPaper = nonSpecial * (fbm(x / 95, y / 95, 3) - 0.5) * 0.075;
      const iceEtch = ic * (iceFacet - 0.5) * 0.055;
      const ridgeRough = (reliefEnergy * 0.40 + mb * 0.08) * (mic - 0.5 + terrainNoise - 0.5);
      const ridgeHatch = reliefEnergy * smoothstep(0.12, 0.62, slope) * (0.5 + 0.5 * Math.sin(x * 0.058 + y * 0.083 + mh * 11.0));
      const topoEngrave = smoothstep(0.030, 0.145, curvature) * reliefEnergy * (0.68 + 0.32 * hash(Math.floor(x / 5), Math.floor(y / 5)));
      const valleyWash = smoothstep(0.10, 0.72, baseSlope) * (1 - reliefEnergy) * (1 - Math.max(f, d, ic)) * 0.075;
      const material = 0.962 + (paper - 0.5) * 0.060 + forestStipple + desertGrain + plainPaper + iceEtch + ridgeRough - ridgeHatch * 0.070 - topoEngrave * 0.105 - valleyWash;
      const shade = Math.pow(shadeFine, 0.32 + reliefEnergy * 0.46) * Math.pow(shadeMed, 0.50 + mb * 0.32 + reliefEnergy * 0.22) * Math.pow(shadeBroad, 0.32) * ao;
      col = col.map(c => c * clamp(shade * material, 0.38, 1.68));

      // Subtle source-height-derived cartographic linework. These are not vector
      // geography; they are low-opacity terrain engravings from the height stack,
      // suppressed beneath labels/halos and inside dense forests/ice so they don't
      // read as fake rivers or clutter.
      const contourBase = clamp(bh * 0.44 + h * 0.34 + mh * 0.24 + (rhd - 0.5) * 0.08 + (rhm - 0.5) * 0.05, 0, 1);
      const contourLevel = contourBase * (20 + reliefEnergy * 11 + d * 3);
      const contourPhase = contourLevel - Math.floor(contourLevel);
      const contourDist = Math.min(contourPhase, 1 - contourPhase);
      const majorPhase = (contourLevel / 4) - Math.floor(contourLevel / 4);
      const majorDist = Math.min(majorPhase, 1 - majorPhase);
      const fWidth = clamp(0.012 + slope * 0.030 + reliefEnergy * 0.010, 0.012, 0.060);
      const minorContour = 1 - smoothstep(fWidth, fWidth * 2.35, contourDist);
      const majorContour = 1 - smoothstep(fWidth * 1.25, fWidth * 3.15, majorDist);
      const contourMask = (1 - Math.max(f * 0.72, ic * 0.85)) * (0.34 + d * 0.23 + nonSpecial * 0.16 + reliefEnergy * 0.18);
      const labelSafe = ink[i] || halo[i] ? 0 : 1;
      const contourStrength = labelSafe * contourMask * (minorContour * 0.075 + majorContour * 0.080) * smoothstep(0.10, 0.86, l);
      if (contourStrength > 0.006) {
        const contourInk = d > 0.18 ? [111, 74, 46] : reliefEnergy > 0.34 ? [64, 43, 32] : [76, 65, 42];
        col = mix3(col, contourInk, Math.min(0.105, contourStrength));
      }
      if (topoEngrave > 0.10) {
        col = mix3(col, [54, 38, 30], Math.min(0.18, topoEngrave * 0.20));
      }
    }

    // Halo first, then original protected ink/labels. This is the important readability layer.
    if (halo[i] && !ink[i]) {
      const ht = halo[i] / 255;
      const haloCol = w > 0.52 ? [205, 226, 217] : [239, 229, 194];
      col = mix3(col, haloCol, ht * 0.42);
    }
    if (ink[i]) {
      const L = lum(sr, sg, sb);
      const blueInk = sb > sr * 1.16 && sb > sg * 0.92 && L < 182;
      const redInk = sr > 132 && sg < 118 && sb < 130 && L < 165;
      const inkCol = blueInk ? [30, 73, 150] : redInk ? [137, 48, 44] : [38, 33, 29];
      col = mix3(col, inkCol, blueInk ? 0.76 : redInk ? 0.68 : 0.82);
      // Preserve some original anti-aliasing / type character.
      col = mix3(col, [sr, sg, sb], blueInk ? 0.16 : 0.10);
    } else if (!inSourceLegendBox && !sourceGuideArtifact && !(w > 0.52 && l < 0.42)) {
      // Very light source blend only on land, to keep exact coast/labels context without source-map look.
      // Open water is generated from masks/procedural texture so source artifacts cannot leak through.
      col = mix3(col, [sr, sg, sb], 0.018);
    }

    // Warm atlas grade.
    col = mix3(col, [255, 237, 199], 0.025);
    const oi = i * 3;
    out[oi] = clamp(col[0]); out[oi + 1] = clamp(col[1]); out[oi + 2] = clamp(col[2]);
  }
  if (y % 350 === 0) console.log(`v2 rows ${y}/${H}`);
}

const fullPath = path.join(outDir, 'stylized-relief-v2-preview.png');
await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(fullPath);
console.log(`wrote ${fullPath}`);

const crops = [
  { name: 'lake-azur-darujhistan', x: 6100, y: 880, w: 1900, h: 1350 },
  { name: 'seven-cities-jhag-odhan', x: 2500, y: 2450, w: 2400, h: 1500 },
  { name: 'jacuruku-stratem', x: 4400, y: 3100, w: 2500, h: 1500 },
  { name: 'falar-quip-tali', x: 3000, y: 400, w: 2500, h: 1550 },
];
const cropFiles = [];
for (const c of crops) {
  const left = Math.round(c.x * SCALE), top = Math.round(c.y * SCALE), width = Math.round(c.w * SCALE), height = Math.round(c.h * SCALE);
  const out = path.join(outDir, `${c.name}.png`);
  await sharp(fullPath).extract({ left, top, width, height }).resize({ width: 1200 }).png().toFile(out);
  cropFiles.push(out);
  console.log(`wrote crop ${out}`);
}

const preview = path.join(outDir, 'world-preview-1800.png');
await sharp(fullPath).resize({ width: 1800 }).png().toFile(preview);
console.log(`wrote ${preview}`);

const contact = path.join(outDir, 'v2-contact-sheet.jpg');
const thumbs = await Promise.all([preview, ...cropFiles].map(async file => sharp(file).resize(900, 520, { fit: 'inside', background: '#101615' }).extend({ top: 20, bottom: 20, left: 20, right: 20, background: '#101615' }).jpeg({ quality: 92 }).toBuffer()));
await sharp({ create: { width: 1880, height: 1680, channels: 3, background: '#101615' } })
  .composite(thumbs.map((input, idx) => ({ input, left: (idx % 2) * 940, top: Math.floor(idx / 2) * 560 })))
  .jpeg({ quality: 92 })
  .toFile(contact);
console.log(`wrote ${contact}`);
