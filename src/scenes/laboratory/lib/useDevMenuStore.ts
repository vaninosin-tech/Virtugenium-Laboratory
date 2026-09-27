import { create } from "zustand";

import type { FurnitureId } from "./useFurniturePositionStore";

/**
 * Which section of the unified F8 dev menu is showing. `furniture` is the
 * new click-to-position tab (cabinets/equipment/table); the rest each host
 * one of the pre-existing F9-F12 panels' content unchanged, just re-homed
 * under one shell/hotkey instead of their own standalone toggles.
 */
export type DevMenuCategory =
  | "lighting"
  | "shaders"
  | "camera"
  | "furniture"
  | "buttons"
  | "tray"
  | "stopper"
  | "reagent-area"
  | "tray-reagents";

export const DEV_MENU_TABS: readonly { id: DevMenuCategory; label: string }[] = [
  { id: "lighting", label: "Освещение" },
  { id: "shaders", label: "Glass / liquid" },
  { id: "camera", label: "🎥 Камера" },
  { id: "furniture", label: "🪑 Мебель" },
  { id: "buttons", label: "🔘 Кнопки / пробирка" },
  { id: "tray", label: "🧰 Поднос в руках" },
  { id: "stopper", label: "🧪 Держатели пробок" },
  { id: "reagent-area", label: "📦 Зона реагентов" },
  { id: "tray-reagents", label: "🧴 Реагенты на подносе" },
];

interface DevMenuState {
  readonly isOpen: boolean;
  readonly category: DevMenuCategory;
  readonly selectedFurnitureId: FurnitureId | null;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setCategory: (category: DevMenuCategory) => void;
  /** Click-to-select on a furniture piece in the 3D view — switches to the Мебель tab with that piece selected. */
  selectFurniture: (id: FurnitureId) => void;
}

/**
 * Single source of truth for the unified F8 dev menu (`DevMenuPanel`). Every
 * per-feature calibration store (`useCameraCalibrationStore`,
 * `useNavButtonCalibrationStore`, `useStopperHolderStore`,
 * `useWorkbenchReagentAreaStore`) keeps its own fields/setters/persistence
 * exactly as before — this store only owns which tab is showing and drives
 * each of those stores' `isOpen` from `category`, so `CameraRig`'s
 * pointer-lock guard only has to check ONE `isOpen` for every category
 * instead of one per panel.
 */
export const useDevMenuStore = create<DevMenuState>((set) => ({
  isOpen: false,
  category: "camera",
  selectedFurnitureId: null,

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (isOpen) => set({ isOpen }),
  setCategory: (category) => set({ category }),
  selectFurniture: (id) => set({ category: "furniture", selectedFurnitureId: id }),
}));
