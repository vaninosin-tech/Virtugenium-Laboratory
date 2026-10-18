import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const before = process.env.BEFORE ?? "tests/_wave15/r1/captures/before";
const after = process.env.AFTER ?? "tests/_wave15/r1/captures/after";
const out = process.env.OUT ?? "tests/_wave15/r1/compare";
const ffmpeg = process.env.FFMPEG;
if (!ffmpeg) throw new Error("Set FFMPEG to the installed ffmpeg executable path");
await mkdir(out, { recursive: true });
for (const [experiment, reagents] of Object.entries({
  copper: ["cu", "hno3"], barium: ["bacl2", "k2so4"],
  permanganate: ["na2so3", "h2so4", "kmno4"],
})) {
  const stageSheets = [];
  for (let stage = 0; stage < reagents.length; stage++) {
    const suffix = `${experiment}-${String(stage + 1).padStart(2, "0")}-${reagents[stage]}.png`;
    const left = join(before, `before-${suffix}`), right = join(after, `after-${suffix}`);
    await access(left); await access(right);
    const destination = join(out, suffix);
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", left, "-i", right,
      "-filter_complex", "[0:v]scale=600:800:force_original_aspect_ratio=decrease,pad=600:800:(ow-iw)/2:(oh-ih)/2:black,drawtext=text=BEFORE:x=16:y=16:fontsize=25:fontcolor=white[a];[1:v]scale=600:800:force_original_aspect_ratio=decrease,pad=600:800:(ow-iw)/2:(oh-ih)/2:black,drawtext=text=AFTER:x=16:y=16:fontsize=25:fontcolor=white[b];[a][b]hstack=inputs=2", "-frames:v", "1", destination];
    console.log(JSON.stringify({ command: ffmpeg, args }));
    const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status} for ${suffix}`);
    stageSheets.push(destination);
  }
  const sheet = join(out, `${experiment}-contact-sheet.png`);
  const args = ["-hide_banner", "-loglevel", "error", "-y",
    ...stageSheets.flatMap(file => ["-i", file]), "-filter_complex",
    `${stageSheets.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${stageSheets.length}`,
    "-frames:v", "1", sheet];
  console.log(JSON.stringify({ command: ffmpeg, args }));
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status} for ${experiment}`);
}
