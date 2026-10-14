/** Shared tuning for the copper reaction and its three-dimensional liquid render. */
export const TUBE_SIMULATION = {
  jetFlow: {
    LOW: { width: 8, height: 18, depth: 8 },
    HIGH: { width: 12, height: 24, depth: 12 },
    pressureIterations: 6,
    viscousDamping: 0.26,
    molecularDiffusivity: 0.0000002,
    eddyDiffusivity: 0.00003,
  },
  field: {
    LOW: { width: 12, height: 24, depth: 12 },
    HIGH: { width: 22, height: 44, depth: 22 },
    stepSeconds: 1 / 20,
    baseDiffusivity: 0.000000002,
    heatDiffusivity: 0.000000008,
    gasDiffusivity: 0.0000001,
    completionDiffusivity: 0.00002,
    sourceWidths: [0.16, 0.25, 0.20],
    opticalDensityScale: 0.018,
    heatConvection: 0.00135,
  },
  render: { raySteps: 12, transportStepsLow: 6, transportStepsHigh: 16,
    copperSaturation: 2.3, copperSettledSaturation: 2.05 },
  bubbles: { capacity: 384, samplesPerNO: 8200, attachedSeconds: [0.9, 1.75] },
  gas: { oxygenDefault: true as boolean, noOxidationRate: 0.48 },
  barium: {
    // Artistic acceleration of size-dependent settling; chemistry stays local.
    settlingAcceleration: 4,
    settlingSpeeds: [0.0003, 0.00065, 0.0014],
    suspensionOpticalScale: 4.5,
    coarseMassFraction: 0.015,
    coarseSettlingSpeed: 0.0028,
  },
  silver: {
    settlingAcceleration: 1.5,
    settlingSpeeds: [0.00018, 0.00048, 0.00095],
    suspensionOpticalScale: 21,
    flocMassFraction: 0.78,
    coarseSettlingSpeed: 0.085,
  },
} as const;
