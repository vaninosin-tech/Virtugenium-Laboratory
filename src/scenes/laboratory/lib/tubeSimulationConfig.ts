/** Shared tuning for the copper reaction and its three-dimensional liquid render. */
export const TUBE_SIMULATION = {
  field: {
    LOW: { width: 16, height: 32, depth: 16 },
    HIGH: { width: 22, height: 44, depth: 22 },
    stepSeconds: 1 / 20,
    baseDiffusivity: 0.00000025,
    heatDiffusivity: 0.00000025,
    gasDiffusivity: 0.0000001,
    completionDiffusivity: 0.00002,
    sourceWidths: [0.16, 0.25, 0.20],
    opticalDensityScale: 0.018,
    heatConvection: 0.00135,
  },
  render: { raySteps: 12, transportStepsLow: 6, transportStepsHigh: 16,
    copperSaturation: 2.3, copperSettledSaturation: 2.05 },
  bubbles: { capacity: 384, samplesPerNO: 5400, attachedSeconds: [0.9, 1.75] },
  gas: { oxygenDefault: true as boolean, noOxidationRate: 0.48 },
  barium: {
    // Artistic acceleration of size-dependent settling; chemistry stays local.
    settlingAcceleration: 4,
    settlingSpeeds: [0.0003, 0.00065, 0.0014],
    suspensionOpticalScale: 2.8,
  },
} as const;
