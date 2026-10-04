import { createContext } from "react";

/**
 * Folds the tablet away the same way its own close button does — giving the
 * scene its controls back in the same click (`TabletOverlay`'s `handleClose`).
 * For buttons deep inside a tab that send the player back to the lab.
 */
export const TabletCloseContext = createContext<(() => void) | null>(null);
