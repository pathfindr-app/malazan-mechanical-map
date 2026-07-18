import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, OrbitControls, Sky, Text } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Layers, MapPin, Mountain, Waves, Trees, Search, Sparkles, Cloud } from 'lucide-react';
import './styles.css';

type Location = {
  name: string;
  kind: string;
  category: string;
  importance: number;
  center: [number, number];
  link?: string;
};

type LocationsPayload = {
  imageWidth: number;
  imageHeight: number;
  locationsCount: number;
  locations: Location[];
};

type LineFeature = { id: string; name: string; rank?: number; certainty: string; points_px: [number, number][] };
type PolyFeature = { id: string; name: string; type?: string; certainty: string; points_px: [number, number][] };
type FeaturePayload = { rivers: LineFeature[]; basins: PolyFeature[]; biomes: PolyFeature[] };

type Selected = { name: string; category: string; detail: string; center?: [number, number] };

type TerrainPayload = { sourceImage: string; sourcePixels: [number, number]; sampleSize: [number, number]; heights: number[][] };
type AtlasData = { locations: LocationsPayload; features: FeaturePayload; terrain: TerrainPayload };
type FocusBookmark = { id: string; label: string; center: [number, number]; distance: number; height: number; yaw: number; note: string };

const BOOKMARKS: FocusBookmark[] = [
  { id: 'slice', label: 'Whole world', center: [5000, 2785], distance: 1.2, height: 20.0, yaw: 0.78, note: 'Full source-map fidelity view. The image texture is the ground truth.' },
  { id: 'darujhistan', label: 'Darujhistan', center: [6782, 1527], distance: 2.65, height: 2.05, yaw: 0.78, note: 'Gaslit city miniature and Lake Azur basin anchor.' },
  { id: 'pale', label: 'Pale', center: [6749, 1391], distance: 2.9, height: 2.2, yaw: 0.55, note: 'Siege city miniature and northern campaign-map focus.' },
  { id: 'rivers', label: 'Rivers', center: [6860, 1490], distance: 3.5, height: 2.55, yaw: 0.98, note: 'Close enough to inspect provisional river tubes and drainage vectors.' },
];

const CATEGORY_FILTERS = ['all', 'settlement', 'place', 'water', 'mountain', 'terrain', 'forest'] as const;
type CategoryFilter = typeof CATEGORY_FILTERS[number];

const LEGEND_ITEMS = [
  { key: 'city', label: 'City', swatch: 'city', copy: 'enlarged miniature tokens' },
  { key: 'mountain', label: 'Hills', swatch: 'mountain', copy: 'raised ridges / passes' },
  { key: 'forest', label: 'Forest', swatch: 'forest', copy: 'clustered tree landmarks' },
  { key: 'lake', label: 'Lake', swatch: 'lake', copy: 'enamel water anchors' },
  { key: 'river', label: 'River', swatch: 'river', copy: 'editable vector channels' },
  { key: 'basin', label: 'Basin', swatch: 'basin', copy: 'drainage / biome overlays' },
];

const BOARD_W = 20;
const MAP_W = 10000;
const MAP_H = 5571;
const BOARD_H = BOARD_W * MAP_H / MAP_W;
const BASE = import.meta.env.BASE_URL;

function pxToWorld([x, y]: [number, number], lift = 0): [number, number, number] {
  return [(x / MAP_W - 0.5) * BOARD_W, lift, (0.5 - y / MAP_H) * BOARD_H];
}

function hashNoise(x: number, z: number) {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function useAtlasData() {
  const [data, setData] = useState<AtlasData | null>(null);
  useEffect(() => {
    Promise.all([
      fetch(`${BASE}data/locations.json`).then((r) => r.json()),
      fetch(`${BASE}data/prototype-features.json`).then((r) => r.json()),
      fetch(`${BASE}data/terrain-heightmap.json`).then((r) => r.json()),
    ]).then(([locations, features, terrain]) => setData({ locations, features, terrain }));
  }, []);
  return data;
}

function SourceMapPlate({ ghost }: { ghost: boolean }) {
  const texture = useLoader(THREE.TextureLoader, `${BASE}assets/worldofmalazan-z3-mosaic.png`);
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);
  return (
    <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[BOARD_W, BOARD_H, 1, 1]} />
      <meshStandardMaterial map={texture} transparent opacity={ghost ? 0.72 : 0.28} roughness={0.88} metalness={0.02} />
    </mesh>
  );
}

function SourceTerrainSurface({ terrain, ghost }: { terrain: TerrainPayload; ghost: boolean }) {
  const texture = useLoader(THREE.TextureLoader, `${BASE}assets/worldofmalazan-z3-mosaic.png`);
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 12;
  }, [texture]);
  const geometry = useMemo(() => {
    const [cols, rows] = terrain.sampleSize;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const u = x / (cols - 1);
        const v = y / (rows - 1);
        positions.push((u - 0.5) * BOARD_W, (terrain.heights[y]?.[x] ?? 0) * 0.12, (0.5 - v) * BOARD_H);
        uvs.push(u, 1 - v);
      }
    }
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [terrain]);
  return (
    <group name="source-faithful-terrain">
      <mesh geometry={geometry} receiveShadow castShadow>
        <meshBasicMaterial map={texture} color="#ffffff" transparent opacity={ghost ? 1 : 0.92} />
      </mesh>
      <mesh position={[0, -0.21, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[BOARD_W * 1.025, BOARD_H * 1.025, 1, 1]} />
        <meshStandardMaterial color="#123948" roughness={0.72} metalness={0.04} transparent opacity={0.72} />
      </mesh>
    </group>
  );
}

function RiverLine({ feature, selected, onSelect }: { feature: LineFeature; selected: boolean; onSelect: (s: Selected) => void }) {
  const curve = useMemo(() => {
    const pts = feature.points_px.map((p) => new THREE.Vector3(...pxToWorld(p, 0.18)));
    return new THREE.CatmullRomCurve3(pts);
  }, [feature]);
  const color = selected ? '#b8fff6' : feature.rank === 1 ? '#49d6e8' : '#5fa9ff';
  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect({ name: feature.name, category: 'river', detail: `River vector: ${feature.certainty}. Rank ${feature.rank ?? 2}.`, center: feature.points_px[Math.floor(feature.points_px.length / 2)] }); }}>
      <mesh castShadow>
        <tubeGeometry args={[curve, 80, selected ? 0.045 : feature.rank === 1 ? 0.035 : 0.022, 8, false]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 1.3 : 0.65} roughness={0.2} />
      </mesh>
    </group>
  );
}

function BasinPolygon({ feature, visible, selected, onSelect }: { feature: PolyFeature; visible: boolean; selected: boolean; onSelect: (s: Selected) => void }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    feature.points_px.forEach((pt, i) => {
      const [x, , z] = pxToWorld(pt, 0.155);
      if (i === 0) s.moveTo(x, z); else s.lineTo(x, z);
    });
    s.closePath();
    return s;
  }, [feature]);
  if (!visible) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.155, 0]} onClick={(e) => { e.stopPropagation(); onSelect({ name: feature.name, category: feature.type ?? 'basin', detail: `Boundary layer: ${feature.certainty}. Editable/provisional drainage geometry.`, center: feature.points_px[0] }); }}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={selected ? '#ffd166' : '#7ef0aa'} transparent opacity={selected ? 0.36 : 0.18} emissive={selected ? '#5c3d00' : '#0a3b22'} emissiveIntensity={0.25} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function MountainRange({ center, count = 14 }: { center: [number, number]; count?: number }) {
  const cones = useMemo(() => new Array(count).fill(0).map((_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = 0.22 + hashNoise(i, center[0]) * 0.28;
    const [x, , z] = pxToWorld([center[0] + Math.cos(a) * r * 210, center[1] + Math.sin(a) * r * 130], 0.32);
    return { x, z, h: 0.25 + hashNoise(i * 3, center[1]) * 0.45, r: 0.08 + hashNoise(i * 9, center[0]) * 0.06 };
  }), [center, count]);
  return <group>{cones.map((c, i) => <mesh key={i} position={[c.x, 0.18 + c.h / 2, c.z]} castShadow receiveShadow><coneGeometry args={[c.r, c.h, 4]} /><meshStandardMaterial color={i % 3 === 0 ? '#d8d2bd' : '#8c7e69'} roughness={0.86} /></mesh>)}</group>;
}

function ForestCluster({ center, count = 28 }: { center: [number, number]; count?: number }) {
  const trees = useMemo(() => new Array(count).fill(0).map((_, i) => {
    const a = hashNoise(i, center[0]) * Math.PI * 2;
    const r = hashNoise(i * 7, center[1]) * 0.55;
    const [x, , z] = pxToWorld([center[0] + Math.cos(a) * r * 310, center[1] + Math.sin(a) * r * 180], 0.24);
    return { x, z, s: 0.06 + hashNoise(i * 5, center[0]) * 0.05 };
  }), [center, count]);
  return <group>{trees.map((t, i) => <group key={i} position={[t.x, 0.19, t.z]}><mesh castShadow><cylinderGeometry args={[t.s * 0.32, t.s * 0.44, t.s * 1.3, 5]} /><meshStandardMaterial color="#5b3c24" roughness={0.9} /></mesh><mesh position={[0, t.s * 1.2, 0]} castShadow><dodecahedronGeometry args={[t.s, 0]} /><meshStandardMaterial color={i % 4 === 0 ? '#8fc16d' : '#497d46'} roughness={0.88} /></mesh></group>)}</group>;
}


function CityMiniature({ name, center, tone, onSelect }: { name: string; center: [number, number]; tone: 'gas' | 'siege'; onSelect: (s: Selected) => void }) {
  const [x, , z] = pxToWorld(center, 0.32);
  const buildings = useMemo(() => new Array(tone === 'gas' ? 18 : 11).fill(0).map((_, i) => {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const jitterX = (hashNoise(i, center[0]) - 0.5) * 0.05;
    const jitterZ = (hashNoise(i, center[1]) - 0.5) * 0.05;
    return {
      x: (col - 2) * 0.075 + jitterX,
      z: (row - 1.5) * 0.075 + jitterZ,
      h: 0.13 + hashNoise(i * 4, center[0]) * (tone === 'gas' ? 0.24 : 0.18),
      w: 0.045 + hashNoise(i * 8, center[1]) * 0.035,
    };
  }), [center, tone]);
  const glow = tone === 'gas' ? '#52f5d0' : '#ff7b48';
  const wall = tone === 'gas' ? '#b69b70' : '#8c7460';
  return (
    <group position={[x, 0.34, z]} onClick={(e) => { e.stopPropagation(); onSelect({ name, category: tone === 'gas' ? 'gas-lit city token' : 'siege city token', detail: `${name} is shown as an enlarged cute miniature anchored to exact source coordinate [${Math.round(center[0])}, ${Math.round(center[1])}].`, center }); }}>
      <mesh position={[0, -0.03, 0]} receiveShadow>
        <cylinderGeometry args={[0.28, 0.32, 0.055, 10]} />
        <meshStandardMaterial color="#5a351d" roughness={0.72} metalness={0.14} />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <torusGeometry args={[0.24, 0.012, 6, 36]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={tone === 'gas' ? 1.2 : 0.8} roughness={0.3} />
      </mesh>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, b.h / 2, b.z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.w * 0.92]} />
            <meshStandardMaterial color={wall} roughness={0.82} metalness={0.06} emissive={i % 4 === 0 ? glow : '#000'} emissiveIntensity={i % 4 === 0 ? 0.18 : 0} />
          </mesh>
          <mesh position={[0, b.h / 2 + 0.028, 0]} castShadow>
            <coneGeometry args={[b.w * 0.78, 0.065, 4]} />
            <meshStandardMaterial color={tone === 'gas' ? '#2d6f72' : '#553021'} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {tone === 'siege' && <group>{new Array(8).fill(0).map((_, i) => <mesh key={i} position={[(hashNoise(i, 2)-0.5)*0.48, 0.16 + hashNoise(i,3)*0.2, (hashNoise(i,4)-0.5)*0.45]}><sphereGeometry args={[0.035 + hashNoise(i, 7)*0.03, 8, 6]} /><meshStandardMaterial color="#3d3030" transparent opacity={0.42} depthWrite={false} /></mesh>)}</group>}
      <pointLight position={[0, 0.35, 0]} color={glow} intensity={tone === 'gas' ? 1.1 : 0.65} distance={1.4} />
      <Text position={[0, 0.48, 0]} fontSize={0.12} color="#fff7d6" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#211407">{name}</Text>
    </group>
  );
}

function CloudShadowPlane() {
  const ref = React.useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.position.x = Math.sin(Date.now() * 0.00007) * 1.2;
      ref.current.position.z = Math.cos(Date.now() * 0.00005) * 0.55;
      ref.current.rotation.z += delta * 0.01;
    }
  });
  return (
    <mesh ref={ref} position={[0, 0.205, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[BOARD_W * 0.92, BOARD_H * 0.92, 1, 1]} />
      <meshBasicMaterial color="#0b1018" transparent opacity={0.12} depthWrite={false} blending={THREE.MultiplyBlending} />
    </mesh>
  );
}


function LandmarkToken({ name, center, kind, onSelect }: { name: string; center: [number, number]; kind: 'mountain' | 'forest' | 'lake' | 'ruin'; onSelect: (s: Selected) => void }) {
  const [x, , z] = pxToWorld(center, 0.37);
  const colors: Record<typeof kind, { base: string; glow: string; detail: string }> = {
    mountain: { base: '#8f7f68', glow: '#fff1c4', detail: '#d9d2bf' },
    forest: { base: '#3f7440', glow: '#9af58a', detail: '#244d2c' },
    lake: { base: '#247e9c', glow: '#63e8ff', detail: '#9df8ff' },
    ruin: { base: '#756456', glow: '#ffba72', detail: '#46352f' },
  };
  const c = colors[kind];
  const detail = `${name} rendered as a stylized ${kind} landmark token anchored to source coordinate [${Math.round(center[0])}, ${Math.round(center[1])}].`;
  return (
    <group position={[x, 0.35, z]} onClick={(e) => { e.stopPropagation(); onSelect({ name, category: `${kind} landmark`, detail, center }); }}>
      <mesh position={[0, -0.035, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.18, 0.22, 0.055, 8]} />
        <meshStandardMaterial color="#56371e" roughness={0.76} metalness={0.1} />
      </mesh>
      {kind === 'mountain' && <group>
        <mesh position={[-0.06, 0.11, 0]} castShadow><coneGeometry args={[0.105, 0.28, 4]} /><meshStandardMaterial color={c.base} roughness={0.82} /></mesh>
        <mesh position={[0.055, 0.15, 0.035]} castShadow><coneGeometry args={[0.13, 0.36, 4]} /><meshStandardMaterial color={c.base} roughness={0.82} /></mesh>
        <mesh position={[0.055, 0.34, 0.035]}><coneGeometry args={[0.043, 0.095, 4]} /><meshStandardMaterial color={c.detail} emissive={c.glow} emissiveIntensity={0.2} /></mesh>
      </group>}
      {kind === 'forest' && <group>{new Array(9).fill(0).map((_, i) => <group key={i} position={[(hashNoise(i, 11)-0.5)*0.28, 0.04, (hashNoise(i, 12)-0.5)*0.25]}><mesh position={[0,0.065,0]} castShadow><cylinderGeometry args={[0.015,0.02,0.13,5]} /><meshStandardMaterial color="#5d3b23" /></mesh><mesh position={[0,0.16,0]} castShadow><coneGeometry args={[0.045,0.13,6]} /><meshStandardMaterial color={i%3===0?c.glow:c.base} roughness={0.8} /></mesh></group>)}</group>}
      {kind === 'lake' && <group>
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[0.15, 24]} /><meshStandardMaterial color={c.base} emissive={c.glow} emissiveIntensity={0.55} roughness={0.25} metalness={0.25} /></mesh>
        <mesh position={[0,0.02,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[0.118,0.008,6,32]} /><meshStandardMaterial color={c.detail} emissive={c.glow} emissiveIntensity={0.8} /></mesh>
      </group>}
      {kind === 'ruin' && <group>{new Array(6).fill(0).map((_, i) => <mesh key={i} position={[(i-2.5)*0.04,0.055+hashNoise(i,17)*0.06,(hashNoise(i,18)-0.5)*0.13]} rotation={[0,hashNoise(i,19)*0.5,0]} castShadow><boxGeometry args={[0.035,0.11+hashNoise(i,20)*0.12,0.035]} /><meshStandardMaterial color={i%2?c.base:c.detail} roughness={0.9} /></mesh>)}</group>}
      <pointLight position={[0,0.25,0]} color={c.glow} intensity={0.45} distance={0.9} />
      <Text position={[0, 0.36, 0]} fontSize={0.085} color="#fff7d6" anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#211407">{name}</Text>
    </group>
  );
}


function SelectedFocusAura({ selected }: { selected: Selected | null }) {
  const ring = React.useRef<THREE.Mesh>(null);
  const beam = React.useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ring.current) {
      ring.current.rotation.z += delta * 0.9;
      const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.08;
      ring.current.scale.setScalar(pulse);
    }
    if (beam.current) {
      beam.current.rotation.y += delta * 0.35;
    }
  });
  if (!selected?.center) return null;
  const [x, , z] = pxToWorld(selected.center, 0.42);
  const color = selected.category.includes('river') ? '#42e8ff' : selected.category.includes('forest') ? '#9af58a' : selected.category.includes('lake') || selected.category.includes('water') ? '#63e8ff' : selected.category.includes('mountain') || selected.category.includes('hill') ? '#fff1c4' : '#ffe08a';
  return (
    <group position={[x, 0.42, z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.34, 0.012, 8, 72]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.15} transparent opacity={0.92} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.28, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={beam} position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.026, 0.095, 1.05, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <pointLight position={[0, 0.34, 0]} color={color} intensity={0.9} distance={1.3} />
    </group>
  );
}

function LocationPins({ locations, filter, categoryFilter, selectedName, onSelect }: { locations: Location[]; filter: string; categoryFilter: CategoryFilter; selectedName?: string; onSelect: (s: Selected) => void }) {
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return locations
      .filter((l) => l.importance >= 3 || ['Darujhistan', 'Pale', 'Lake Azur', 'Gadrobi Hills', 'Moranth Mountains', 'Blackdog Forest'].includes(l.name))
      .filter((l) => categoryFilter === 'all' || l.category === categoryFilter)
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.category.includes(q))
      .slice(0, q ? 80 : 72);
  }, [locations, filter, categoryFilter]);
  return (
    <group name="location-pins">
      {visible.map((l) => {
        const [x, y, z] = pxToWorld(l.center, 0.34 + l.importance * 0.03);
        const active = selectedName === l.name;
        const color = l.category === 'water' ? '#56d7ff' : l.category === 'mountain' ? '#f2e7c9' : l.category === 'forest' ? '#8df28c' : l.category === 'settlement' ? '#ffcc66' : '#fff0a6';
        return (
          <group key={l.name} position={[x, y, z]} onClick={(e) => { e.stopPropagation(); onSelect({ name: l.name, category: l.category, detail: `${l.kind} • ${l.category} • exact source coordinate [${Math.round(l.center[0])}, ${Math.round(l.center[1])}]`, center: l.center }); }}>
            <mesh castShadow>
              <cylinderGeometry args={[active ? 0.07 : 0.032, active ? 0.105 : 0.047, active ? 0.18 : 0.09, 6]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 1.4 : 0.45} roughness={0.38} />
            </mesh>
            {(active || l.importance >= 3) && <Text position={[0, 0.22, 0]} fontSize={active ? 0.18 : 0.105} color="#fff7d6" anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#22140a">{l.name}</Text>}
          </group>
        );
      })}
    </group>
  );
}

function CloudsLayer() {
  const ref = React.useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.position.x = Math.sin(Date.now() * 0.00005) * 0.7;
    if (ref.current) ref.current.rotation.y += delta * 0.004;
  });
  const puffs = useMemo(() => new Array(46).fill(0).map((_, i) => ({
    x: -9 + hashNoise(i, 1) * 18,
    z: -5 + hashNoise(i, 2) * 10,
    y: 2.0 + hashNoise(i, 3) * 1.2,
    s: 0.35 + hashNoise(i, 4) * 0.85,
  })), []);
  return <group ref={ref}>{puffs.map((p, i) => <mesh key={i} position={[p.x, p.y, p.z]} castShadow={false}><sphereGeometry args={[p.s, 12, 8]} /><meshStandardMaterial color="#fff4dc" transparent opacity={0.20} depthWrite={false} roughness={1} /></mesh>)}</group>;
}

function BoardBase() {
  return (
    <group>
      <mesh position={[0, -0.18, 0]} receiveShadow>
        <boxGeometry args={[BOARD_W + 1.25, 0.26, BOARD_H + 1.25]} />
        <meshStandardMaterial color="#382313" roughness={0.78} metalness={0.08} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[Math.min(BOARD_W, BOARD_H) * 0.54, Math.min(BOARD_W, BOARD_H) * 0.585, 96]} />
        <meshStandardMaterial color="#b28b49" roughness={0.38} metalness={0.75} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}


function CameraBookmarkRig({ bookmark }: { bookmark: FocusBookmark }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls?: { target: THREE.Vector3; update: () => void } };
  const target = useMemo(() => new THREE.Vector3(...pxToWorld(bookmark.center, 0.22)), [bookmark]);
  const desired = useMemo(() => {
    const x = target.x + Math.cos(bookmark.yaw) * bookmark.distance;
    const z = target.z + Math.sin(bookmark.yaw) * bookmark.distance;
    return new THREE.Vector3(x, bookmark.height, z);
  }, [bookmark, target]);
  useFrame(() => {
    camera.position.lerp(desired, 0.045);
    camera.lookAt(target);
    if (controls) {
      controls.target.lerp(target, 0.08);
      controls.update();
    }
  });
  return null;
}

function AtlasScene({ data, selected, setSelected, search, categoryFilter, layers, focus, showCallout = true }: { data: AtlasData; selected: Selected | null; setSelected: (s: Selected) => void; search: string; categoryFilter: CategoryFilter; layers: Record<string, boolean>; focus: FocusBookmark; showCallout?: boolean }) {
  const selectedName = selected?.name;
  return (
    <>
      <color attach="background" args={["#111522"]} />
      <fog attach="fog" args={["#111522", 10, 29]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[-4, 8, 6]} intensity={2.5} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={8} shadow-camera-bottom={-8} />
      <pointLight position={[4, 1.2, -1.5]} intensity={2.4} color="#55e1ff" />
      <pointLight position={[-4, 1.8, 2.5]} intensity={1.4} color="#ffb85c" />
      <Sky sunPosition={[-4, 3, 1]} turbidity={6} rayleigh={0.7} mieCoefficient={0.012} mieDirectionalG={0.8} />
      <BoardBase />
      <SourceTerrainSurface terrain={data.terrain} ghost={layers.source} />
      {layers.boundaries && data.features.basins.map((b) => <BasinPolygon key={b.id} feature={b} visible selected={selectedName === b.name} onSelect={setSelected} />)}
      {layers.boundaries && data.features.biomes.map((b) => <BasinPolygon key={b.id} feature={b} visible selected={selectedName === b.name} onSelect={setSelected} />)}
      {layers.rivers && data.features.rivers.map((r) => <RiverLine key={r.id} feature={r} selected={selectedName === r.name} onSelect={setSelected} />)}
      {layers.landmarks && <>
        <MountainRange center={[6867, 1524]} />
        <ForestCluster center={[6640, 1210]} />
        <CityMiniature name="Darujhistan" center={[6782, 1527]} tone="gas" onSelect={setSelected} />
        <CityMiniature name="Pale" center={[6749, 1391]} tone="siege" onSelect={setSelected} />
        <LandmarkToken name="Gadrobi Hills" center={[6861, 1558]} kind="mountain" onSelect={setSelected} />
        <LandmarkToken name="Blackdog Forest" center={[6623, 1195]} kind="forest" onSelect={setSelected} />
        <LandmarkToken name="Lake Azur" center={[6802, 1518]} kind="lake" onSelect={setSelected} />
        <LandmarkToken name="Old Road Ruins" center={[6905, 1468]} kind="ruin" onSelect={setSelected} />
      </>}
      {layers.clouds && <CloudShadowPlane />}
      <SelectedFocusAura selected={selected} />
      {layers.pins && <LocationPins locations={data.locations.locations} filter={search} categoryFilter={categoryFilter} selectedName={selectedName} onSelect={setSelected} />}
      {layers.clouds && layers.landmarks && <CloudsLayer />}
      {showCallout && <Html position={pxToWorld([6782, 1527], 0.78)} center className="atlas-callout">Genabackis slice<br/><b>Darujhistan / Pale</b></Html>}
      <CameraBookmarkRig bookmark={focus} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={1.8} maxDistance={21} maxPolarAngle={Math.PI * 0.48} target={[3.55, 0.18, 2.55]} />
      <EffectComposer multisampling={0} enabled={layers.cinematic}>
        <DepthOfField focusDistance={0.03} focalLength={0.018} bokehScale={0.65} height={480} />
        <Bloom luminanceThreshold={0.35} intensity={0.55} mipmapBlur />
        <Vignette eskil={false} offset={0.18} darkness={0.55} />
      </EffectComposer>
    </>
  );
}


function SourceAtlas2D({ data, selected, setSelected, search, categoryFilter, layers }: { data: AtlasData; selected: Selected | null; setSelected: (s: Selected) => void; search: string; categoryFilter: CategoryFilter; layers: Record<string, boolean> }) {
  const q = search.trim().toLowerCase();
  const visiblePins = useMemo(() => data.locations.locations
    .filter((l) => categoryFilter === 'all' || l.category === categoryFilter)
    .filter((l) => !q || l.name.toLowerCase().includes(q) || l.category.includes(q) || l.kind.includes(q))
    .filter((l) => q || l.importance >= 3)
    .slice(0, q ? 140 : 95), [data, q, categoryFilter]);
  const selectLocation = (l: Location) => setSelected({ name: l.name, category: l.category, detail: `${l.kind} • exact source coordinate [${Math.round(l.center[0])}, ${Math.round(l.center[1])}]`, center: l.center });
  return (
    <div className="source-map-2d">
      <img src={`${BASE}assets/worldofmalazan-z3-mosaic.png`} alt="World of Malazan source map" />
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" className="source-overlay">
        {layers.boundaries && data.features.basins.map((b) => <polygon key={b.id} points={b.points_px.map((p) => p.join(',')).join(' ')} fill="rgba(27, 184, 118, .16)" stroke="rgba(0, 112, 80, .75)" strokeWidth="18" />)}
        {layers.boundaries && data.features.biomes.map((b) => <polygon key={b.id} points={b.points_px.map((p) => p.join(',')).join(' ')} fill={b.type === 'lake' ? 'rgba(40, 160, 220, .24)' : b.type === 'forest' ? 'rgba(0, 126, 52, .18)' : 'rgba(175, 104, 36, .18)'} stroke="rgba(30, 55, 32, .65)" strokeWidth="14" />)}
        {layers.rivers && data.features.rivers.map((r) => <polyline key={r.id} points={r.points_px.map((p) => p.join(',')).join(' ')} fill="none" stroke={r.rank === 1 ? '#00a8df' : '#2677d9'} strokeWidth={r.rank === 1 ? 22 : 14} strokeLinecap="round" strokeLinejoin="round" opacity="0.86" />)}
        {selected?.center && <g pointerEvents="none"><circle cx={selected.center[0]} cy={selected.center[1]} r="95" fill="none" stroke="#ff5f3b" strokeWidth="18"/><circle cx={selected.center[0]} cy={selected.center[1]} r="42" fill="rgba(255,95,59,.22)" stroke="#fff2a8" strokeWidth="10"/></g>}
        {layers.pins && visiblePins.map((l) => <g key={l.name} className="source-pin" onClick={() => selectLocation(l)}>
          <circle cx={l.center[0]} cy={l.center[1]} r={selected?.name === l.name ? 42 : l.importance >= 4 ? 30 : 22} fill={selected?.name === l.name ? '#ff5f3b' : '#fff4a6'} stroke="#1d1408" strokeWidth="9" />
          {(selected?.name === l.name || q || l.importance >= 4) && <text x={l.center[0] + 52} y={l.center[1] - 24} fontSize="72" fontWeight="800" fill="#15100a" stroke="#fff8de" strokeWidth="16" paintOrder="stroke">{l.name}</text>}
        </g>)}
      </svg>
      <div className="source-map-badge">Exact source map view • 10,000 × 5,571 coordinate space • stylization disabled until traced</div>
    </div>
  );
}

function TraceStudio({ data, selected, setSelected, onClose }: { data: AtlasData; selected: Selected | null; setSelected: (s: Selected) => void; onClose: () => void }) {
  const view = { x: 6260, y: 1040, w: 1040, h: 920 };
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [draftFeatures, setDraftFeatures] = useState<FeaturePayload>(() => {
    try {
      const saved = window.localStorage.getItem('malazan-atlas-draft-features');
      return saved ? JSON.parse(saved) as FeaturePayload : data.features;
    } catch {
      return data.features;
    }
  });
  const [activeRiverId, setActiveRiverId] = useState(data.features.rivers[0]?.id ?? '');
  const [activeBoundaryId, setActiveBoundaryId] = useState(data.features.basins[0]?.id ?? data.features.biomes[0]?.id ?? '');
  const [editEnabled, setEditEnabled] = useState(true);
  const [hoverPoint, setHoverPoint] = useState<[number, number] | null>(null);
  const [dragPointIndex, setDragPointIndex] = useState<number | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [dragBoundaryPointIndex, setDragBoundaryPointIndex] = useState<number | null>(null);
  const [selectedBoundaryPointIndex, setSelectedBoundaryPointIndex] = useState<number | null>(null);
  const justDraggedRef = React.useRef(false);
  const activeRiver = draftFeatures.rivers.find((r) => r.id === activeRiverId) ?? draftFeatures.rivers[0];
  const boundaryOptions = useMemo(() => [...draftFeatures.basins, ...draftFeatures.biomes], [draftFeatures]);
  const activeBoundary = boundaryOptions.find((b) => b.id === activeBoundaryId) ?? boundaryOptions[0];
  useEffect(() => {
    window.localStorage.setItem('malazan-atlas-draft-features', JSON.stringify(draftFeatures));
  }, [draftFeatures]);
  const places = data.locations.locations.filter((l) => {
    const [x, y] = l.center;
    return x >= view.x && x <= view.x + view.w && y >= view.y && y <= view.y + view.h && (l.importance >= 2 || /Darujhistan|Pale|Azur|Gadrobi|Blackdog|Moranth/i.test(l.name));
  });
  const selectedName = selected?.name;
  const selectRiver = (r: LineFeature) => {
    setActiveRiverId(r.id);
    setSelectedPointIndex(null);
    setSelectedBoundaryPointIndex(null);
    setSelected({ name: r.name, category: 'river', detail: `River trace: ${r.certainty}. Rank ${r.rank ?? 2}. Click to append points, or drag glowing handles to refine exact source-pixel geometry.`, center: r.points_px[Math.floor(r.points_px.length / 2)] });
  };
  const selectPoly = (b: PolyFeature) => {
    setActiveBoundaryId(b.id);
    setSelectedPointIndex(null);
    setSelected({ name: b.name, category: b.type ?? 'boundary', detail: `Boundary trace: ${b.certainty}. Drag glowing polygon handles to refine this basin/biome outline.`, center: b.points_px[0] });
  };
  const svgPointFromEvent = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    if (!matrix) return null;
    const next = point.matrixTransform(matrix);
    return [Math.round(next.x), Math.round(next.y)] as [number, number];
  };
  const appendRiverPoint = (point: [number, number]) => {
    if (!activeRiver || !editEnabled) return;
    setDraftFeatures((prev) => ({
      ...prev,
      rivers: prev.rivers.map((r) => r.id === activeRiver.id ? { ...r, points_px: [...r.points_px, point], certainty: 'edited in browser prototype' } : r),
    }));
    setSelected({ name: activeRiver.name, category: 'river', detail: `Added source-pixel point [${point[0]}, ${point[1]}]. Export JSON to persist it.`, center: point });
  };
  const updateRiverPoint = (idx: number, point: [number, number]) => {
    setSelectedPointIndex(idx);
    if (!activeRiver || !editEnabled) return;
    justDraggedRef.current = true;
    setDraftFeatures((prev) => ({
      ...prev,
      rivers: prev.rivers.map((r) => r.id === activeRiver.id ? { ...r, points_px: r.points_px.map((p, i) => i === idx ? point : p), certainty: 'edited in browser prototype' } : r),
    }));
    setSelected({ name: activeRiver.name, category: 'river', detail: `Moved point ${idx + 1} to source-pixel [${point[0]}, ${point[1]}]. Export JSON to persist it.`, center: point });
  };
  const undoRiverPoint = () => {
    if (!activeRiver || activeRiver.points_px.length <= 2) return;
    setDraftFeatures((prev) => ({
      ...prev,
      rivers: prev.rivers.map((r) => r.id === activeRiver.id ? { ...r, points_px: r.points_px.slice(0, -1), certainty: 'edited in browser prototype' } : r),
    }));
  };
  const deleteSelectedPoint = () => {
    if (!activeRiver || selectedPointIndex === null || activeRiver.points_px.length <= 2) return;
    const removed = activeRiver.points_px[selectedPointIndex];
    setDraftFeatures((prev) => ({
      ...prev,
      rivers: prev.rivers.map((r) => r.id === activeRiver.id ? { ...r, points_px: r.points_px.filter((_, i) => i !== selectedPointIndex), certainty: 'edited in browser prototype' } : r),
    }));
    setSelected({ name: activeRiver.name, category: 'river', detail: `Deleted point ${selectedPointIndex + 1} at source-pixel [${removed[0]}, ${removed[1]}]. Export JSON to persist it.`, center: removed });
    setSelectedPointIndex(null);
  };
  const mapBoundaryCollection = (collection: PolyFeature[], updater: (b: PolyFeature) => PolyFeature) => collection.map((b) => b.id === activeBoundary?.id ? updater(b) : b);
  const updateBoundaryPoint = (idx: number, point: [number, number]) => {
    if (!activeBoundary || !editEnabled) return;
    justDraggedRef.current = true;
    setDraftFeatures((prev) => ({
      ...prev,
      basins: mapBoundaryCollection(prev.basins, (b) => ({ ...b, points_px: b.points_px.map((p, i) => i === idx ? point : p), certainty: 'edited in browser prototype' })),
      biomes: mapBoundaryCollection(prev.biomes, (b) => ({ ...b, points_px: b.points_px.map((p, i) => i === idx ? point : p), certainty: 'edited in browser prototype' })),
    }));
    setSelectedBoundaryPointIndex(idx);
    setSelected({ name: activeBoundary.name, category: activeBoundary.type ?? 'boundary', detail: `Moved boundary point ${idx + 1} to source-pixel [${point[0]}, ${point[1]}]. Export JSON to persist it.`, center: point });
  };
  const appendBoundaryPoint = (point: [number, number]) => {
    if (!activeBoundary || !editEnabled) return;
    setDraftFeatures((prev) => ({
      ...prev,
      basins: mapBoundaryCollection(prev.basins, (b) => ({ ...b, points_px: [...b.points_px, point], certainty: 'edited in browser prototype' })),
      biomes: mapBoundaryCollection(prev.biomes, (b) => ({ ...b, points_px: [...b.points_px, point], certainty: 'edited in browser prototype' })),
    }));
    setSelected({ name: activeBoundary.name, category: activeBoundary.type ?? 'boundary', detail: `Added boundary point [${point[0]}, ${point[1]}]. Export JSON to persist it.`, center: point });
  };
  const deleteSelectedBoundaryPoint = () => {
    if (!activeBoundary || selectedBoundaryPointIndex === null || activeBoundary.points_px.length <= 3) return;
    const removed = activeBoundary.points_px[selectedBoundaryPointIndex];
    setDraftFeatures((prev) => ({
      ...prev,
      basins: mapBoundaryCollection(prev.basins, (b) => ({ ...b, points_px: b.points_px.filter((_, i) => i !== selectedBoundaryPointIndex), certainty: 'edited in browser prototype' })),
      biomes: mapBoundaryCollection(prev.biomes, (b) => ({ ...b, points_px: b.points_px.filter((_, i) => i !== selectedBoundaryPointIndex), certainty: 'edited in browser prototype' })),
    }));
    setSelected({ name: activeBoundary.name, category: activeBoundary.type ?? 'boundary', detail: `Deleted boundary point ${selectedBoundaryPointIndex + 1} at source-pixel [${removed[0]}, ${removed[1]}]. Export JSON to persist it.`, center: removed });
    setSelectedBoundaryPointIndex(null);
  };
  const exportJson = JSON.stringify(draftFeatures, null, 2);
  const downloadDraft = () => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prototype-features.draft.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const resetDraft = () => {
    window.localStorage.removeItem('malazan-atlas-draft-features');
    setDraftFeatures(data.features);
    setActiveRiverId(data.features.rivers[0]?.id ?? '');
    setActiveBoundaryId(data.features.basins[0]?.id ?? data.features.biomes[0]?.id ?? '');
    setSelectedPointIndex(null);
    setSelectedBoundaryPointIndex(null);
    setSelected({ name: 'Trace draft reset', category: 'authoring', detail: 'Returned to checked-in prototype feature data.' });
  };
  return (
    <section className="trace-studio">
      <div className="trace-panel">
        <div className="trace-header">
          <div>
            <span className="eyebrow">River / terrain authoring mode</span>
            <h2>Genabackis tracing desk</h2>
          </div>
          <button onClick={onClose}>Back to 3D board</button>
        </div>
        <p className="trace-copy">This is now an actual draft authoring surface: pick a river, click the source atlas to append exact pixel-coordinate points, drag/delete selected handles, undo if needed, then copy the generated JSON back into <code>prototype-features.json</code>.</p>
        <div className="trace-toolbar trace-toolbar-grouped">
          <div className="tool-group tool-selectors">
            <span className="tool-group-title">Targets</span>
            <label>River
              <select value={activeRiverId} onChange={(e) => setActiveRiverId(e.target.value)}>
                {draftFeatures.rivers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label>Boundary
              <select value={activeBoundaryId} onChange={(e) => { setActiveBoundaryId(e.target.value); setSelectedBoundaryPointIndex(null); }}>
                {boundaryOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          </div>
          <div className="tool-group">
            <span className="tool-group-title">Edit</span>
            <button className={editEnabled ? 'tool-on' : ''} onClick={() => setEditEnabled((v) => !v)}>{editEnabled ? 'Click/add/drag ON' : 'Editing OFF'}</button>
            <button onClick={() => appendRiverPoint([Math.round(view.x + view.w * 0.76), Math.round(view.y + view.h * 0.58)])}>Add river point</button>
            <button onClick={() => appendBoundaryPoint([Math.round(view.x + view.w * 0.50), Math.round(view.y + view.h * 0.50)])}>Add boundary point</button>
          </div>
          <div className="tool-group danger-group">
            <span className="tool-group-title">Repair</span>
            <button onClick={undoRiverPoint}>Undo river</button>
            <button disabled={selectedPointIndex === null || (activeRiver?.points_px.length ?? 0) <= 2} onClick={deleteSelectedPoint}>Delete river pt</button>
            <button disabled={selectedBoundaryPointIndex === null || (activeBoundary?.points_px.length ?? 0) <= 3} onClick={deleteSelectedBoundaryPoint}>Delete boundary pt</button>
          </div>
          <div className="tool-group save-group">
            <span className="tool-group-title">Draft</span>
            <button onClick={downloadDraft}>Download JSON</button>
            <button onClick={resetDraft}>Reset draft</button>
          </div>
          <div className="tool-status">
            <span>{activeRiver?.points_px.length ?? 0} river pts{selectedPointIndex !== null ? ` • river pt ${selectedPointIndex + 1}` : ''} · {activeBoundary?.points_px.length ?? 0} boundary pts{selectedBoundaryPointIndex !== null ? ` • boundary pt ${selectedBoundaryPointIndex + 1}` : ''}</span>
            <span className="coord-readout">{hoverPoint ? `cursor [${hoverPoint[0]}, ${hoverPoint[1]}]` : 'cursor [—, —]'}</span>
          </div>
        </div>
        <div className="trace-map-wrap">
          <svg ref={svgRef} className="trace-map" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" onMouseMove={(e) => { const point = svgPointFromEvent(e); setHoverPoint(point); if (point && dragPointIndex !== null) updateRiverPoint(dragPointIndex, point); if (point && dragBoundaryPointIndex !== null) updateBoundaryPoint(dragBoundaryPointIndex, point); }} onMouseUp={() => { setDragPointIndex(null); setDragBoundaryPointIndex(null); }} onMouseLeave={() => { setHoverPoint(null); setDragPointIndex(null); setDragBoundaryPointIndex(null); }} onClick={(e) => { if (justDraggedRef.current) { justDraggedRef.current = false; return; } const point = svgPointFromEvent(e); if (point) appendRiverPoint(point); }}>
            <image href={`${BASE}assets/worldofmalazan-z3-mosaic.png`} x="0" y="0" width={MAP_W} height={MAP_H} opacity="0.92" />
            <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="rgba(18,24,30,.08)" stroke="rgba(255,226,166,.5)" strokeWidth="7" rx="28" />
            {draftFeatures.basins.map((b) => <polygon key={b.id} points={b.points_px.map((p) => p.join(',')).join(' ')} fill={selectedName === b.name || activeBoundaryId === b.id ? 'rgba(255,209,102,.34)' : 'rgba(117,255,190,.18)'} stroke={selectedName === b.name || activeBoundaryId === b.id ? '#ffd166' : '#7effbe'} strokeWidth="8" strokeLinejoin="round" onClick={(e) => { e.stopPropagation(); selectPoly(b); }} />)}
            {draftFeatures.biomes.map((b) => <polygon key={b.id} points={b.points_px.map((p) => p.join(',')).join(' ')} fill={b.type === 'lake' ? 'rgba(64,210,255,.34)' : b.type === 'forest' ? 'rgba(68,180,92,.25)' : 'rgba(180,137,76,.25)'} stroke={selectedName === b.name || activeBoundaryId === b.id ? '#fff0a6' : 'rgba(255,255,255,.55)'} strokeWidth="5" strokeLinejoin="round" onClick={(e) => { e.stopPropagation(); selectPoly(b); }} />)}
            {draftFeatures.rivers.map((r) => <g key={r.id}>
              <polyline points={r.points_px.map((p) => p.join(',')).join(' ')} fill="none" stroke={selectedName === r.name || activeRiverId === r.id ? '#ffffff' : r.rank === 1 ? '#42e8ff' : '#77a8ff'} strokeWidth={selectedName === r.name || activeRiverId === r.id ? 18 : r.rank === 1 ? 12 : 8} strokeLinecap="round" strokeLinejoin="round" onClick={(e) => { e.stopPropagation(); selectRiver(r); }} />
              {activeRiverId === r.id && r.points_px.map((pt, idx) => <circle key={`${r.id}-${idx}`} className="trace-point-handle" cx={pt[0]} cy={pt[1]} r={selectedPointIndex === idx ? 20 : idx === r.points_px.length - 1 ? 18 : 12} fill={selectedPointIndex === idx ? '#ff9f7b' : idx === r.points_px.length - 1 ? '#fff0a6' : '#10151a'} stroke={selectedPointIndex === idx ? '#fff0a6' : '#42e8ff'} strokeWidth="5" onMouseDown={(e) => { e.stopPropagation(); selectRiver(r); setSelectedPointIndex(idx); setDragPointIndex(idx); }} onClick={(e) => { e.stopPropagation(); selectRiver(r); setSelectedPointIndex(idx); }} />)}
            </g>)}
            {activeBoundary && activeBoundary.points_px.map((pt, idx) => <circle key={`boundary-${activeBoundary.id}-${idx}`} className="trace-boundary-handle" cx={pt[0]} cy={pt[1]} r={selectedBoundaryPointIndex === idx ? 18 : 11} fill={selectedBoundaryPointIndex === idx ? '#ff9f7b' : '#7effbe'} stroke={selectedBoundaryPointIndex === idx ? '#fff0a6' : '#0d1711'} strokeWidth="5" onMouseDown={(e) => { e.stopPropagation(); selectPoly(activeBoundary); setSelectedBoundaryPointIndex(idx); setDragBoundaryPointIndex(idx); }} onClick={(e) => { e.stopPropagation(); selectPoly(activeBoundary); setSelectedBoundaryPointIndex(idx); }} />)}
            {hoverPoint && editEnabled && <>
              <line x1={hoverPoint[0]} y1={view.y} x2={hoverPoint[0]} y2={view.y + view.h} stroke="rgba(255,240,166,.72)" strokeWidth="3" strokeDasharray="14 18" pointerEvents="none" />
              <line x1={view.x} y1={hoverPoint[1]} x2={view.x + view.w} y2={hoverPoint[1]} stroke="rgba(255,240,166,.72)" strokeWidth="3" strokeDasharray="14 18" pointerEvents="none" />
              <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="18" fill="rgba(255,240,166,.18)" stroke="#fff0a6" strokeWidth="5" pointerEvents="none" />
              <text x={Math.min(hoverPoint[0] + 28, view.x + view.w - 230)} y={Math.max(hoverPoint[1] - 22, view.y + 44)} fill="#fff8df" stroke="#211407" strokeWidth="5" paintOrder="stroke" fontSize="34" fontWeight="800" pointerEvents="none">[{hoverPoint[0]}, {hoverPoint[1]}]</text>
            </>}
            {places.map((p) => <g key={p.name} onClick={(e) => { e.stopPropagation(); setSelected({ name: p.name, category: p.category, detail: `${p.kind} • source coordinate [${Math.round(p.center[0])}, ${Math.round(p.center[1])}]`, center: p.center }); }}>
              <circle cx={p.center[0]} cy={p.center[1]} r={selectedName === p.name ? 22 : p.importance >= 3 ? 16 : 11} fill={selectedName === p.name ? '#fff0a6' : '#ffb85c'} stroke="#23160a" strokeWidth="5" />
              {(p.importance >= 3 || selectedName === p.name) && <text x={p.center[0] + 24} y={p.center[1] - 12} fill="#fff8df" stroke="#211407" strokeWidth="5" paintOrder="stroke" fontSize="38" fontWeight="700">{p.name}</text>}
            </g>)}
          </svg>
        </div>
        <div className="trace-columns trace-columns-3">
          <div><h3>Rivers to refine</h3>{draftFeatures.rivers.map((r) => <button key={r.id} className={activeRiverId === r.id ? 'active-row' : ''} onClick={() => selectRiver(r)}>{r.name}<span>{r.points_px.length} pts</span></button>)}</div>
          <div><h3>Terrain boundaries</h3>{[...draftFeatures.basins, ...draftFeatures.biomes].map((b) => <button key={b.id} className={selectedName === b.name ? 'active-row' : ''} onClick={() => selectPoly(b)}>{b.name}<span>{b.points_px.length} pts</span></button>)}</div>
          <div><h3>Draft JSON export</h3><textarea className="trace-json" readOnly value={exportJson} onFocus={(e) => e.currentTarget.select()} /><p className="trace-note">Draft auto-saves in this browser. Download JSON or select/copy this export to persist it into <code>public/data/prototype-features.json</code>.</p></div>
        </div>
      </div>
    </section>
  );
}



function CompassScale() {
  return (
    <div className="compass-scale">
      <div className="compass-rose" aria-hidden="true">
        <span className="north">N</span>
        <span className="east">E</span>
        <span className="south">S</span>
        <span className="west">W</span>
        <i />
      </div>
      <div className="scale-ribbon">
        <b>World board scale</b>
        <span>10,000 × 5,571 source pixels</span>
        <div className="scale-bar"><em /><em /><em /></div>
        <small>Exact-pixel fantasy cartography</small>
      </div>
    </div>
  );
}

function AtlasLegend({ onSelect }: { onSelect: (s: Selected) => void }) {
  return (
    <aside className="hud atlas-legend">
      <div className="legend-title"><Sparkles size={14}/> Map key</div>
      <div className="legend-grid">
        {LEGEND_ITEMS.map((item) => (
          <button key={item.key} onClick={() => onSelect({ name: item.label, category: 'legend', detail: item.copy })}>
            <span className={`legend-swatch ${item.swatch}`} />
            <b>{item.label}</b>
            <small>{item.copy}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function App() {
  const data = useAtlasData();
  const [selected, setSelected] = useState<Selected | null>({ name: 'Source Map Fidelity Mode', category: 'atlas', detail: 'Default view now prioritizes the exact World of Malazan source map. Stylized landmarks are off until they can be traced and placed correctly.', center: [5000, 2785] });
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [traceMode, setTraceMode] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [tourMode, setTourMode] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [focus, setFocus] = useState<FocusBookmark>(BOOKMARKS[0]);
  const [layers, setLayers] = useState({ source: true, pins: true, rivers: true, boundaries: true, landmarks: false, clouds: false, cinematic: false });
  const toggle = (key: keyof typeof layers) => setLayers((l) => ({ ...l, [key]: !l[key] }));
  const sceneLayers = presentationMode ? { ...layers, pins: false } : layers;
  const stats = useMemo(() => data ? [
    ['Source map', `${data.locations.imageWidth}×${data.locations.imageHeight}`],
    ['Locations', `${data.locations.locationsCount}`],
    ['Filtered', categoryFilter === 'all' ? 'all' : categoryFilter],
    ['Rivers', `${data.features.rivers.length} prototype`],
    ['Basins', `${data.features.basins.length} prototype`],
  ] : [], [data, categoryFilter]);
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!data || q.length < 2) return [];
    return data.locations.locations
      .filter((l) => categoryFilter === 'all' || l.category === categoryFilter)
      .filter((l) => l.name.toLowerCase().includes(q) || l.category.toLowerCase().includes(q) || l.kind.toLowerCase().includes(q))
      .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name))
      .slice(0, 7);
  }, [data, search, categoryFilter]);
  const selectLocation = (l: Location) => {
    setTourMode(false);
    setSelected({ name: l.name, category: l.category, detail: `${l.kind} • ${l.category} • exact source coordinate [${Math.round(l.center[0])}, ${Math.round(l.center[1])}]`, center: l.center });
    setFocus({ id: `search-${l.name}`, label: l.name, center: l.center, distance: l.importance >= 3 ? 2.8 : 3.4, height: l.importance >= 3 ? 2.15 : 2.65, yaw: 0.78, note: `Search focus for ${l.name}.` });
  };
  useEffect(() => {
    if (!tourMode) return;
    const bookmark = BOOKMARKS[tourIndex % BOOKMARKS.length];
    setFocus(bookmark);
    setSelected({ name: bookmark.label, category: 'guided tour', detail: bookmark.note, center: bookmark.center });
    const id = window.setInterval(() => {
      setTourIndex((i) => (i + 1) % BOOKMARKS.length);
    }, 4300);
    return () => window.clearInterval(id);
  }, [tourMode, tourIndex]);
  return (
    <main className={`app-shell ${presentationMode ? 'presenting' : ''} ${traceMode ? 'trace-open' : ''}`}>
      <button className="presentation-toggle" onClick={() => setPresentationMode((v) => !v)}>{presentationMode ? 'Exit presentation' : 'Presentation mode'}</button>
      <button className={`tour-toggle ${tourMode ? 'on' : ''}`} onClick={() => { setTourMode((v) => !v); setPresentationMode(true); }}>{tourMode ? 'Stop tour' : 'Guided tour'}</button>
      <section className="viewport">
        {data ? (layers.landmarks ? <Canvas shadows camera={{ position: [6.8, 8.7, 8.6], fov: 43 }} dpr={[1, 1.8]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
          <Suspense fallback={null}>
            <AtlasScene data={data} selected={selected} setSelected={setSelected} search={search} categoryFilter={categoryFilter} layers={sceneLayers} focus={focus} showCallout={!traceMode} />
          </Suspense>
        </Canvas> : <SourceAtlas2D data={data} selected={selected} setSelected={setSelected} search={search} categoryFilter={categoryFilter} layers={sceneLayers} />) : <div className="loading">Loading exact source atlas…</div>}
      </section>
      <aside className="hud top-left">
        <div className="brand"><Sparkles size={18}/><div><b>The Atlas</b><span>Malazan world-board prototype</span></div></div>
        <label className="search"><Search size={15}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search places, seas, forests…" /></label>
        <div className="category-filters">{CATEGORY_FILTERS.map((c) => <button key={c} className={categoryFilter === c ? 'active' : ''} onClick={() => setCategoryFilter(c)}>{c}</button>)}</div>
        {searchResults.length > 0 && <div className="search-results">
          {searchResults.map((l) => <button key={`${l.name}-${l.center.join('-')}`} onClick={() => selectLocation(l)}><b>{l.name}</b><span>{l.category} • {l.kind}</span></button>)}
        </div>}
        <button className="trace-launch" onClick={() => setTraceMode(true)}>Open river tracing desk</button>
        <button className="presentation-launch" onClick={() => setPresentationMode(true)}>Clean screenshot view</button>
        <button className={`presentation-launch ${tourMode ? 'tour-on' : ''}`} onClick={() => { setTourMode((v) => !v); setPresentationMode(true); }}>{tourMode ? 'Stop guided tour' : 'Start guided tour'}</button>
        <div className="bookmarks">
          <span>Camera bookmarks</span>
          {BOOKMARKS.map((b) => <button key={b.id} className={focus.id === b.id ? 'active' : ''} onClick={() => { setTourMode(false); setFocus(b); setSelected({ name: b.label, category: 'camera focus', detail: b.note, center: b.center }); }}>{b.label}</button>)}
        </div>
      </aside>
      <aside className="hud top-right layers">
        <h3><Layers size={16}/> Layers</h3>
        {([
          ['source','Source map fidelity'], ['pins','Location pins'], ['rivers','Traced rivers'], ['boundaries','Biomes/basins'], ['landmarks','Stylized landmarks'], ['clouds','Clouds'], ['cinematic','DOF/Bloom']
        ] as Array<[keyof typeof layers,string]>).map(([k,label]) => <button key={k} className={layers[k] ? 'on' : ''} onClick={() => toggle(k)}>{label}</button>)}
      </aside>
      <aside className="hud bottom-left">
        <h2>Cute-but-cool scale map</h2>
        <p>Exact pixel-coordinate world board with provisional river/basin authoring around Genabackis. Geography first, lore overlays later.</p>
        <CompassScale />
        <div className="stat-grid">{stats.map(([k,v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      </aside>
      <aside className="hud bottom-right selected-card">
        {selected ? <>
          <div className="pill">{selected.category}</div>
          <h2>{selected.name}</h2>
          <p>{selected.detail}</p>
          <div className="mini-icons"><MapPin/><Waves/><Mountain/><Trees/><Cloud/></div>
        </> : <p>Select a marker, river, or basin.</p>}
      </aside>
      <AtlasLegend onSelect={setSelected} />
      {presentationMode && selected && <div className="tour-caption">
        <span>{tourMode ? 'Guided atlas tour' : 'Presentation view'}</span>
        <b>{selected.name}</b>
        <p>{selected.detail}</p>
      </div>}
      {traceMode && data && <TraceStudio data={data} selected={selected} setSelected={setSelected} onClose={() => setTraceMode(false)} />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
