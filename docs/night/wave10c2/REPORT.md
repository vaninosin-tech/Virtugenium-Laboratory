# Wave 10 C2: fine AgCl optics

The stage-3 game previously left `uCloudOn=0`. With smoke and large flocs disabled, the fine suspension contributed no visible white pixels even though the captured suspension mass rose from 0.0253 at 0.9 s to 0.2256 at 9 s. Stage 3 now enables the cloud by default. `window.__silverCloud = false` restores the previous disabled behavior. The shader reads `fineTexture` when available and otherwise uses `texture`.

## CPU reference and diagnosis

The six dumps were marched with the same fine-field optical equations as the shader. [Mode 0](sheet-mode0.png) combines extinction and scattering over white; [mode 1](sheet-mode1.png) shows raw field concentration over black; [mode 2](sheet-mode2.png) shows extinction alone over white; [mode 3](sheet-mode3.png) shows scattering alone over black. The corresponding PPM sheets and 24 individual PPM panels are in this directory. These are CPU results, not captured GLSL frames. The CPU images isolate the fine cloud, while the game also composites glass, liquid, sediment and flocs.

| Time (s) | Fine mass | Mean fine concentration in active cells | Coefficient of variation | Mean absolute x-neighbor difference | Mode-3 mean brightness over image |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.9 | 0.0253 | 0.0213 | 5.74 | 0.0121 | 0.022 |
| 1.5 | 0.0555 | 0.0546 | 3.44 | 0.0270 | 0.063 |
| 2.5 | 0.1022 | 0.0990 | 1.96 | 0.0421 | 0.120 |
| 4.0 | 0.1488 | 0.1400 | 1.15 | 0.0475 | 0.186 |
| 6.0 | 0.1850 | 0.1669 | 0.74 | 0.0431 | 0.232 |
| 9.0 | 0.2256 | 0.1913 | 0.52 | 0.0329 | 0.259 |

The first failure was the disabled fine cloud: it removed 100% of this path's contribution. Once enabled, the dominant remaining limit on a cotton-like shape is the smooth data. From 0.9 to 9 s, the active-cell coefficient of variation falls by 91%, and the mode-1 shapes become a broad, nearly continuous field. Extinction-only mode makes those shapes grey; scattering mode makes them white but does not create branches that the field lacks. The combined image is nearly invisible on the CPU sheet's white background (mean brightness 0.997 to 0.999); the real game liquid and backdrop determine that contrast, so the coordinator must compare actual frames. The 9 s mode-3 brightness of 0.259 across the full image versus 0.022 at 0.9 s confirms that insufficient light output is not the main limit after this optics change.

The supplied dumps are 12×24×12, despite the proposed 16×32×16 target. For a horizontal central ray the shader's 88 steps span a 2.4-radius box, giving 6.1 steps per x/z cell at 12 cells across the diameter, or 4.6 at 16 cells. A 0.014 m tube diameter has 0.00117 m x/z cells at 12 cells, while a central ray step is about 0.000191 m. This is oversampling, not undersampling. Trilinear field filtering spreads a one-cell feature over about two cells; depth integration smooths it further. Reducing ray steps would not restore the missing large-scale variation.

## Model and cost

Each fine sample uses `sigma_t = kappa * concentration * grain / radius` and `alpha_step = 1-exp(-sigma_t * stepLength)`. Front-to-back compositing computes `T_total` and in-scattered light. Two additional field taps toward the light estimate its optical depth. The source has a forward-leaning phase term with an isotropic floor and a local optical-depth ambient boost, capped by the available light plus ambient budget. Grain has amplitude ±10% and 2.4 cycles per grid cell; it cannot create larger lobes or mass. Both GLSL and CPU use the exported `SILVER_FINE_OPTICS` values: kappa 8, albedo 0.98, light direction `(0.45, 0.70, 0.55)`, light strength 0.62, ambient 0.42, ambient boost 0.55, anisotropy 0.35, isotropic floor 0.6, and two light taps separated by 0.23 radius.

Mode 0 is combined; mode 1 is a raw concentration colormap; mode 2 uses grey extinction with no scattering; mode 3 composites scattering on black. In the no-floc, no-smoke Diagnostic C case, static source counting gives approximately 11 texture taps per occupied sample with the old cloud disabled, 17 if its old six-noise-tap branch had been enabled, and at most 13 now (base dense 7, overlap 1, haze/tint/chip 3, light 2). Thus the enabled path adds at most 176 texture taps to an 88-sample pixel relative to the previously clear state, and removes four taps per occupied sample compared with enabling the old cloud branch. Early exit at alpha 0.995 reduces work for opaque rays. Counting explicit expensive source operations in the cloud branch gives two before (one `pow`, one `exp`) and five now (two `sin`, three `exp`), plus simple arithmetic and control flow. These are source-level counts, not compiled GPU instructions. Exact compiled GPU instruction counts and per-pixel timing require the coordinator's browser/GPU; there is no GPU in this worker. With flocs present, the existing cotton and dense-light paths add their own conditional taps unchanged by this work.

The CPU uses midpoint ray samples, whereas GLSL retains its existing per-pixel step jitter to suppress banding. That changes sample positions slightly but not the optical equations. The GLSL still uses `wet()` clipping and the existing render order. The `uDiag` tracer and occupied-cell branches execute before the optics modes.

## Validation

`node node_modules/typescript/bin/tsc --noEmit` passed. Focused Vitest run: 41 passed, 0 failed across the CPU reference and silver visual tests, using a 10 s per-test timeout. The CPU property tests cover dense white, thin translucency, monotonic alpha, scattering saturation, grey extinction, bounded radiance, and zero-concentration alpha. The silver visual test checks the default switch, live off/on switch, fine texture fallback, and that experiments 1, 3 and 4 do not use the fine shader. Two existing long silver tests timed out at the default 5 s limit in one focused attempt and passed individually; the 10 s focused rerun passed all 41.

The full suite, run once with the 10 s timeout, finished with 371 passed, 3 failed and 4 expected failures across 61 files (58 passing files, 3 failing files). The three failures are the stated pre-existing cases: `tests/night/wave4a/field.test.ts` (surface raft 0.00250 versus required 0.005), `tests/night/wave4b/PourStream.test.ts` (stream end 0.255 versus expected 0.251), and `tests/night/wave6perf/flocPerf.test.ts` (mass snapshot delta 0.05510). This worker changed neither those tests nor their underlying field, stream, or floc systems. The suite rewrote tracked diagnostic outputs outside ownership; their original bytes were restored afterward.

Integration: C1 may add `fineTexture` at its own resolution. The binding will use it automatically; no integration edit is needed. The coordinator still needs to inspect real-game GLSL frames, shader compilation, and GPU timing against these CPU sheets.
