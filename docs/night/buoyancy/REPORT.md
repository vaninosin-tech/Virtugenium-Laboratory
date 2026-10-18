# Experiment 2: composition-consistent buoyancy of the AgCl cloud (CPU only)

Flag: `window.__silverBuoyancy = { mode: "composition" | "additive", scale?, cap?, iterations?, unitMol? }`. Off by default; with the flag absent the load is the accepted baseline expression. Nothing here was seen in the game. Aggregation is off (accepted baseline), 1 mL AgNO3 + 1 mL NaCl, same 50 ms driver and pour curve in all three runs (`tests/night/buoyancy/buoyancy.test.ts`).

## What the model does
Density excess of a parcel is summed from the species the reaction moves, each once: AgNO3 (Ag+ left), NaCl (Cl- left), dissolved NaNO3 (Na+ minus Cl-, from charge balance) and AgCl solid (fine suspension + flocs). Apparent molar excess masses are textbook values (`tubeBuoyancy.ts`). The incoming NaCl layer and the AgNO3 below are the existing transported fields; no interface is imposed.

## The key physical point (affects what was approved)
Precipitation inside a parcel moves mass from dissolved AgNO3 and NaCl into dissolved NaNO3 and solid AgCl. With the values used the parcel density changes by about -5 percent of the reagent excess (a small contraction). So the solid does not add weight on top of the dissolved reagents; adding phi (rho_s - rho_w) to a model that already counts them counts the same mass twice. A cloud becomes heavier than its surroundings only by composition (what it mixed with) or when solid moves relative to the liquid. The `additive` mode is kept only to show this; in these runs its end state is close to `composition`.

## Numerical findings (they changed the implementation)
- First run with the default projection: divergence 0.9 to 1.4 1/s, Ag+ up to 23 times the mean cell (physically at most about 2). The result was a numerical artefact, discarded. With buoyancy on the projection now uses 120 iterations (default `iterations`): mean divergence 0.000 1/s, Ag+ max 2.4, max vertical speed 17 mm/s.
- Baseline injection puts amount into the patch without its volume, so NaCl reaches 18 times the mean (0.9 M, feed is 0.1 M) at 1 s. Density uses concentrations capped at the feed value (`cap`, 100 mol/m3). Without the cap this artefact would drive a fictitious heavy plume.
- Cost on CPU (node): median solver step 0.68 ms baseline, 2.8 ms with buoyancy (projection iterations). Not measured in the game; the Windows FPS impact is unknown and may matter, since the stream model already costs 8 to 13 fps.

## Results at 2, 5, 10 s (details printed by the test)
| | baseline | composition |
|---|---|---|
| AgCl formed (units, of 1) | 0.33 / 0.66 / 0.87 | 0.42 / 0.84 / 0.99 |
| AgCl centroid height, mm | 7.1 / 9.3 / 11.6 | 4.4 / 5.4 / 5.9 |
| AgCl mass-weighted vertical speed, mm/s | +0.74 / +0.74 / +0.28 | -1.95 / -0.05 / -0.02 |
| NaCl-rich upper region (rows above half of the top value) | 13.1 / 10.2 / 8.7 mm | whole column from 2 s: NaCl spread 0.18 to 0.79 (top) and 1.2 (bottom) |
| deposited AgCl | 0 | 0 |

- Baseline: AgCl centroid rises with time, the NaCl layer stays on top 10 s, Ag+ at the top is exhausted. This matches the observed "cotton at the surface, reaction does not go down".
- Composition: the mixing zone overturns during the first 2 to 4 s (local AgCl speed down to -4.5 mm/s), more AgNO3 is reached (0.99 vs 0.87 formed) and the AgCl-rich liquid ends in the lower half as a stratified milky layer (AgCl 2.2 near the bottom vs 0.1 at the top, density excess 17 vs 4.6 kg/m3). After that the stratification is stable and the cloud stops. The collective descent is a few seconds long, a few mm.
- Upper layer: in the composition run the distinct NaCl-rich layer is mixed through the column within 2 s. Whether that is too fast is not settled; the injection patch artefact and the unknown real mixing are not separated here.
- Sediment: 0 in both. The fine suspension does not settle on this time scale and aggregation is off, so by the rule "only transported material reaches the deposit" `ConsolidatingDeposit` was NOT connected. With aggregation on the deposit is also below 0.1 percent in 10 s (see below).

## Aggregation on (same pour, `AGG=1`)
Baseline: AgCl formed 0.31 / 0.67 / 0.89; fine-suspension centroid 6.8 / 6.3 / 6.5 mm; flocs carry the downward motion (-0.64 mm/s at 5 s); deposited 0.0008 of 1 unit at 10 s (0.08 percent). Composition: formed 0.39 / 0.79 / 0.94; centroid 4.9 / 6.3 / 7.6 mm; deposited 0.0005. So with aggregation the buoyancy model changes the early overturn (-2 mm/s at 2 s) but not the amount that reaches the bottom: both are far below one percent in 10 s. `ConsolidatingDeposit` stays unconnected: the validated settling gives no bottom material to hand to it yet.

## Not done / unverified
- No visual check, no Windows run, no FPS in the game.
- Apparent molar volumes are textbook approximations; the 2 to 5 percent contraction term and the cap are assumptions.
- The stream model with buoyancy, longer times (minutes, where the deposit would form) and the AgNO3 volume scaling (`unitMol`) not tested.
