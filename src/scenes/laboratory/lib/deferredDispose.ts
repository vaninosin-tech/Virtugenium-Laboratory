interface PendingDisposal {
  readonly handle: number;
  readonly cancel: (handle: number) => void;
}

const pendingDisposals = new WeakMap<object, PendingDisposal>();

/**
 * Cancel a queued disposal when React StrictMode immediately remounts the
 * same resource. This keeps deferred cleanup safe in development as well as
 * in production.
 */
export function cancelDeferredDispose(key: object): void {
  const pending = pendingDisposals.get(key);
  if (!pending) return;
  pending.cancel(pending.handle);
  pendingDisposals.delete(key);
}

/**
 * Resource destruction can make a React commit visibly hitch when several
 * reagent copies leave the tray together. Move that non-visual cleanup to
 * browser idle time; the timeout still guarantees eventual release.
 */
export function deferDispose(key: object, dispose: () => void): void {
  cancelDeferredDispose(key);
  if (typeof window === "undefined") {
    dispose();
    return;
  }

  const run = () => {
    pendingDisposals.delete(key);
    dispose();
  };

  if (typeof window.requestIdleCallback === "function" && typeof window.cancelIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 1_000 });
    pendingDisposals.set(key, {
      handle,
      cancel: window.cancelIdleCallback.bind(window),
    });
    return;
  }

  const handle = window.setTimeout(run, 50);
  pendingDisposals.set(key, { handle, cancel: window.clearTimeout });
}
