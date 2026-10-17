// Run with the game server already listening on URL, for example:
// OUT=... URL=http://127.0.0.1:5201/ node tests/_wave9/captureRealGame.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { drawtextCommand, frameGaps, formatStamps } from "./capturePure.mjs";

const out = resolve(process.env.OUT ?? "tests/_wave9/capture-output");
await mkdir(join(out, "frames"), { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome",
  args: ["--window-size=1400,950", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(900000);
  await page.addInitScript(() => { window.__silverStage = 3; });
  await page.goto(process.env.URL ?? "http://127.0.0.1:5201/");
  await page.getByText("Играть", { exact: true }).click();
  await page.getByText("Песочница (временно)").click();
  await page.waitForFunction(() => window.__sceneStore?.getState().cabinetPhase === "inspecting",
    null, { timeout: 300000 });
  await page.locator(".lab-boot-screen").waitFor({ state: "hidden", timeout: 300000 });
  await page.evaluate(() => {
    window.__wave9Frames = [];
    window.__wave9Start = performance.now();
    window.__wave9Stop = false;
    const sample = () => {
      const tube = window.__testTubeStorageStore?.getState().fumeHoodTestTubes[0];
      const simMs = window.__silverRuntime?.diagnostics(tube?.instanceId)?.simMs ?? null;
      window.__wave9Frames.push({ wallMs: performance.now() - window.__wave9Start, simMs });
      if (!window.__wave9Stop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const real = reagentId => page.evaluate(async id => {
    const { runStandAction } = await import("/src/scenes/laboratory/lib/standTableActions.ts");
    return runStandAction({ kind: "bottle", location: "fumeHood", reagentId: id,
      instanceId: `sandbox-jar-${id}` });
  }, reagentId);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let recording = false;
  cdp.on("Page.screencastFrame", async frame => {
    if (recording) frames.push({ wallSeconds: frame.metadata.timestamp, data: frame.data });
    try { await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }); } catch { /* session closed */ }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85,
    maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  if (!await real("agno3")) throw new Error("AgNO3 action was rejected");
  await page.waitForTimeout(7000);
  recording = true;
  if (!await real("nacl")) throw new Error("NaCl action was rejected");
  await page.waitForTimeout(Number(process.env.SECONDS ?? 14) * 1000);
  recording = false;
  await cdp.send("Page.stopScreencast");
  const diagnostics = await page.evaluate(() => {
    window.__wave9Stop = true;
    const tubeId = window.__testTubeStorageStore.getState().fumeHoodTestTubes[0]?.instanceId;
    return { tubeId, runtime: window.__silverRuntime?.diagnostics(tubeId) ?? null,
      frameTimes: window.__wave9Frames };
  });
  const stamps = diagnostics.runtime?.stamps ?? diagnostics.runtime ?? {};
  const indices = [];
  for (let index = 0; index < frames.length; index++) {
    const name = `s${String(index).padStart(5, "0")}.jpg`;
    await writeFile(join(out, "frames", name), Buffer.from(frames[index].data, "base64"));
    indices.push({ name, wallSeconds: frames[index].wallSeconds });
  }
  const concat = indices.map((frame, index) => `file '${frame.name}'\nduration ${Math.max(0.001,
    (indices[index + 1]?.wallSeconds ?? frame.wallSeconds + 1 / 30) - frame.wallSeconds).toFixed(6)}`)
    .join("\n") + (indices.length ? `\nfile '${indices.at(-1).name}'\n` : "");
  await writeFile(join(out, "frames", "concat.txt"), concat);
  await writeFile(join(out, "diagnostics.json"), JSON.stringify({ ...diagnostics,
    stamps, stampLabels: formatStamps(stamps), frameGapsOver100Ms: frameGaps(diagnostics.frameTimes),
    screencastFrames: indices }, null, 2));
  const raw = join(out, "raw.mp4"), burned = join(out, "stamped.mp4");
  await writeFile(join(out, "ffmpeg.txt"),
    `ffmpeg -f concat -safe 0 -i "${join(out, "frames", "concat.txt")}" -vsync vfr "${raw}"\n`
      + drawtextCommand(raw, burned, stamps) + "\n");
  console.log(`Wrote ${frames.length} screencast frames and diagnostics to ${out}`);
} finally {
  await browser.close();
}
