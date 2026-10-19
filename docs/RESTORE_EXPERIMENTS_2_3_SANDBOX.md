# Cut: experiments 2 and 3, and the sandbox (how to bring them back)

What was cut from the game (the simulation code, reagents and reaction visuals are untouched):
- Former experiment 2 (silver nitrate + sodium chloride) and 3 (barium chloride + potassium sulfate): removed from `src/data/content/experiments.ts`, kept unchanged in `src/data/content/archive/experiments-2-3.ts` (`ARCHIVED_EXPERIMENTS_2_3`, not imported anywhere).
- Former experiment 4 (redox, permanganate + sulfite) is now "Опыт 2" (title only; its id `experiment-redox-permanganate-sulfite` is unchanged).
- The sandbox mode: the main menu card, `AppMode "sandbox"`, `src/scenes/laboratory/sandbox/` (copy in `archive/sandbox/`, outside `src`, not compiled), and the sandbox branches in `Laboratory.tsx`, `FumeHoodWorkArea.tsx`, `LabTrayInstance.tsx`, `placementGhosts.ts`, `useLaboratoryStore.ts`, `LabLoadingScreen.tsx`.

Consequences to know: the Windows A/B recording scripts (`tests/_wave15/baselineRecord.mjs`, `tests/_exp2/runValidation.mjs`, `tests/_wave13/measureFpsPour.mjs`, `tests/_stream/*`) start the game through the sandbox ("Песочница (временно)") and the AgNO3 + NaCl experiment can no longer be reached in the game; they will not run until the sandbox is restored. The AgNO3 and BaCl2 reagents still exist in the data and in the cabinets as stock without an experiment.

Restore (the previous state is the commit just before the cut, `1b91778` on `claude/epic-brown-yxujey`; a pushed tag was not possible from the cloud session):
1. Everything at once: `git revert <hash of the commit "Cut experiments 2 and 3 and the sandbox">`.
2. By hand: put the objects of `ARCHIVED_EXPERIMENTS_2_3` back into `LABORATORY_CONTENT.experiments` between the copper and the redox experiment, set the redox title back to "Опыт 4. Окислительно-восстановительная реакция"; restore the sandbox with `git checkout 1b91778 -- src/scenes/laboratory/sandbox src/features/main-menu/ui/MainMenu.tsx src/entities/laboratory/model/types.ts src/features/lab-boot/ui/LabLoadingScreen.tsx src/stores/laboratory/useLaboratoryStore.ts src/scenes/laboratory/ui/Laboratory.tsx src/scenes/laboratory/ui/FumeHoodWorkArea.tsx src/scenes/laboratory/ui/LabTrayInstance.tsx src/scenes/laboratory/ui/placementGhosts.ts`.
