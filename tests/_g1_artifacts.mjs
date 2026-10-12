import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const dir = "tmp/g1-tracer";
const ffmpeg = resolve("tmp/ffmpeg/package/ffmpeg.exe");
const videos = [];
for (const stem of ["right", "center", "shake"]) {
  const records = JSON.parse(await readFile(`${dir}/${stem === "shake" ? "shake-frames" : stem}.json`, "utf8"));
  const times = records.map(record => record.actual);
  const concat = ["ffconcat version 1.0"];
  for (let i = 0; i < records.length; i++) {
    concat.push(`file '${records[i].file}'`);
    concat.push(`duration ${Math.max(0.001, (times[i + 1] ?? times[i] + 0.2) - times[i]).toFixed(6)}`);
  }
  concat.push(`file '${records.at(-1).file}'`);
  await writeFile(`${dir}/${stem}.ffconcat`, concat.join("\n") + "\n");
  const run = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-safe", "0",
    "-f", "concat", "-i", `${stem}.ffconcat`, "-vsync", "vfr", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${stem}.mp4`], { cwd: dir, encoding: "utf8" });
  if (run.status !== 0) throw Error(`${stem}: ${run.stderr}`);
  const span = times.at(-1) - times[0];
  videos.push({ stem, frames: records.length, span, averageFPS: (records.length - 1) / span,
    first: times[0], last: times.at(-1) });
}
const runs = JSON.parse(await readFile(`${dir}/energy-series.json`, "utf8"));
const colors = ["#39c3bd", "#f77d4a", "#a56eff"];
const x = t => 70 + t / 6 * 790;
const y = e => 355 - (Math.log10(Math.max(e, 1e-5)) + 5) / 7 * 260;
const paths = runs.map((run, index) => `<path d="${run.samples.map((s, i) =>
  `${i ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.energy).toFixed(1)}`).join(" ")}" fill="none" stroke="${colors[index]}" stroke-width="2.5"/>`).join("");
const labels = runs.map((run, index) => `<text x="${90 + index * 270}" y="35" fill="${colors[index]}" font-size="15">${run.name}: max ${run.peak.toFixed(3)}</text>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="930" height="430" viewBox="0 0 930 430"><rect width="930" height="430" fill="#101820"/><text x="70" y="70" fill="white" font-size="19">Flow energy under prescribed tube motion</text>${labels}<path d="M70 95 V355 H860" fill="none" stroke="#aab8c0"/>${[2,3.2].map(t=>`<path d="M${x(t)} 95 V355" stroke="#53606a" stroke-dasharray="5 5"/>`).join("")}${[1e-5,1e-4,1e-3,1e-2,1e-1,1,10,100].map(e=>`<text x="10" y="${y(e)+4}" fill="#b7c7cc" font-size="12">${e}</text>`).join("")}${[0,1,2,3,4,5,6].map(t=>`<text x="${x(t)-5}" y="377" fill="#b7c7cc" font-size="12">${t}</text>`).join("")}${paths}<text x="450" y="407" fill="#cbd7dc" font-size="13">Time, s; motion 2.0–3.2 s; energy in solver units (log scale)</text></svg>`;
await writeFile(`${dir}/energy-series.svg`, svg);
const cards = [];
for (const stem of ["center", "right"]) {
  const records = JSON.parse(await readFile(`${dir}/${stem}.json`, "utf8"));
  for (const i of [0, 12, 25]) cards.push(`<figure><img src="${records[i].file}"><figcaption>${stem}, actual ${records[i].actual.toFixed(2)} s, tracer ${records[i].tracer.mass.toFixed(6)}, layers ${records[i].layerMass?.toFixed(6) ?? "?"}</figcaption></figure>`);
}
await writeFile(`${dir}/sheet.html`, `<!doctype html><meta charset="utf-8"><style>body{background:#17202a;color:#e9f3f8;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}img{width:100%}figcaption{padding:8px}</style><h1>G1 inert jet and precolored layers</h1><main>${cards.join("")}</main><p>Frames by actual wall time, three camera angles for each pour.</p>`);
console.log(JSON.stringify(videos));
