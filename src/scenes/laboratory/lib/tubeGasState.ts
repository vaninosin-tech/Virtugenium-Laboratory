/** Normalized R1 gas bookkeeping. One unit of extent produces two units of NO. */
export class GasState {
  producedNO = 0;
  no = 0;
  no2 = 0;
  oxygenAvailable = true;

  reset() { this.producedNO = this.no = this.no2 = 0; }

  advance(deltaExtent: number, dt: number) {
    const formed = 2 * Math.max(0, Number.isFinite(deltaExtent) ? deltaExtent : 0);
    this.producedNO += formed;
    this.no += formed;
    if (this.oxygenAvailable && dt > 0) {
      // eta is the extent of 2NO + O2 -> 2NO2. Ambient oxygen is a
      // separately controlled reservoir, so no conversion occurs when absent.
      const eta = Math.min(this.no / 2, this.no * Math.min(dt, 0.25) * 0.48);
      this.no -= 2 * eta;
      this.no2 += 2 * eta;
    }
  }
}

export const readDeveloperOxygen = () => {
  if (!import.meta.env.DEV || typeof window === "undefined") return true;
  try { return window.localStorage.getItem("virtugenium.no-oxygen.v1") !== "0"; }
  catch { return true; }
};

/** Developer console switch; the value persists across scene reloads. */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __tubeGasSettings: { oxygenAvailable: boolean } }).__tubeGasSettings = {
    get oxygenAvailable() { return readDeveloperOxygen(); },
    set oxygenAvailable(value: boolean) {
      try { window.localStorage.setItem("virtugenium.no-oxygen.v1", value ? "1" : "0"); }
      catch { /* Storage is optional in embedded browsers. */ }
    },
  };
}
