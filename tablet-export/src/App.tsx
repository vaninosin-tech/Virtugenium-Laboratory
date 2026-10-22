import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";

import { useLaboratoryStore } from "./stores/laboratory/useLaboratoryStore";
import { Tablet } from "./features/tablet/ui/Tablet";

/**
 * Stand-in for the 3D lab scene (`scenes/laboratory/ui/Laboratory.tsx` in
 * the full project) — just a black backdrop so the tablet's own layout is
 * visible in isolation. `Tablet` normally mounts once at the scene root.
 */
const DEMO_EXPERIMENT_ID = "experiment-copper-nitric-acid";
const DEMO_FIRST_STEP_ID = "step-1-safety";

export default function App() {
  const selectExperiment = useLaboratoryStore((state) => state.selectExperiment);
  const setCurrentStep = useLaboratoryStore((state) => state.setCurrentStep);

  useEffect(() => {
    selectExperiment(DEMO_EXPERIMENT_ID);
    setCurrentStep(DEMO_FIRST_STEP_ID);
  }, [selectExperiment, setCurrentStep]);

  return (
    <BrowserRouter>
      <div style={{ position: "fixed", inset: 0, background: "#000" }}>
        <Tablet />
      </div>
    </BrowserRouter>
  );
}
