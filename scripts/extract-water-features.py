from PIL import Image
from pathlib import Path
from collections import deque
import json, math
import numpy as np

ROOT = Path('/root/kyle/projects/malazan-mechanical-map/atlas-web')
MASK = ROOT/'../terrain-data/water_mask.png'
OUT = ROOT/'public/data/water-features.json'
SOURCE_W, SOURCE_H = 10000, 5571
MIN_PIXELS = 12
MAX_FEATURES = 200

im = Image.open(MASK).convert('L')
arr = np.asarray(im)
H, W = arr.shape
water = arr > 128
seen = np.zeros((H,W), dtype=bool)

def to_source(x, y):
    return [round(x / (W-1) * SOURCE_W), round(y / (H-1) * SOURCE_H)]

def rdp(points, eps):
    if len(points) < 3: return points
    (x1,y1),(x2,y2)=points[0],points[-1]
    dx=x2-x1; dy=y2-y1
    denom=math.hypot(dx,dy) or 1
    best_i=0; best_d=-1
    for i,(x,y) in enumerate(points[1:-1],1):
        d=abs(dy*x - dx*y + x2*y1 - y2*x1)/denom
        if d>best_d: best_d=d; best_i=i
    if best_d > eps:
        left=rdp(points[:best_i+1], eps)
        right=rdp(points[best_i:], eps)
        return left[:-1]+right
    return [points[0], points[-1]]

def convex_hull(points):
    pts = sorted(set(points))
    if len(pts) <= 1:
        return pts
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lower=[]
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper=[]
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

def radial_polygon(boundary, cx, cy, bins=144):
    hull = convex_hull(boundary)
    if len(hull) < 3:
        return []
    # Keep compact lakes accurate enough for overlay while avoiding hundreds of pixels.
    hull.append(hull[0])
    pts = rdp(hull, 1.0)
    if len(pts) < 4:
        pts = hull
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return [to_source(x,y) for x,y in pts]

features=[]
lake_mask_xy=(round(6770/SOURCE_W*(W-1)), round(1490/SOURCE_H*(H-1)))
lake_component=None
for y0 in range(H):
    for x0 in range(W):
        if seen[y0,x0] or not water[y0,x0]:
            continue
        q=deque([(x0,y0)]); seen[y0,x0]=True
        pixels=[]; touches_edge=False
        minx=maxx=x0; miny=maxy=y0
        while q:
            x,y=q.popleft(); pixels.append((x,y))
            if x==0 or y==0 or x==W-1 or y==H-1: touches_edge=True
            if x<minx: minx=x
            if x>maxx: maxx=x
            if y<miny: miny=y
            if y>maxy: maxy=y
            for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                if 0<=nx<W and 0<=ny<H and (not seen[ny,nx]) and water[ny,nx]:
                    seen[ny,nx]=True; q.append((nx,ny))
        if len(pixels) < MIN_PIXELS:
            continue
        # Exclude ocean/edge water; these are not inland water feature polygons.
        if touches_edge:
            continue
        s=set(pixels)
        boundary=[]
        for x,y in pixels:
            if x==0 or y==0 or x==W-1 or y==H-1 or any((nx,ny) not in s for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1))):
                boundary.append((x,y))
        cx=sum(x for x,y in pixels)/len(pixels); cy=sum(y for x,y in pixels)/len(pixels)
        poly=radial_polygon(boundary, cx, cy)
        if len(poly) < 4:
            continue
        source_bbox=[to_source(minx,miny), to_source(maxx,maxy)]
        center=to_source(cx,cy)
        contains_lake = any(abs(x-lake_mask_xy[0])<=1 and abs(y-lake_mask_xy[1])<=1 for x,y in pixels)
        feature={
            'id': 'water_lake_azur' if contains_lake else f'water_component_{len(features)+1:03d}',
            'name': 'Lake Azur' if contains_lake else f'Inland water component {len(features)+1}',
            'type': 'lake' if contains_lake or len(pixels)>80 else 'pond',
            'status': 'source-mask-derived',
            'source': 'terrain-data/water_mask.png',
            'maskPixels': len(pixels),
            'sourceAreaApproxPx': round(len(pixels) * (SOURCE_W/(W-1)) * (SOURCE_H/(H-1))),
            'bbox_px': [source_bbox[0], source_bbox[1]],
            'center_px': center,
            'points_px': poly,
        }
        if contains_lake:
            lake_component=feature
        features.append(feature)

features.sort(key=lambda f: (f['id']!='water_lake_azur', -f['maskPixels']))
features=features[:MAX_FEATURES]
payload={
    'coordinateSpace':'malazan.source-pixel',
    'sourcePixels':[SOURCE_W,SOURCE_H],
    'sourceMask':'terrain-data/water_mask.png',
    'maskPixels':[W,H],
    'status':'source-mask-derived',
    'features':features,
    'featureCount':len(features),
    'notes':'Inland water polygons extracted from the existing water mask. Ocean/edge-connected water excluded; polygons are generalized from component boundaries for atlas overlays/QA.',
}
OUT.write_text(json.dumps(payload, indent=2)+'\n')
print('wrote', OUT)
print('features', len(features))
print('lake_azur', lake_component and {k:lake_component[k] for k in ['id','maskPixels','bbox_px','center_px','sourceAreaApproxPx']})
