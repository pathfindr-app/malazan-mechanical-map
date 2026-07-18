import 'ol/ol.css';
import './styles.css';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Map from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Projection from 'ol/proj/Projection';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import TileGrid from 'ol/tilegrid/TileGrid';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { Fill, Stroke, Style, Circle as CircleStyle, Text } from 'ol/style';
import { defaults as defaultControls, ScaleLine, MousePosition } from 'ol/control';
import { Search, MapPin, Waves, Mountain, Trees, Layers, Crosshair, Route } from 'lucide-react';
import { MAX_ZOOM, SOURCE_EXTENT as EXTENT, SOURCE_HEIGHT, SOURCE_WIDTH, TILE_SIZE, type SourcePoint } from './atlas/constants';
import { mapToSource, sourceToMap } from './atlas/coordinates';

const BASE = import.meta.env.BASE_URL;

type Category = 'all' | 'settlement' | 'place' | 'water' | 'mountain' | 'terrain' | 'forest';
type Location = { name: string; kind: string; category: Exclude<Category, 'all'> | string; importance: number; center: SourcePoint; link?: string };
type LocationsPayload = { locations: Location[]; locationsCount: number; imageWidth: number; imageHeight: number };
type RiverFeature = { id: string; name: string; rank: number; certainty: string; points_px: SourcePoint[] };
type AreaFeature = { id: string; name: string; type?: string; certainty: string; points_px: SourcePoint[] };
type FeaturesPayload = { rivers: RiverFeature[]; basins: AreaFeature[]; biomes: AreaFeature[] };
type AtlasData = { locations: LocationsPayload; features: FeaturesPayload };
type Selected = { name: string; category: string; detail: string; center?: SourcePoint };

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'settlement', label: 'Settlements' }, { id: 'place', label: 'Places' },
  { id: 'water', label: 'Water' }, { id: 'mountain', label: 'Mountains' }, { id: 'terrain', label: 'Terrain' }, { id: 'forest', label: 'Forests' },
];

function formatSource(point?: SourcePoint) { return point ? `[${Math.round(point[0])}, ${Math.round(point[1])}]` : '—'; }
function categoryColor(category: string) {
  if (category === 'settlement') return '#ff6a3d';
  if (category === 'water') return '#109bd7';
  if (category === 'mountain') return '#7d5b38';
  if (category === 'forest') return '#238b45';
  if (category === 'terrain') return '#d29234';
  return '#ffd866';
}

function useAtlasData() {
  const [data, setData] = useState<AtlasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      fetch(`${BASE}data/locations.json`).then((r) => r.json()),
      fetch(`${BASE}data/prototype-features.json`).then((r) => r.json()),
    ]).then(([locations, features]) => setData({ locations, features })).catch((err) => setError(String(err)));
  }, []);
  return { data, error };
}

function createTileLayer() {
  const projection = new Projection({ code: 'MALAZAN_SOURCE_PIXEL', units: 'pixels', extent: EXTENT });
  const resolutions = Array.from({ length: MAX_ZOOM + 1 }, (_, z) => 2 ** (MAX_ZOOM - z));
  const tileGrid = new TileGrid({ extent: EXTENT, origin: [0, SOURCE_HEIGHT], tileSize: TILE_SIZE, resolutions });
  const source = new XYZ({
    projection, tileGrid, wrapX: false, interpolate: true, minZoom: 0, maxZoom: MAX_ZOOM,
    tileUrlFunction: ([z, x, y]) => (z < 0 || x < 0 || y < 0 ? '' : `${BASE}tiles/source/${z}/${x}/${y}.webp`),
  });
  return { projection, layer: new TileLayer({ source, className: 'source-raster-layer' }) };
}

function makeLocationStyle(feature: Feature, selectedName?: string, showLabel = false) {
  const loc = feature.get('location') as Location;
  const selected = selectedName === loc.name;
  const color = categoryColor(loc.category);
  return new Style({
    image: new CircleStyle({ radius: selected ? 9 : loc.importance >= 4 ? 6 : 4, fill: new Fill({ color: selected ? '#ffffff' : color }), stroke: new Stroke({ color: selected ? '#ff2d00' : '#1b1308', width: selected ? 4 : 2 }) }),
    text: showLabel || selected || loc.importance >= 4 ? new Text({ text: loc.name, offsetY: -17, font: selected ? '700 13px Inter, sans-serif' : '700 11px Inter, sans-serif', fill: new Fill({ color: '#17110a' }), stroke: new Stroke({ color: 'rgba(255,248,223,.95)', width: 4 }) }) : undefined,
  });
}

function createVectorLayers(data: AtlasData, getSelectedName: () => string | undefined, getSearchActive: () => boolean) {
  const locationSource = new VectorSource();
  for (const loc of data.locations.locations) locationSource.addFeature(new Feature({ geometry: new Point(sourceToMap(loc.center)), location: loc, kind: 'location' }));
  const riverSource = new VectorSource();
  for (const river of data.features.rivers) riverSource.addFeature(new Feature({ geometry: new LineString(river.points_px.map(sourceToMap)), river, kind: 'river' }));
  const areaSource = new VectorSource();
  for (const basin of data.features.basins) areaSource.addFeature(new Feature({ geometry: new Polygon([basin.points_px.map(sourceToMap)]), area: basin, areaKind: 'basin', kind: 'area' }));
  for (const biome of data.features.biomes) areaSource.addFeature(new Feature({ geometry: new Polygon([biome.points_px.map(sourceToMap)]), area: biome, areaKind: biome.type ?? 'biome', kind: 'area' }));

  const locationLayer = new VectorLayer({ source: locationSource, className: 'locations-layer', style: (feature) => makeLocationStyle(feature as Feature, getSelectedName(), getSearchActive()) });
  const riverLayer = new VectorLayer({
    source: riverSource, className: 'rivers-layer',
    style: (feature) => {
      const river = feature.get('river') as RiverFeature;
      return [new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,.92)', width: river.rank === 1 ? 10 : 7 }) }), new Style({ stroke: new Stroke({ color: river.rank === 1 ? '#00a8e8' : '#236fd8', width: river.rank === 1 ? 6 : 4 }) })];
    },
  });
  const areaLayer = new VectorLayer({
    source: areaSource, className: 'areas-layer',
    style: (feature) => {
      const kind = feature.get('areaKind');
      const fill = kind === 'lake' ? 'rgba(0,145,210,.20)' : kind === 'forest' ? 'rgba(32,130,58,.18)' : kind === 'mountain' ? 'rgba(130,92,48,.15)' : 'rgba(34,180,116,.12)';
      const stroke = kind === 'lake' ? '#1389c4' : kind === 'forest' ? '#22733f' : kind === 'mountain' ? '#835a30' : '#239a6e';
      return new Style({ fill: new Fill({ color: fill }), stroke: new Stroke({ color: stroke, width: 2, lineDash: [8, 8] }) });
    },
  });
  return { locationLayer, riverLayer, areaLayer };
}

function AtlasMap({ data, selected, setSelected, search, category, layers, cleanMode }: { data: AtlasData; selected: Selected | null; setSelected: (s: Selected) => void; search: string; category: Category; layers: { locations: boolean; rivers: boolean; areas: boolean }; cleanMode: boolean }) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const layerRefs = useRef<ReturnType<typeof createVectorLayers> | null>(null);
  const selectedRef = useRef<Selected | null>(selected);
  const searchRef = useRef(search);
  selectedRef.current = selected;
  searchRef.current = search;

  useEffect(() => {
    if (!mapEl.current) return;
    const { projection, layer: rasterLayer } = createTileLayer();
    const vectors = createVectorLayers(data, () => selectedRef.current?.name, () => Boolean(searchRef.current.trim()));
    layerRefs.current = vectors;
    const mousePosition = new MousePosition({ coordinateFormat: (coord) => !coord ? '' : `source ${formatSource(mapToSource(coord as [number, number]))}`, projection, className: 'coordinate-readout' });
    const map = new Map({
      target: mapEl.current,
      controls: defaultControls({ attribution: false, rotate: false }).extend([new ScaleLine({ units: 'metric', bar: true, text: true, minWidth: 120 }), mousePosition]),
      layers: [rasterLayer, vectors.areaLayer, vectors.riverLayer, vectors.locationLayer],
      view: new View({ projection, extent: EXTENT, center: sourceToMap([5000, 2785]), zoom: 1.25, minZoom: 0, maxZoom: 5.8, constrainOnlyCenter: true, smoothExtentConstraint: true }),
    });
    map.on('singleclick', (evt) => {
      const hit = map.forEachFeatureAtPixel(evt.pixel, (feature) => feature as Feature, { hitTolerance: 8 });
      if (!hit) return;
      const kind = hit.get('kind');
      if (kind === 'location') { const loc = hit.get('location') as Location; setSelected({ name: loc.name, category: loc.category, detail: `${loc.kind} • exact source coordinate ${formatSource(loc.center)}`, center: loc.center }); }
      if (kind === 'river') { const river = hit.get('river') as RiverFeature; setSelected({ name: river.name, category: 'river', detail: `${river.certainty}; ${river.points_px.length} source points. Rank ${river.rank}.`, center: river.points_px[Math.floor(river.points_px.length / 2)] }); }
      if (kind === 'area') { const area = hit.get('area') as AreaFeature; setSelected({ name: area.name, category: hit.get('areaKind'), detail: `${area.certainty}; ${area.points_px.length} source points.`, center: area.points_px[0] }); }
    });
    mapRef.current = map;
    return () => map.setTarget(undefined);
  }, [data, setSelected]);

  useEffect(() => {
    const vectors = layerRefs.current;
    if (!vectors) return;
    vectors.locationLayer.setVisible(layers.locations);
    vectors.riverLayer.setVisible(layers.rivers);
    vectors.areaLayer.setVisible(layers.areas);
    const q = search.trim().toLowerCase();
    vectors.locationLayer.setStyle((feature) => {
      const loc = feature.get('location') as Location;
      const matchesCategory = category === 'all' || loc.category === category;
      const matchesSearch = !q || loc.name.toLowerCase().includes(q) || loc.category.toLowerCase().includes(q) || loc.kind.toLowerCase().includes(q);
      if (!matchesCategory || !matchesSearch) return undefined;
      if (!q && loc.importance < 3 && selected?.name !== loc.name) return undefined;
      return makeLocationStyle(feature as Feature, selected?.name, Boolean(q));
    });
    vectors.locationLayer.changed();
  }, [search, category, selected?.name, layers.locations, layers.rivers, layers.areas]);

  useEffect(() => {
    if (!mapRef.current) return;
    const id = window.setTimeout(() => mapRef.current?.updateSize(), 80);
    return () => window.clearTimeout(id);
  }, [cleanMode]);

  useEffect(() => {
    if (!selected?.center || !mapRef.current) return;
    const view = mapRef.current.getView();
    view.animate({ center: sourceToMap(selected.center), zoom: Math.max(view.getZoom() ?? 2, 3.4), duration: 650 });
  }, [selected?.name]);

  return <div ref={mapEl} className="atlas-map" />;
}

function App() {
  const { data, error } = useAtlasData();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [selected, setSelected] = useState<Selected | null>({ name: 'Terrain-first atlas foundation', category: 'foundation', detail: 'OpenLayers pixel-CRS map using 512px tiles generated from the full 10k World of Malazan source. This is the rebuild base for real terrain/vector extraction.', center: [5000, 2785] });
  const [cleanMode, setCleanMode] = useState(false);
  const [layers, setLayers] = useState({ locations: true, rivers: true, areas: true });
  const toggleLayer = (key: keyof typeof layers) => setLayers((value) => ({ ...value, [key]: !value[key] }));

  const results = useMemo(() => {
    if (!data) return [] as Location[];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return data.locations.locations.filter((l) => category === 'all' || l.category === category).filter((l) => l.name.toLowerCase().includes(q) || l.category.toLowerCase().includes(q) || l.kind.toLowerCase().includes(q)).sort((a, b) => (b.importance - a.importance) || a.name.localeCompare(b.name)).slice(0, 12);
  }, [data, search, category]);
  const chooseLocation = (loc: Location) => setSelected({ name: loc.name, category: loc.category, detail: `${loc.kind} • exact source coordinate ${formatSource(loc.center)}`, center: loc.center });
  const fly = (name: string, center: SourcePoint, detail: string) => setSelected({ name, category: 'bookmark', detail, center });

  if (error) return <div className="fatal">Failed to load atlas data: {error}</div>;
  if (!data) return <div className="fatal">Loading terrain-first atlas foundation…</div>;
  const categoryCounts = data.locations.locations.reduce<Record<string, number>>((acc, loc) => { acc[loc.category] = (acc[loc.category] ?? 0) + 1; return acc; }, {});

  return <main className={`app-shell ${cleanMode ? 'clean-mode' : ''}`}>
    <AtlasMap data={data} selected={selected} setSelected={setSelected} search={search} category={category} layers={layers} cleanMode={cleanMode} />
    <button className="clean-toggle" onClick={() => setCleanMode((v) => !v)}>{cleanMode ? 'Exit clean map' : 'Clean map'}</button>
    <section className="panel top-left command-panel">
      <div className="brand"><span>Malazan Atlas</span><b>Terrain-first rebuild</b></div>
      <label className="search-box"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search 602 exact-coordinate locations…" /></label>
      <div className="category-row">{CATEGORIES.map((c) => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}>{c.label}</button>)}</div>
      {results.length > 0 && <div className="results-list">{results.map((loc) => <button key={`${loc.name}-${loc.center.join('-')}`} onClick={() => chooseLocation(loc)}><b>{loc.name}</b><span>{loc.category} · {formatSource(loc.center)}</span></button>)}</div>}
      <div className="bookmark-row">
        <button onClick={() => fly('Whole world', [5000, 2785], 'Full 10k map, tiled into z0-z5 source-pixel pyramid.')}>Whole world</button>
        <button onClick={() => fly('Darujhistan', [6782, 1527], 'Exact source coordinate [6782, 1527].')}>Darujhistan</button>
        <button onClick={() => fly('Pale', [6749, 1391], 'Exact source coordinate [6749, 1391].')}>Pale</button>
        <button onClick={() => fly('Genabackis river slice', [6828, 1536], 'Prototype river vectors are visible here as draft geography controls.')}>Rivers</button>
      </div>
    </section>
    <section className="panel top-right layers-panel"><h2><Layers size={16}/> Foundation status</h2><p>This is now a map engine foundation, not the cube-board prototype.</p><ul><li><b>Source:</b> z6 full mosaic</li><li><b>Pixels:</b> 10,000 × 5,571</li><li><b>Tiles:</b> 512px, z0-z5, 304 files</li><li><b>CRS:</b> source-pixel, top-left origin</li><li><b>POI:</b> {data.locations.locations.length} exact-coordinate locations</li></ul><div className="layer-toggle-row"><button className={layers.locations ? 'active' : ''} onClick={() => toggleLayer('locations')}>Locations</button><button className={layers.rivers ? 'active' : ''} onClick={() => toggleLayer('rivers')}>Draft rivers</button><button className={layers.areas ? 'active' : ''} onClick={() => toggleLayer('areas')}>Draft areas</button></div></section>
    <section className="panel bottom-left metrics-panel"><h2><Crosshair size={16}/> Cartography queue</h2><div className="metric-grid"><div><span>Settlements</span><b>{categoryCounts.settlement ?? 0}</b></div><div><span>Water</span><b>{categoryCounts.water ?? 0}</b></div><div><span>Mountains</span><b>{categoryCounts.mountain ?? 0}</b></div><div><span>Forests</span><b>{categoryCounts.forest ?? 0}</b></div></div><p>Next: trace/vectorize coasts, rivers, mountains, forests, and biomes from this exact source map.</p></section>
    <section className="panel bottom-right selected-panel"><div className="pill">{selected?.category ?? 'none'}</div><h2>{selected?.name ?? 'Nothing selected'}</h2><p>{selected?.detail ?? 'Click a place, river, or draft polygon.'}</p><div className="selected-icons"><MapPin/><Waves/><Mountain/><Trees/><Route/></div></section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
