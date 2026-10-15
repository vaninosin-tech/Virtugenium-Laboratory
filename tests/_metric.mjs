// Similarity of the stand (left pane) to the reference video frames, per real second.
// usage: node tests/_metric.mjs <dir with stand screenshots tN.png> <times comma list>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const FFMPEG = "C:/Users/Aiyrell/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
const VIDEO = "C:/Users/Aiyrell/Downloads/AgNO3 + NaCl (silver nitrate + sodium chloride).mp4";
const dir = process.argv[2], times = process.argv[3].split(",").map(Number);
const BINS = 16;

function decode(args, w, h) {
  const r = spawnSync(FFMPEG, ["-v", "error", ...args, "-vf", `scale=${w}:${h}:flags=bilinear,format=rgb24`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-frames:v", "1", "-"], { maxBuffer: 1 << 28 });
  return { data: r.stdout, w, h };
}
const videoAt = real => real <= 6.25 ? real : real <= 6.25 + 15.75 ? 6.25 + (real - 6.25) / 5 : Math.min(19.3, 9.4 + (real - 22) / 50);

/** Bounding box of the tube (non-dark columns) and white profile of its liquid part. */
function profile({ data, w, h }, region) {
  const lum = (x, y) => { const i = (y * w + x) * 3; return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; };
  const [x0, x1, y0, y1] = region;
  // tube columns: columns with any bright pixel
  let left = x1, right = x0;
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y += 2) if (lum(x, y) > 70) { left = Math.min(left, x); right = Math.max(right, x); break; }
  // bottom of the glass: lowest row with a bright pixel inside the columns
  let bottom = y0;
  for (let y = y1 - 1; y > y0; y--) { let any = false; for (let x = left; x <= right; x += 2) if (lum(x, y) > 70) { any = true; break; } if (any) { bottom = y; break; } }
  const width = right - left + 1, liquidHeight = 1.9 * width;
  const inner0 = Math.round(left + 0.12 * width), inner1 = Math.round(right - 0.12 * width);
  const bins = new Array(BINS).fill(0);
  for (let b = 0; b < BINS; b++) {
    const ya = Math.round(bottom - liquidHeight * (b + 1) / BINS), yb = Math.round(bottom - liquidHeight * b / BINS);
    let white = 0, count = 0;
    for (let y = Math.max(ya, 0); y < yb; y++) for (let x = inner0; x < inner1; x++) { count++; if (lum(x, y) > 150) white++; }
    bins[b] = count ? white / count : 0;
  }
  return { bins, width: width / (w), left, right, bottom };
}

let total = 0, n = 0;
const rows = [];
for (const t of times) {
  const ref = decode(["-ss", String(videoAt(t)), "-i", VIDEO], 640, 360);
  const ours = decode(["-i", `${dir}/t${String(t).replace(".", "_")}.png`], 1280, 860);
  const pr = profile(ref, [150, 480, 0, 360]);
  // left pane only; the stand draws a 2-px divider at the middle
  const po = profile(ours, [0, 630, 0, 770]);
  let diff = 0; for (let b = 0; b < BINS; b++) diff += Math.abs(pr.bins[b] - po.bins[b]);
  diff /= BINS;
  const sum = a => a.reduce((x, y) => x + y, 0) / BINS;
  rows.push({ t, diff: +diff.toFixed(3), refWhite: +sum(pr.bins).toFixed(3), ourWhite: +sum(po.bins).toFixed(3),
    ref: pr.bins.map(v => Math.round(v * 9)).join(""), ours: po.bins.map(v => Math.round(v * 9)).join("") });
  total += diff; n++;
}
for (const r of rows) console.log(`t=${String(r.t).padEnd(4)} diff=${r.diff}  white ref=${r.refWhite} ours=${r.ourWhite}  ref[${r.ref}] ours[${r.ours}]`);
console.log(`SCORE ${(total / n).toFixed(4)} (lower is closer; bins bottom-to-top)`);
