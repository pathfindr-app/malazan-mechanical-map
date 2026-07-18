from PIL import Image
from pathlib import Path
from collections import deque
import json
import numpy as np

ROOT = Path('/root/kyle/projects/malazan-mechanical-map/atlas-web')
MASK = ROOT/'../terrain-data/land_mask.png'
OUT = ROOT/'public/data/coastline-features.json'
SOURCE_W, SOURCE_H = 10000, 5571
THRESHOLD = 128
MIN_PIXELS = 350
MAX_FEATURES = 80
MAX_POINTS_PER_FEATURE = 900

im = Image.open(MASK).convert('L')
arr = np.asarray(im)
H, W = arr.shape
land = arr > THRESHOLD
seen = np.zeros((H, W), dtype=bool)

def to_source(x, y):
    return [round(x / (W - 1) * SOURCE_W), round(y / (H - 1) * SOURCE_H)]

features = []
for y0 in range(H):
    for x0 in range(W):
        if seen[y0, x0] or not land[y0, x0]:
            continue
        q = deque([(x0, y0)]); seen[y0, x0] = True
        pixels = []; minx = maxx = x0; miny = maxy = y0; touches_edge = False
        while q:
            x, y = q.popleft(); pixels.append((x, y))
            if x == 0 or y == 0 or x == W - 1 or y == H - 1:
                touches_edge = True
            minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H and not seen[ny, nx] and land[ny, nx]:
                    seen[ny, nx] = True; q.append((nx, ny))
        if len(pixels) < MIN_PIXELS:
            continue
        s = set(pixels)
        boundary = []
        for x, y in pixels:
            if x == 0 or y == 0 or x == W - 1 or y == H - 1 or any((nx, ny) not in s for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                boundary.append((x, y))
        if len(boundary) < 8:
            continue
        # Keep deterministic spatially distributed samples, not ordered polylines, to avoid fake chord lines.
        step = max(1, len(boundary) // MAX_POINTS_PER_FEATURE)
        sampled = boundary[::step]
        if len(sampled) > MAX_POINTS_PER_FEATURE:
            sampled = sampled[:MAX_POINTS_PER_FEATURE]
        pts = [to_source(x, y) for x, y in sampled]
        features.append({
            'id': f'coastline_{len(features)+1:03d}',
            'name': f'Source-derived shoreline samples {len(features)+1}',
            'type': 'shoreline-samples',
            'status': 'source-mask-derived',
            'source': 'terrain-data/land_mask.png',
            'threshold': THRESHOLD,
            'maskPixels': len(pixels),
            'boundaryPixels': len(boundary),
            'pointCount': len(pts),
            'touchesMaskEdge': touches_edge,
            'bbox_px': [to_source(minx, miny), to_source(maxx, maxy)],
            'center_px': to_source(sum(x for x, y in pixels) / len(pixels), sum(y for x, y in pixels) / len(pixels)),
            'points_px': pts,
        })

features.sort(key=lambda f: -f['maskPixels'])
features = features[:MAX_FEATURES]
for i, f in enumerate(features, 1):
    f['id'] = f'coastline_{i:03d}'
    f['name'] = f'Source-derived shoreline samples {i}'

payload = {
    'coordinateSpace': 'malazan.source-pixel',
    'sourcePixels': [SOURCE_W, SOURCE_H],
    'sourceMask': 'terrain-data/land_mask.png',
    'maskPixels': [W, H],
    'status': 'source-mask-derived',
    'method': 'connected-component-boundary-samples',
    'featureCount': len(features),
    'features': features,
    'notes': 'Sampled shoreline boundary points extracted from terrain-data/land_mask.png. This intentionally avoids drawing ordered polylines until a robust contour stitcher is available, preventing false chord lines across ocean.',
}
OUT.write_text(json.dumps(payload, indent=2) + '\n')
print('wrote', OUT)
print('features', len(features))
for f in features[:10]:
    print(f['id'], f['maskPixels'], 'boundary', f['boundaryPixels'], 'points', f['pointCount'], f['bbox_px'])
