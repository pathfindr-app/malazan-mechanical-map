from PIL import Image
from pathlib import Path
from collections import deque
import json, math
import numpy as np

ROOT = Path('/root/kyle/projects/malazan-mechanical-map/atlas-web')
TERRAIN = ROOT/'../terrain-data'
OUT = ROOT/'public/data/terrain-features.json'
SOURCE_W, SOURCE_H = 10000, 5571
MAX_FEATURES_PER_KIND = 40

SPECS = [
    {'kind':'forest','mask':'forest_mask.png','threshold':64,'minPixels':45,'label':'Forest massif'},
    {'kind':'desert','mask':'desert_mask.png','threshold':64,'minPixels':80,'label':'Desert zone'},
    {'kind':'ice','mask':'ice_mask.png','threshold':96,'minPixels':180,'label':'Ice field'},
    {'kind':'mountain','mask':'mountain_broad_mask.png','threshold':80,'minPixels':90,'label':'Mountain system'},
]

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
        return rdp(points[:best_i+1], eps)[:-1] + rdp(points[best_i:], eps)
    return [points[0], points[-1]]

def convex_hull(points):
    pts=sorted(set(points))
    if len(pts)<=1: return pts
    def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower=[]
    for p in pts:
        while len(lower)>=2 and cross(lower[-2],lower[-1],p)<=0: lower.pop()
        lower.append(p)
    upper=[]
    for p in reversed(pts):
        while len(upper)>=2 and cross(upper[-2],upper[-1],p)<=0: upper.pop()
        upper.append(p)
    return lower[:-1]+upper[:-1]

def source_mapper(W,H):
    def to_source(x,y): return [round(x/(W-1)*SOURCE_W), round(y/(H-1)*SOURCE_H)]
    return to_source

def outline_polygon(boundary, cx, cy, to_source, area_pixels):
    # Radial outline preserves broad massif shape better than convex hull; fall back to hull for small blobs.
    if area_pixels < 900:
        pts = convex_hull(boundary)
        eps = 1.0
    else:
        bins = min(288, max(72, int(math.sqrt(area_pixels))))
        buckets=[None]*bins
        for x,y in boundary:
            ang=(math.atan2(y-cy,x-cx)+math.tau)%math.tau
            idx=min(bins-1,int(ang/math.tau*bins))
            dist=(x-cx)*(x-cx)+(y-cy)*(y-cy)
            if buckets[idx] is None or dist>buckets[idx][0]: buckets[idx]=(dist,x,y)
        pts=[(x,y) for b in buckets if b is not None for _,x,y in [b]]
        eps = 2.6
    if len(pts)<3: return []
    pts.append(pts[0])
    pts=rdp(pts, eps)
    if len(pts)<4:
        pts=convex_hull(boundary); pts.append(pts[0])
    if pts[0]!=pts[-1]: pts.append(pts[0])
    return [to_source(x,y) for x,y in pts]

def extract(spec):
    im=Image.open(TERRAIN/spec['mask']).convert('L')
    arr=np.asarray(im); H,W=arr.shape
    active=arr>spec['threshold']
    seen=np.zeros((H,W),dtype=bool)
    to_source=source_mapper(W,H)
    features=[]
    for y0 in range(H):
        for x0 in range(W):
            if seen[y0,x0] or not active[y0,x0]: continue
            q=deque([(x0,y0)]); seen[y0,x0]=True
            pixels=[]; minx=maxx=x0; miny=maxy=y0
            while q:
                x,y=q.popleft(); pixels.append((x,y))
                minx=min(minx,x); maxx=max(maxx,x); miny=min(miny,y); maxy=max(maxy,y)
                for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                    if 0<=nx<W and 0<=ny<H and not seen[ny,nx] and active[ny,nx]:
                        seen[ny,nx]=True; q.append((nx,ny))
            if len(pixels)<spec['minPixels']: continue
            s=set(pixels); boundary=[]
            for x,y in pixels:
                if x==0 or y==0 or x==W-1 or y==H-1 or any((nx,ny) not in s for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1))):
                    boundary.append((x,y))
            cx=sum(x for x,y in pixels)/len(pixels); cy=sum(y for x,y in pixels)/len(pixels)
            poly=outline_polygon(boundary,cx,cy,to_source,len(pixels))
            if len(poly)<4: continue
            idx=len(features)+1
            features.append({
                'id': f"{spec['kind']}_{idx:03d}",
                'name': f"{spec['label']} {idx}",
                'type': spec['kind'],
                'status':'source-mask-derived',
                'source': f"terrain-data/{spec['mask']}",
                'threshold': spec['threshold'],
                'maskPixels': len(pixels),
                'sourceAreaApproxPx': round(len(pixels)*(SOURCE_W/(W-1))*(SOURCE_H/(H-1))),
                'bbox_px':[to_source(minx,miny),to_source(maxx,maxy)],
                'center_px':to_source(cx,cy),
                'points_px':poly,
            })
    features.sort(key=lambda f:-f['maskPixels'])
    return features[:MAX_FEATURES_PER_KIND], [W,H]

all_features=[]; mask_size=None; counts={}
for spec in SPECS:
    feats, size = extract(spec)
    mask_size=size; counts[spec['kind']]=len(feats)
    # Rename after sorting to keep stable largest-first IDs.
    for i,f in enumerate(feats,1):
        f['id']=f"{spec['kind']}_{i:03d}"
        f['name']=f"{spec['label']} {i}"
    all_features.extend(feats)

payload={
    'coordinateSpace':'malazan.source-pixel',
    'sourcePixels':[SOURCE_W,SOURCE_H],
    'maskPixels':mask_size,
    'status':'source-mask-derived',
    'featureCount':len(all_features),
    'countsByType':counts,
    'features':all_features,
    'notes':'Terrain/biome polygons extracted from existing terrain-data mask rasters. These are source-derived QA overlays, generalized for atlas interaction and not hand-drawn geography.',
}
OUT.write_text(json.dumps(payload,indent=2)+'\n')
print('wrote', OUT)
print('features', len(all_features), counts)
for f in all_features[:12]:
    print(f['id'], f['type'], f['maskPixels'], f['bbox_px'], 'points', len(f['points_px']))
