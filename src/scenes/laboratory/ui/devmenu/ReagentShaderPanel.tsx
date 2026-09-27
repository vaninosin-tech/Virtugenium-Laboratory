import { useReagentShaderTuningStore, type ShaderTuning } from "../../lib/useReagentShaderTuningStore";
import { useRuntimeQualityStore, type QualityMode } from "../../lib/useRuntimeQualityStore";

const controls: { key: keyof ShaderTuning; label: string; max: number; min?: number }[] = [
  { key: "transparency", label: "Glass transparency", max: 1 },
  { key: "roughness", label: "Glass roughness", max: 1 },
  { key: "fresnelStrength", label: "Fresnel strength", max: 1 },
  { key: "fresnelPower", label: "Fresnel power", min: 0.5, max: 8 },
  { key: "amberAbsorption", label: "Amber absorption", max: 1 },
  { key: "opacity", label: "Liquid opacity", max: 1 },
  { key: "depthStrength", label: "Liquid depth", max: 1 },
  { key: "fresnelLiquid", label: "Liquid Fresnel", max: 1 },
  { key: "distortionStrength", label: "Liquid distortion", max: 0.1 },
  { key: "turbulenceStrength", label: "Liquid turbulence", max: 1 },
  { key: "cloudiness", label: "Cloudiness", max: 1 },
  { key: "reactionMix", label: "Reaction progress", max: 1 },
];

export function ReagentShaderPanel() {
  const { enabled, values, setEnabled, setValue, reset } = useReagentShaderTuningStore();
  const qualityMode = useRuntimeQualityStore((state) => state.mode);
  const setQualityMode = useRuntimeQualityStore((state) => state.setMode);
  if (!import.meta.env.DEV) return null;
  return <div style={{ display: "grid", gap: 7, maxHeight: "65vh", overflowY: "auto" }}>
    <label>Quality <select value={qualityMode} onChange={(e) => setQualityMode(e.target.value as QualityMode)}>
      {(["AUTO", "LOW", "MEDIUM", "HIGH", "ULTRA"] as QualityMode[]).map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Preview overrides</label>
    <small>Applies to all bottles. Disable to restore reagent values. Saved locally; preview starts off.</small>
    <fieldset disabled={!enabled} style={{ border: 0, padding: 0, margin: 0 }}>
      {controls.map(({ key, label, min = 0, max }) => <label key={key} style={{ display: "grid", marginTop: 6 }}>
        <span>{label}: {Number(values[key]).toFixed(2)}</span>
        <input aria-label={label} type="range" min={min} max={max} step={0.01} value={values[key]}
          onChange={(e) => setValue(key, Number(e.target.value))} />
      </label>)}
      <label>Reaction color <input aria-label="Reaction color" type="color" value={values.reactionColor}
        onChange={(e) => setValue("reactionColor", e.target.value)} /></label>
    </fieldset>
    <button onClick={reset}>Reset shader calibration</button>
  </div>;
}
