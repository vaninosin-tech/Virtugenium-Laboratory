import { describe, expect, it } from 'vitest';
import { conservedBottleLevel } from '../src/scenes/laboratory/lib/reagentMaterials';

describe('bottle liquid surface', () => {
  it.each([0, 30, 60])('keeps volume at %i degrees while the surface stays level', degrees => {
    const fill = 0.65, radius = 0.03, height = 0.09;
    const slope = Math.tan(degrees * Math.PI / 180);
    const center = conservedBottleLevel(fill, slope, 0, radius, radius, height) * height;
    let volumeFraction = 0;
    const rings = 24, sectors = 64;
    for (let ring = 0; ring < rings; ring++) {
      const r = Math.sqrt((ring + 0.5) / rings);
      for (let sector = 0; sector < sectors; sector++) {
        const angle = (sector + 0.5) * 2 * Math.PI / sectors;
        volumeFraction += Math.max(0, Math.min(height,
          center - slope * radius * r * Math.cos(angle)));
      }
    }
    volumeFraction /= rings * sectors * height;
    expect(Math.abs(volumeFraction - fill)).toBeLessThan(0.01);
  });
});
