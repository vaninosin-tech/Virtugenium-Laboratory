export const STAMP_KEYS = [
  ["firstValidImpact", "first valid impact"],
  ["firstCompositionUpdate", "first composition update"],
  ["firstFieldInit", "first field init"],
  ["firstChlorideInsertion", "first chloride insertion"],
];

export function formatStamps(stamps) {
  return STAMP_KEYS.map(([key, label]) => `${label}: ${Number.isFinite(stamps?.[key]) ? `${stamps[key]} sim ms` : "missing"}`);
}

export function frameGaps(samples, thresholdMs = 100) {
  return samples.slice(1).flatMap((sample, index) => {
    const gapMs = sample.wallMs - samples[index].wallMs;
    return gapMs > thresholdMs ? [{ fromWallMs: samples[index].wallMs,
      toWallMs: sample.wallMs, simMs: sample.simMs, gapMs }] : [];
  });
}

export function drawtextCommand(input, output, stamps) {
  const label = formatStamps(stamps).join(" | ").replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:").replaceAll("'", "\\'");
  return `ffmpeg -i "${input}" -vf "drawtext=text='${label}':x=18:y=18:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7" -c:a copy "${output}"`;
}
