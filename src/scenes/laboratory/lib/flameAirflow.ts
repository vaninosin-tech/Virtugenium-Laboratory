/** Airflow around the spirit lamp. Distances are in the hood's local metres. */
export interface FlameAirflowInput {
  readonly inHood: boolean;
  readonly fanOn: boolean;
  /** Distance from the front worktop edge (hood local Z = 0.35). */
  readonly d: number;
  /** Fan transition, 0 = still air and 1 = full extraction. */
  readonly transition: number;
  /** Continuous seconds spent by the sash with extraction running. */
  readonly nearSeconds: number;
}

export interface FlameAirflow {
  readonly tiltRad: number;
  /** Horizontal direction in hood coordinates, toward its rear wall. */
  readonly tiltDir: readonly [number, number];
  readonly heightScale: number;
  readonly flickerHz: number;
  readonly flickerAmp: number;
  readonly raggedness: number;
  readonly detachment: number;
  readonly blowOut: boolean;
}

export const HOT_ZONE = { radius: 0.008, start: 0.6, end: 1.0 } as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Pure target model; the caller advances `transition` over one second. */
export function flameAirflow(input: FlameAirflowInput): FlameAirflow {
  const near = input.d < 0.15;
  const mix = input.inHood ? clamp01(input.transition) : 0;
  const tilt = (near ? 25 : 12.5) * Math.PI / 180;
  return {
    tiltRad: tilt * mix,
    tiltDir: [0, -1],
    heightScale: 1 - (near ? 0.08 : 0.1) * mix,
    flickerHz: 2.2 + (near ? 4.8 : 2.2) * mix,
    flickerAmp: 0.05 + (near ? 0.2 : 0.07) * mix,
    raggedness: near ? mix : 0,
    detachment: near ? mix * clamp01((input.nearSeconds - 4) / 1) : 0,
    blowOut: input.inHood && input.fanOn && near && input.nearSeconds >= 5,
  };
}

/** Centre and unit axis of the upper-third heating cylinder in hood coordinates. */
export function flameHotZone(baseY: number, height: number, airflow: FlameAirflow) {
  const axis = {
    x: airflow.tiltDir[0] * Math.sin(airflow.tiltRad),
    y: Math.cos(airflow.tiltRad),
    z: airflow.tiltDir[1] * Math.sin(airflow.tiltRad),
  };
  const length = height * airflow.heightScale;
  const point = {
    x: axis.x * length * (HOT_ZONE.start + HOT_ZONE.end) / 2,
    y: baseY + axis.y * length * (HOT_ZONE.start + HOT_ZONE.end) / 2,
    z: axis.z * length * (HOT_ZONE.start + HOT_ZONE.end) / 2,
  };
  return { point, axis, radius: HOT_ZONE.radius, length: length * (HOT_ZONE.end - HOT_ZONE.start) };
}
