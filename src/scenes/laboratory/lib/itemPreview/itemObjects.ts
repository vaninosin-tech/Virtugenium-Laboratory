import type * as THREE from "three";

/**
 * The scene objects hover previews take their shape from, keyed by instance
 * id. Items register themselves on mount (`PourMotion`) — the preview never
 * searches the scene.
 */
export interface PreviewItemObject {
  /** The item's root: its origin is its base at rest. */
  readonly object: THREE.Object3D;
  /** Its mouth above its base, at the scale it is drawn. */
  readonly mouthHeight: number;
}

const items = new Map<string, PreviewItemObject>();

/** Returns the unregister function. */
export function registerPreviewItem(id: string, entry: PreviewItemObject): () => void {
  items.set(id, entry);
  return () => {
    // A remount may have registered a newer entry under the same id.
    if (items.get(id) === entry) items.delete(id);
  };
}

/**
 * Items standing on the tray, apart from the above: the table keeps a
 * prewarmed copy of every jar under the SAME id while it rides the tray, so
 * one id can be two objects, and where an item is on the tray (where an
 * unload flies it from) must not be answered by the other one. The tray is
 * mounted twice (table, held): the copy that is shown is the one that counts.
 */
const trayItems = new Map<string, Set<THREE.Object3D>>();

export function registerTrayItem(id: string, object: THREE.Object3D): () => void {
  const set = trayItems.get(id) ?? new Set<THREE.Object3D>();
  set.add(object);
  trayItems.set(id, set);
  return () => {
    set.delete(object);
    if (set.size === 0 && trayItems.get(id) === set) trayItems.delete(id);
  };
}

/** The tray copies of `id` — usually one shown, one hidden. */
export const getTrayItemObjects = (id: string): ReadonlySet<THREE.Object3D> | undefined => trayItems.get(id);

export const getPreviewItem = (id: string): PreviewItemObject | undefined => items.get(id);
