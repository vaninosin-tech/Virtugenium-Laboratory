/** Skip native inputs so browser typing is not hijacked. */
export const isNativeTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  return target.isContentEditable;
};

export const readCapsLockFromEvent = (event: KeyboardEvent): boolean => {
  try {
    return event.getModifierState("CapsLock");
  } catch {
    return false;
  }
};

export const buildPhysicalCodeMap = <T extends { readonly id: string; readonly physical?: readonly string[] }>(
  keys: readonly T[],
): ReadonlyMap<string, T> => {
  const map = new Map<string, T>();
  for (const key of keys) {
    for (const code of key.physical ?? []) {
      map.set(code, key);
    }
  }
  return map;
};
