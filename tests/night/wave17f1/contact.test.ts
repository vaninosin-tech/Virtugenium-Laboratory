import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOC_CONFIG, FlocSystem } from '../../../src/scenes/laboratory/lib/night/stage1/flocSystem';

describe('aggregate contact merger', () => {
  it('merges approaching, unlinked aggregates without changing solid mass', () => {
    const system = new FlocSystem({ ...DEFAULT_FLOC_CONFIG, radius: .007, bottom: 0, height: .055,
      eddyDiffusivity: 0 });
    expect(system.addMass(-.0045, .025, 0, .03)).toBe(true);
    expect(system.addMass(.0045, .025, 0, .03)).toBe(true);
    expect(system.nodes).toHaveLength(2);
    system.nodes[0].vx = .1;
    system.nodes[1].vx = -.1;
    const before = system.totalMass;
    system.step(.05, (_x, _y, _z, out) => { out[0] = out[1] = out[2] = 0; return true; });
    expect(system.nodes).toHaveLength(1);
    expect(system.totalMass).toBe(before);
  });
});
