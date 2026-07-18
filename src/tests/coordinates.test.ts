import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, SOURCE_HEIGHT, SOURCE_WIDTH } from '../atlas/constants';
import { inSourceBounds, mapToSource, sourceToMap, sourceToTile, tileGridSize } from '../atlas/coordinates';

describe('source-pixel coordinate transforms', () => {
  it('round-trips source coordinates through OpenLayers map coordinates', () => {
    const darujhistan: [number, number] = [6782, 1527];
    expect(sourceToMap(darujhistan)).toEqual([6782, SOURCE_HEIGHT - 1527]);
    expect(mapToSource(sourceToMap(darujhistan))).toEqual(darujhistan);
  });

  it('keeps canonical bounds explicit', () => {
    expect(SOURCE_WIDTH).toBe(10000);
    expect(SOURCE_HEIGHT).toBe(5571);
    expect(inSourceBounds([0, 0])).toBe(true);
    expect(inSourceBounds([10000, 5571])).toBe(true);
    expect(inSourceBounds([-1, 0])).toBe(false);
    expect(inSourceBounds([10001, 0])).toBe(false);
  });

  it('computes the 512px tile grid used by the generated native z6 pyramid', () => {
    expect(MAX_ZOOM).toBe(6);
    expect(tileGridSize(6)).toEqual([20, 11]);
    expect(tileGridSize(5)).toEqual([10, 6]);
    expect(tileGridSize(0)).toEqual([1, 1]);
    expect(sourceToTile([6782, 1527], 6)).toEqual([13, 2]);
  });
});
