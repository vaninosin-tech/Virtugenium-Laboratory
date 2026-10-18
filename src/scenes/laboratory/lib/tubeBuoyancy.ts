/**
 * Composition-consistent buoyancy of the stage-3 liquid (experimental, window.__silverBuoyancy, off by default).
 *
 * The density of a parcel follows from what it actually contains, each species counted once:
 *   AgNO3 (Ag+ left),  NaCl (Cl- left),  NaNO3 (dissolved product, Na+ - Cl-),  AgCl solid (fine suspension + flocs).
 * Precipitation moves mass from the first two into the last two inside the same parcel, so the parcel density is almost
 * unchanged by the reaction itself (the net term is the small contraction below). A cloud becomes heavier than its
 * surroundings only through composition (mixing with the lighter NaCl solution) or when solid moves relative to the
 * liquid (flocs falling out of a parcel): the solid then takes its mass with it.
 * Adding phi (rho_s - rho_w) to a model that already counts the dissolved reagents would count the same mass twice.
 *
 * Apparent excess mass over water per mole, kg/mol = M - rho_w * V_phi (textbook apparent molar volumes at 25 C):
 */
export const EXCESS_KG_PER_MOL = {
  agno3: 0.16987 - 997 * 28.0e-6,
  nacl: 0.05844 - 997 * 16.6e-6,
  nano3: 0.08499 - 997 * 28.7e-6,
  agcl: 0.14332 - 997 * 25.8e-6,
} as const;
export const REFERENCE_DENSITY = 1008;       // kg/m3, normalisation of the relative density difference
export const GRAVITY = 9.81;

export interface BuoyancyOptions {
  /** "composition": density from the species above (default). "additive": baseline weights plus the solid's own weight
   *  phi (rho_s - rho_w); kept only to show the double counting. */
  mode?: "composition" | "additive";
  /** Multiplier on the resulting acceleration (1 is physical). */
  scale?: number;
  /** Moles represented by one field unit of Ag+ (0.1 M x 1 mL by default). */
  unitMol?: number;
  /** Largest concentration (mol/m3) used for density. The feed is 100 mol/m3; values above it come from injecting amount
   *  without its volume and are not densities. Infinity disables. */
  cap?: number;
  /** Projection iterations while buoyancy is on (the default few leave divergence that compresses the scalars). */
  iterations?: number;
}
export interface DensityParts { agno3: number; nacl: number; nano3: number; agcl: number; total: number }

/** Density excess (kg/m3) of a parcel from concentrations in mol/m3. */
export function densityParts(agno3: number, nacl: number, nano3: number, agcl: number): DensityParts {
  const a = agno3 * EXCESS_KG_PER_MOL.agno3, c = nacl * EXCESS_KG_PER_MOL.nacl,
    n = Math.max(0, nano3) * EXCESS_KG_PER_MOL.nano3, s = agcl * EXCESS_KG_PER_MOL.agcl;
  return { agno3: a, nacl: c, nano3: n, agcl: s, total: a + c + n + s };
}
/** The receiving solution before the pour: AgNO3 only, one unit of Ag+ in `liquidM3`. */
export function referenceExcess(unitMol: number, liquidM3: number) { return unitMol / liquidM3 * EXCESS_KG_PER_MOL.agno3; }
export function buoyancyOptions(flag: unknown): BuoyancyOptions | undefined {
  if (!flag) return undefined;
  return typeof flag === "object" ? flag as BuoyancyOptions : {};
}
