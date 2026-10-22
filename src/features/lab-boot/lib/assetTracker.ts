import { DefaultLoadingManager } from "three";

/**
 * Per-file record of what three.js has finished loading, for the lab loading
 * screen's stages. drei's `useProgress` only keeps the LAST item, and the
 * scene's `useGLTF.preload` calls start downloading as soon as the lab module
 * is imported (often while the player is still in the main menu), so the
 * screen can't just start listening when it mounts — this module must be
 * imported before anything else (first line of `main.tsx`).
 *
 * It wraps the default manager's own `itemStart`/`itemEnd`/`itemError`
 * instead of its `onStart`/`onProgress` callbacks, which drei already owns.
 */
const finished = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

/** "/assets/models/LabRoom.glb?x=1" -> "LabRoom.glb" */
function fileName(url: string): string {
  const path = url.split(/[?#]/)[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

type TrackedManager = typeof DefaultLoadingManager & { __vgAssetTracker?: true };
const manager = DefaultLoadingManager as TrackedManager;

if (!manager.__vgAssetTracker) {
  manager.__vgAssetTracker = true;
  const itemEnd = manager.itemEnd.bind(manager);
  const itemError = manager.itemError.bind(manager);

  manager.itemEnd = (url: string) => {
    itemEnd(url);
    finished.add(fileName(url));
    emit();
  };
  // A failed file must not hang its loading stage forever.
  manager.itemError = (url: string) => {
    itemError(url);
    finished.add(fileName(url));
    emit();
  };
}

export function isAssetFinished(name: string): boolean {
  return finished.has(name);
}

/** `useSyncExternalStore` pair: re-render whenever another file finishes. */
export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAssetsVersion(): number {
  return version;
}
