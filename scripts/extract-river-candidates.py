from PIL import Image, ImageDraw
from pathlib import Path
from collections import deque
import json, math
import numpy as np

ROOT = Path('/root/kyle/projects/malazan-mechanical-map/atlas-web')
PROJECT = ROOT.parent
SOURCE = ROOT/'public/assets/worldofmalazan-z6-mosaic.png'
TERRAIN = PROJECT/'terrain-data'
OUT = ROOT/'public/data/river-candidates.json'
QA_DIR = ROOT/'work/cartography/river-candidates'
SOURCE_W, SOURCE_H = 10000, 5571
SCALE = 0.5
W, H = round(SOURCE_W * SCALE), round(SOURCE_H * SCALE)
MIN_PIXELS = 8
MAX_FEATURES = 650
LAKE_AZUR_GUARD = (6200, 1200, 7200, 1900)

QA_DIR.mkdir(parents=True, exist_ok=True)

full_img = Image.open(SOURCE).convert('RGB')
src_img = full_img.resize((W, H), Image.Resampling.LANCZOS)
src = np.asarray(src_img)

def to_source_point(x, y):
    return [round(x / (W - 1) * SOURCE_W), round(y / (H - 1) * SOURCE_H)]

def gray_mask(name):
    return np.asarray(Image.open(TERRAIN/name).convert('L').resize((W, H), Image.Resampling.BILINEAR)) / 255.0

land = gray_mask('land_mask.png')
water = gray_mask('water_mask.png')
coast = gray_mask('coastal_rise_mask.png')

r = src[:, :, 0].astype(np.float32)
g = src[:, :, 1].astype(np.float32)
b = src[:, :, 2].astype(np.float32)
L = 0.2126 * r + 0.7152 * g + 0.0722 * b
blue_ink = (b > r * 1.13) & (b > g * 0.88) & (b - r > 16) & (L < 196) & (L > 42)
not_open_ocean = (land > 0.25) | ((coast > 0.15) & (water < 0.90))
mask = blue_ink & not_open_ocean
Y, X = np.indices((H, W))
mask[(X < round(1700 * SCALE)) & (Y < round(1120 * SCALE))] = False
mask[np.abs(Y - round(2785 * SCALE)) < round(14 * SCALE)] = False

seen = np.zeros((H, W), dtype=bool)
features = []

def component_points(x0, y0):
    q = deque([(x0, y0)])
    seen[y0, x0] = True
    pts = []
    minx = maxx = x0
    miny = maxy = y0
    while q:
        x, y = q.popleft(); pts.append((x, y))
        minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1),(x+1,y+1),(x-1,y-1),(x+1,y-1),(x-1,y+1)):
            if 0 <= nx < W and 0 <= ny < H and not seen[ny, nx] and mask[ny, nx]:
                seen[ny, nx] = True; q.append((nx, ny))
    return pts, (minx, miny, maxx, maxy)

def rdp(points, eps):
    if len(points) < 3: return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx = x2 - x1; dy = y2 - y1
    denom = math.hypot(dx, dy) or 1
    best_i = 0; best_d = -1
    for i, (x, y) in enumerate(points[1:-1], 1):
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / denom
        if d > best_d: best_d = d; best_i = i
    if best_d > eps:
        return rdp(points[:best_i + 1], eps)[:-1] + rdp(points[best_i:], eps)
    return [points[0], points[-1]]

def ordered_path(pts):
    # Candidate display only. Sort by dominant axis to avoid implying verified hydrograph topology.
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if (max(xs) - min(xs)) >= (max(ys) - min(ys)):
        ordered = sorted(pts, key=lambda p: (p[0], p[1]))
    else:
        ordered = sorted(pts, key=lambda p: (p[1], p[0]))
    step = max(1, len(ordered) // 120)
    sampled = ordered[::step]
    return rdp(sampled, 2.0)

def overlaps_guard(bbox_source):
    ax0, ay0 = bbox_source[0]; ax1, ay1 = bbox_source[1]
    bx0, by0, bx1, by1 = LAKE_AZUR_GUARD
    return ax0 <= bx1 and ax1 >= bx0 and ay0 <= by1 and ay1 >= by0

for y in range(H):
    candidates = np.where(mask[y] & ~seen[y])[0]
    for x in candidates:
        if seen[y, x] or not mask[y, x]:
            continue
        pts, bbox = component_points(int(x), int(y))
        if len(pts) < MIN_PIXELS:
            continue
        minx, miny, maxx, maxy = bbox
        bw = maxx - minx + 1; bh = maxy - miny + 1
        long_side = max(bw, bh); short_side = max(1, min(bw, bh))
        linearity = long_side / short_side
        if long_side < 8 and linearity < 2.0:
            continue
        if len(pts) < 16 and linearity < 1.8:
            continue
        path = ordered_path(pts)
        if len(path) < 2:
            continue
        bbox_source = [to_source_point(minx, miny), to_source_point(maxx, maxy)]
        center = to_source_point(sum(px for px, py in pts) / len(pts), sum(py for px, py in pts) / len(pts))
        in_guard = overlaps_guard(bbox_source)
        features.append({
            'id': f'river_candidate_{len(features)+1:04d}',
            'name': f'Unverified source-blue hydrography candidate {len(features)+1}',
            'type': 'river-candidate',
            'status': 'unverified-source-blue-ink',
            'source': 'public/assets/worldofmalazan-z6-mosaic.png + terrain-data land/water/coastal masks',
            'certainty': 'candidate-only; not shipped as verified geography',
            'sampleScale': SCALE,
            'pixelsAtSampleScale': len(pts),
            'bbox_px': bbox_source,
            'center_px': center,
            'linearity': round(linearity, 2),
            'touchesLakeAzurGuard': in_guard,
            'points_px': [to_source_point(px, py) for px, py in path],
        })

features.sort(key=lambda f: -f['pixelsAtSampleScale'])
features = features[:MAX_FEATURES]
for i, f in enumerate(features, 1):
    f['id'] = f'river_candidate_{i:04d}'
    if f['touchesLakeAzurGuard']:
        f['blockedReason'] = 'Intersects Lake Azur/Darujhistan guard zone; cannot be promoted without manual source review.'

payload = {
    'coordinateSpace': 'malazan.source-pixel',
    'sourcePixels': [SOURCE_W, SOURCE_H],
    'samplePixels': [W, H],
    'status': 'unverified-candidates-only',
    'method': 'half-resolution-source-blue-ink-components-with-land-water-mask-filter',
    'featureCount': len(features),
    'lakeAzurGuardPx': list(LAKE_AZUR_GUARD),
    'lakeAzurGuardCandidateCount': sum(1 for f in features if f['touchesLakeAzurGuard']),
    'features': features,
    'notes': 'Automated blue-ink extraction proof for source-authored hydrography. These candidates are deliberately not rendered as verified rivers. Guard-zone candidates near Lake Azur are blocked from promotion to prevent repeating the prior fake-river failure.',
}
OUT.write_text(json.dumps(payload, indent=2) + '\n')

def draw_overlay(base, candidates, out_path, crop=None):
    if crop:
        img = base.crop(crop).convert('RGBA')
        ox, oy = crop[0], crop[1]
        scale = 1
    else:
        img = base.resize((1800, round(base.height * 1800 / base.width))).convert('RGBA')
        ox, oy = 0, 0
        scale = img.width / base.width
    draw = ImageDraw.Draw(img, 'RGBA')
    for f in candidates:
        pts = []
        for px, py in f['points_px']:
            if crop and not (crop[0] <= px <= crop[2] and crop[1] <= py <= crop[3]):
                continue
            pts.append((round((px - ox) * scale), round((py - oy) * scale)))
        if len(pts) >= 2:
            color = (255, 40, 40, 220) if f.get('touchesLakeAzurGuard') else (0, 220, 255, 190)
            draw.line(pts, fill=color, width=3 if crop else 1)
    img.save(out_path)

draw_overlay(full_img, features, QA_DIR/'river-candidates-world-overlay.png')
draw_overlay(full_img, features, QA_DIR/'lake-azur-guard-overlay.png', crop=LAKE_AZUR_GUARD)
print('wrote', OUT)
print('features', len(features), 'lakeAzurGuardCandidateCount', payload['lakeAzurGuardCandidateCount'])
print('qa', QA_DIR/'river-candidates-world-overlay.png')
print('qa', QA_DIR/'lake-azur-guard-overlay.png')
