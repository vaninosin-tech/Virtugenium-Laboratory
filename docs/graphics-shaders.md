# Runtime graphics

Reagent `GlassMaterial` and `LiquidMaterial` are reusable `MeshPhysicalMaterial` hybrids. They keep the existing lighting and environment, then add normalized cavity coordinates, Fresnel, thickness/depth tint, a readable liquid-air boundary, procedural motion, reaction mixing, and gravity-driven slosh uniforms. Liquid motion is driven by the same inspection response used by manual rotation and `ПОКАЧАТЬ`; Cu never receives liquid shading.

Cu uses seven closed `ConvexGeometry` fragment shapes in shared `InstancedMesh` batches. A deterministic pile generator varies scale, orientation, color, and placement. During tilt, only a subset receives a small local offset/rotation so upper loose fragments settle more than buried pieces without a physics engine.

`RuntimeQuality` supports `AUTO`, `LOW`, `MEDIUM`, `HIGH`, and `ULTRA`. LOW removes postprocessing and procedural liquid detail while retaining the fill boundary, depth, copper, lighting, and hover outline. AUTO samples frame time for a short window and downgrades once after sustained poor performance with a cooldown; manual presets are never overridden. The current environment uses ACES tone mapping, neutral room IBL, and restrained postprocessing.

Important tuning values live in `reagentMaterials.ts`, `useReagentShaderTuningStore.ts`, and `useRuntimeQualityStore.ts`. The fallback path is the underlying physical material plus ordinary shared copper materials; no render targets or ray tracing are required. Transparent sorting and refraction remain approximate WebGL limitations.
