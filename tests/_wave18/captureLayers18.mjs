// Four solid modes, four optics modes and three backgrounds at fixed simulation times.
// The existing capture tool also records a labelled 10x display-only sediment
// diagnostic at each time, leaving the physical simulation state untouched.
process.env.TIMES_MS ??= "3000,6000,9000,14000,20000";
process.env.SEDIMENT_DIAGNOSTIC_SCALE ??= "10";
process.env.OUT ??= "docs/night/wave18f4/browser";
await import("../_wave16/captureLayers.mjs");
