import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRIMARY_KEY = "virtugenium.cameraCalibration.v1";
const BACKUP_KEY = "virtugenium.cameraCalibration.backup.v1";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
}

describe("camera calibration backup", () => {
  let storage: Storage;

  beforeEach(() => {
    vi.resetModules();
    storage = createStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a deleted primary record from the backup", async () => {
    const saved = {
      table: {
        position: [1.25, 2.5, 3.75],
        target: [0.5, 1.5, -2.5],
        fov: 51,
      },
    };
    storage.setItem(BACKUP_KEY, JSON.stringify(saved));

    const { useCameraCalibrationStore } = await import(
      "../src/scenes/laboratory/lib/useCameraCalibrationStore"
    );

    expect(useCameraCalibrationStore.getState().committed.table).toEqual(saved.table);
    expect(JSON.parse(storage.getItem(PRIMARY_KEY) ?? "null")).toEqual(saved);
  });

  it("writes every saved camera pose to both records", async () => {
    const { useCameraCalibrationStore } = await import(
      "../src/scenes/laboratory/lib/useCameraCalibrationStore"
    );

    useCameraCalibrationStore.getState().save();

    expect(storage.getItem(PRIMARY_KEY)).not.toBeNull();
    expect(storage.getItem(BACKUP_KEY)).toBe(storage.getItem(PRIMARY_KEY));
  });
});
