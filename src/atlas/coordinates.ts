import { MAX_ZOOM, SOURCE_HEIGHT, SOURCE_WIDTH, TILE_SIZE, type SourcePoint } from './constants';

export function sourceToMap([x, y]: SourcePoint): SourcePoint {
  return [x, SOURCE_HEIGHT - y];
}

export function mapToSource([x, y]: SourcePoint): SourcePoint {
  return [Math.round(x), Math.round(SOURCE_HEIGHT - y)];
}

export function sourceToTile(point: SourcePoint, z = MAX_ZOOM): [number, number] {
  const scale = 2 ** (MAX_ZOOM - z);
  return [Math.floor(point[0] / scale / TILE_SIZE), Math.floor(point[1] / scale / TILE_SIZE)];
}

export function tileGridSize(z = MAX_ZOOM): [number, number] {
  const scale = 2 ** (MAX_ZOOM - z);
  return [Math.ceil(SOURCE_WIDTH / scale / TILE_SIZE), Math.ceil(SOURCE_HEIGHT / scale / TILE_SIZE)];
}

export function inSourceBounds([x, y]: SourcePoint): boolean {
  return x >= 0 && x <= SOURCE_WIDTH && y >= 0 && y <= SOURCE_HEIGHT;
}
