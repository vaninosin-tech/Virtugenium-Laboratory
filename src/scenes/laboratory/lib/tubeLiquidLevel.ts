/** Liquid height in metres for a hemispherical base and cylindrical bore. */
export function tubeLiquidHeight(volumeMl: number, radius: number): number {
  if (!(volumeMl > 0) || !(radius > 0)) return 0;
  const volume = volumeMl * 1e-6;
  const hemisphere = 2 * Math.PI * radius ** 3 / 3;
  if (volume >= hemisphere) return radius + (volume - hemisphere) / (Math.PI * radius ** 2);
  let lo = 0, hi = radius;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (Math.PI * mid ** 2 * (radius - mid / 3) < volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Game millilitres are calibrated to the authored 2.5 ml meniscus. */
export function tubeEffectiveRadius(authoredHeight: number): number {
  let lo = 0.0001, hi = 0.05;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (tubeLiquidHeight(2.5, mid) > authoredHeight) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function tubeLiquidFill(volumeMl: number, radius: number, cavityHeight: number): number {
  return cavityHeight > 0 ? tubeLiquidHeight(volumeMl, radius) / cavityHeight : 0;
}
