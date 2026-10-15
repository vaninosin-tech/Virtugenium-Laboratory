# Why the AgCl precipitate behaved like sand (code inspection, `tubeSilverField.ts` stage 1)

Every item below was read in the code; line numbers are from the commit this file was written in.

| Mechanism in the code | Effect | Why it is wrong |
|---|---|---|
| `hardening(i)` (`HARDEN_FROM/TO`) multiplies `loadWeight` (`HARDEN_LOAD`) | the older the cotton, the heavier it loads the flow | age directly changes gravitational load |
| `aggregateSpeed(i)` uses `age`, `AGG_GROWTH_TIME`, per-cell settling in `settleDense` | each cell sinks by a fixed downward flux scaled by a clump-size proxy | settling is not a drag balance and does not follow the fluid; no relative-velocity physics |
| `settleDense` / `compactDense` / `packDense` / `repose` | cell-wise transfers, packing cap, angle of repose | these are granular (sand) rules: layers, flat heap, terraces, stripes |
| `spreadYoung`, `spreadSurface`, `peelSurface`, `holdFilm` | horizontal diffusion of concentration, pinned top rows | produce sheets and a lid; fragments are a per-cell rate (`shedChips`), not breaking of connections |
| `shedChips` rate (`CHIP_RATE`), `emitHaze` rate | mass leaves the cotton at a constant rate | fragmentation/haze not caused by force on a structure |
| the scalar field `dense` is the only cotton representation | a concentration, not a structure | no connectivity, no deformation, no hanging parts; the shape comes from noise in the shader |
| coarse 22x44x22 grid (cell 0.64-0.77 mm) | numerical diffusion of the concentration | blurs everything; compensated by sharpening rules that create terraces |

Conclusion: the precipitate was a granular concentration with age-driven weight, not a set of cohesive porous flocs
carried by the liquid. This is replaced by `FlocSystem` (hybrid Eulerian-Lagrangian), see `flocSystem.ts` and REPORT.md.
