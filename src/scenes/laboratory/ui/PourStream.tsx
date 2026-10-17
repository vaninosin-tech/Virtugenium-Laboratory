import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { CLAMP_TUBE_MOUTH, POUR_MS, useStandMotionStore } from "../lib/useStandMotionStore";
import { useBunsenStandStorageStore } from "../lib/useBunsenStandStorageStore";
import { useTestTubeStorageStore } from "../lib/useTestTubeStorageStore";
import { useReagentStorageStore } from "../lib/useReagentStorageStore";
import { pourFraction, pouredMl, publishTubePourImpact } from "../lib/tubePourImpact";
import { seedTubeAmounts, tubeAmount } from "../lib/tubeAmounts";
import { tubeEffectiveRadius, tubeLiquidHeight } from "../lib/tubeLiquidLevel";
import { silverStage } from "../lib/silverStage";

const RINGS = 13;
const SIDES = 8;
const UP = new THREE.Vector3(0, 1, 0);
const STREAM_START = 0.35;
const STREAM_END = 0.76;

export function streamGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(RINGS * SIDES * 3);
  const uvs = new Float32Array(RINGS * SIDES * 2);
  const indices: number[] = [];
  for (let ring = 0; ring < RINGS - 1; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const a = ring * SIDES + side;
      const b = ring * SIDES + (side + 1) % SIDES;
      indices.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  for (let ring = 0; ring < RINGS; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const offset = (ring * SIDES + side) * 2;
      uvs[offset] = side / SIDES;
      uvs[offset + 1] = ring / (RINGS - 1);
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  return geometry;
}

/** A translucent liquid surface with angle-dependent edge and a narrow moving glint. */
export function streamMaterial(dyed: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(dyed ? "#bb347f" : "#6d9eaa") },
      uDyed: { value: dyed ? 1 : 0 },
      uOpacity: { value: 0 },
      uSilver: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vEye;
      varying float vAlong;
      void main() {
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vEye = normalize(-eye.xyz);
        vAlong = uv.y;
        gl_Position = projectionMatrix * eye;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uDyed;
      uniform float uOpacity;
      uniform float uSilver;
      uniform float uTime;
      varying vec3 vNormalView;
      varying vec3 vEye;
      varying float vAlong;
      void main() {
        vec3 n = normalize(vNormalView);
        float facing = abs(dot(n, normalize(vEye)));
        float fresnel = pow(1.0 - facing, 2.2);
        float glint = pow(max(dot(n, normalize(vec3(-0.45, 0.7, 0.6))), 0.0), 18.0);
        glint *= 0.8 + 0.2 * sin(uTime * 12.0 - vAlong * 16.0);
        vec3 color = mix(uColor, vec3(1.0), min(0.75, fresnel * 0.4 + glint * 0.65));
        float alpha = (mix(0.38, 0.34, uDyed) + fresnel * 0.43 + glint * 0.27) * uOpacity;
        if (uSilver > 0.5) {
          color = mix(vec3(0.46, 0.72, 0.79), vec3(1.0), min(0.8, fresnel * 0.45 + glint * 0.7));
          alpha = (0.78 + fresnel * 0.12 + glint * 0.10) * uOpacity;
        }
        gl_FragColor = vec4(color, min(alpha, 0.86));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function configureSilverStream(mesh: THREE.Mesh, material: THREE.ShaderMaterial, silver: boolean) {
  mesh.renderOrder = silver ? 5 : 0;
  material.depthTest = !silver;
  material.uniforms.uSilver.value = silver ? 1 : 0;
}

export function isStageOneSilverPour(stage: number, reagentId: string | undefined, contents: readonly string[]) {
  // Stages 1 and 3 both draw the stream down to the measured liquid surface (the impact point is the surface).
  return (stage === 1 || stage === 3) && (reagentId === "nacl" && contents.includes("agno3")
    || reagentId === "agno3" && contents.includes("nacl"));
}

export function shouldDrawStream(flow: number, length: number, silver: boolean) {
  return flow > 0.015 && (silver || length < 0.1);
}

/** The wet surface is measured from the tube's 150 mm mouth, in its own frame. */
export function silverStreamEnd(mouth: THREE.Vector3, tubeRoot: THREE.Matrix4, volumeMl: number) {
  const surface = new THREE.Vector3(0,
    tubeLiquidHeight(volumeMl, tubeEffectiveRadius(0.055)), 0).applyMatrix4(tubeRoot);
  return surface.y < mouth.y ? surface.add(new THREE.Vector3(0, -0.004, 0)) : mouth.clone();
}

interface MouthMeasure {
  readonly mouthOffset: THREE.Vector3;
  readonly neckRadius: number;
  readonly cap: THREE.Object3D | null;
}

/** Drawn in the bottle group, but rebuilt in world space after the bottle moves. */
export function PourStream({
  instanceId,
  bottleRef,
  mouth,
}: {
  readonly instanceId: string;
  readonly bottleRef: React.RefObject<THREE.Group | null>;
  readonly mouth: React.RefObject<MouthMeasure | null>;
}) {
  const mesh = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const lipDrop = useRef<THREE.Mesh>(null);
  const fallingDrops = useRef<THREE.Mesh[]>([]);
  const delivery = useRef({ serial: -1, ml: 0 });
  useEffect(() => useStandMotionStore.subscribe((state, previous) => {
    const finished = previous.pour;
    if (!finished || finished.instanceId !== instanceId || state.pour?.at === finished.at) return;
    const priorMl = delivery.current.serial === finished.at ? delivery.current.ml : 0;
    if (priorMl >= 1) return;
    const stand = useBunsenStandStorageStore.getState();
    const tubes = useTestTubeStorageStore.getState();
    const targetTube = stand.attachedTubeSlotIndex === null ? undefined
      : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[stand.attachedTubeSlotIndex];
    const reagents = useReagentStorageStore.getState();
    const reagentId = [...reagents.workbenchItems, ...reagents.fumeHoodItems, ...reagents.trayItems]
      .find(item => item.instanceId === instanceId)?.reagentId;
    if (targetTube && reagentId) {
      seedTubeAmounts(targetTube.instanceId, targetTube.contents.filter(id => id !== reagentId));
      publishTubePourImpact(targetTube.instanceId, reagentId,
        CLAMP_TUBE_MOUTH.point.clone().add(new THREE.Vector3(0, -0.026, 0)),
        new THREE.Vector3(0, -1, 0), 0, 1 - priorMl, finished.at);
      delivery.current = { serial: finished.at, ml: 1 };
    }
  }), [instanceId]);
  const dyed = /(?:^|-)kmno4$/.test(instanceId);
  const geometry = useMemo(streamGeometry, []);
  const material = useMemo(() => streamMaterial(dyed), [dyed]);
  const dropMaterial = useMemo(() => new THREE.MeshPhongMaterial({
    color: dyed ? "#ba397c" : "#d8f4ff", transparent: true, opacity: dyed ? 0.64 : 0.49,
    shininess: 115, specular: "#ffffff", depthWrite: false,
  }), [dyed]);
  const dropGeometry = useMemo(() => new THREE.SphereGeometry(1, 8, 6), []);
  const scratch = useMemo(() => ({
    origin: new THREE.Vector3(), parentQuat: new THREE.Quaternion(), worldQuat: new THREE.Quaternion(),
    tilt: new THREE.Quaternion(), centre: new THREE.Vector3(), lip: new THREE.Vector3(),
    target: new THREE.Vector3(), side: new THREE.Vector3(), point: new THREE.Vector3(),
    local: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3(),
    binormal: new THREE.Vector3(),
  }), []);

  useFrame(({ clock }) => {
    const bottle = bottleRef.current;
    const measure = mouth.current;
    const pour = useStandMotionStore.getState().pour;
    const k = pour?.instanceId === instanceId ? (Date.now() - pour.at) / POUR_MS : -1;
    if (!bottle || !measure || !measure.cap || !CLAMP_TUBE_MOUTH.valid || k < STREAM_START || k > 1) {
      geometry.setDrawRange(0, 0);
      if (lipDrop.current) lipDrop.current.visible = false;
      fallingDrops.current.forEach((drop) => { if (drop) drop.visible = false; });
      return;
    }

    bottle.updateWorldMatrix(true, false);
    bottle.getWorldPosition(scratch.origin);
    bottle.getWorldQuaternion(scratch.worldQuat);
    bottle.parent!.getWorldQuaternion(scratch.parentQuat);
    scratch.tilt.copy(scratch.worldQuat).multiply(scratch.parentQuat.invert());
    scratch.centre.copy(measure.mouthOffset).applyQuaternion(scratch.tilt).add(scratch.origin);
    scratch.side.subVectors(scratch.centre, CLAMP_TUBE_MOUTH.point).setY(0);
    if (scratch.side.lengthSq() < 1e-8) scratch.side.set(1, 0, 0);
    scratch.side.normalize();
    // The lowest point of the tilted rim is where liquid leaves the bottle.
    scratch.lip.copy(scratch.centre).addScaledVector(UP, -measure.neckRadius * 0.999);
    scratch.target.copy(CLAMP_TUBE_MOUTH.point)
      .addScaledVector(scratch.side, 0.0065)
      .addScaledVector(UP, -0.026);

    const stand = useBunsenStandStorageStore.getState();
    const tubes = useTestTubeStorageStore.getState();
    const targetTube = stand.attachedTubeSlotIndex === null ? undefined
      : (stand.onFumeHood ? tubes.fumeHoodTestTubes : tubes.workbenchTestTubes)[stand.attachedTubeSlotIndex];
    const reagents = useReagentStorageStore.getState();
    const reagentId = [...reagents.workbenchItems, ...reagents.fumeHoodItems, ...reagents.trayItems]
      .find(item => item.instanceId === instanceId)?.reagentId;
    const silver = !!targetTube && isStageOneSilverPour(silverStage(), reagentId, targetTube.contents);
    if (mesh.current) configureSilverStream(mesh.current, material, silver);
    if (silver && targetTube) {
      seedTubeAmounts(targetTube.instanceId, targetTube.contents.filter(id => id !== reagentId));
      scratch.target.y = silverStreamEnd(CLAMP_TUBE_MOUTH.point, CLAMP_TUBE_MOUTH.root,
        tubeAmount(targetTube.instanceId).volumeMl).y;
    }
    if (targetTube && reagentId && pour) {
      if (delivery.current.serial !== pour.at) delivery.current = { serial: pour.at, ml: 0 };
      const total = pouredMl(k);
      const increment = Math.max(0, total - delivery.current.ml);
      if (increment > 0) {
        seedTubeAmounts(targetTube.instanceId, targetTube.contents.filter(id => id !== reagentId));
        publishTubePourImpact(targetTube.instanceId, reagentId, scratch.target,
          scratch.point.subVectors(scratch.target, scratch.lip).normalize(),
          pourFraction(k) ** 2 * 4, increment, pour.at);
        delivery.current.ml = total;
      }
    }

    const rise = THREE.MathUtils.smoothstep(k, STREAM_START, 0.44);
    const fade = 1 - THREE.MathUtils.smoothstep(k, 0.69, STREAM_END);
    const flow = Math.min(rise, fade);
    const length = scratch.lip.distanceTo(scratch.target);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    if (shouldDrawStream(flow, length, silver)) {
      scratch.tangent.subVectors(scratch.target, scratch.lip).normalize()
        .applyQuaternion(scratch.worldQuat.clone().invert());
      scratch.normal.set(0, 0, 1).cross(scratch.tangent).normalize();
      scratch.binormal.crossVectors(scratch.tangent, scratch.normal).normalize();
      for (let ring = 0; ring < RINGS; ring++) {
        const t = ring / (RINGS - 1);
        const reach = t * rise;
        scratch.point.copy(scratch.lip).lerp(scratch.target, reach);
        // Gravity bends the short free span toward the receiving wall.
        scratch.point.addScaledVector(scratch.side, 0.0015 * Math.sin(Math.PI * reach));
        scratch.point.x += 0.00032 * Math.sin(clock.elapsedTime * 24 - t * 6) * Math.sin(Math.PI * t);
        scratch.local.copy(scratch.point);
        bottle.worldToLocal(scratch.local);
        const radius = (0.00115 - 0.0004 * t) * (0.42 + 0.58 * flow);
        for (let side = 0; side < SIDES; side++) {
          const angle = 2 * Math.PI * side / SIDES;
          positions.setXYZ(ring * SIDES + side,
            scratch.local.x + (Math.cos(angle) * scratch.normal.x + Math.sin(angle) * scratch.binormal.x) * radius,
            scratch.local.y + (Math.cos(angle) * scratch.normal.y + Math.sin(angle) * scratch.binormal.y) * radius,
            scratch.local.z + (Math.cos(angle) * scratch.normal.z + Math.sin(angle) * scratch.binormal.z) * radius);
        }
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.setDrawRange(0, geometry.index!.count);
      material.uniforms.uOpacity.value = Math.min(1, flow * 2.5);
      material.uniforms.uTime.value = clock.elapsedTime;
      if (mesh.current) mesh.current.frustumCulled = false;
    } else geometry.setDrawRange(0, 0);

    if (lipDrop.current) {
      lipDrop.current.visible = k > 0.69 && k < 0.86;
      lipDrop.current.position.copy(bottle.worldToLocal(scratch.lip.clone()));
      lipDrop.current.scale.set(0.00155, 0.0021, 0.00155);
    }
    fallingDrops.current.forEach((drop, index) => {
      if (!drop) return;
      const travel = (k - 0.72) * 14 - index * 0.36;
      drop.visible = k > 0.72 && travel > 0 && travel < 1;
      if (drop.visible) {
        scratch.point.copy(scratch.lip).lerp(scratch.target, travel);
        drop.position.copy(bottle.worldToLocal(scratch.point));
        drop.scale.setScalar(0.0012 - index * 0.00012);
      }
    });
  });

  return <>
    <mesh ref={mesh} geometry={geometry} material={material} raycast={() => null} />
    <mesh ref={lipDrop} geometry={dropGeometry} material={dropMaterial} visible={false} raycast={() => null} />
    {[0, 1, 2].map((index) => <mesh key={index} ref={(node) => { if (node) fallingDrops.current[index] = node; }}
      geometry={dropGeometry} material={dropMaterial} visible={false} raycast={() => null} />)}
  </>;
}
