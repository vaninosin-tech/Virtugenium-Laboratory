import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Check, LoaderCircle } from "lucide-react";

import type { AppMode } from "../../../entities/laboratory";
import { loadCabinetFonts } from "../../../scenes/laboratory/lib/loadCabinetFonts";
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { colors, tabletChrome, typography } from "../../tablet/ui/tabletStyles";
import { getAssetsVersion, isAssetFinished, subscribeAssets } from "../lib/assetTracker";
import { useLabBootStore } from "../lib/useLabBootStore";
import "./labLoadingScreen.css";

interface Stage {
  readonly label: string;
  /** Files (as named on disk) this stage waits for; none for the fonts/scene stages. */
  readonly files?: readonly string[];
}

const STAGES: readonly Stage[] = [
  { label: "Помещение лаборатории", files: ["LabRoom.glb"] },
  {
    label: "Мебель и шкафы",
    files: ["LaboratoryWorkbench.glb", "ReagentCabinet.glb", "FumeHood_Modern.glb", "PPECabinet.glb"],
  },
  {
    label: "Посуда и реактивы",
    files: ["ReagentContainers.glb", "LabTestTube.glb", "LabTestTubeRack.glb", "LabTray_Metal.glb"],
  },
  {
    label: "Штатив и спиртовка",
    files: ["BunsenStand.glb", "ClampMount.glb", "TubeClamp.glb", "SpiritLamp.glb"],
  },
  { label: "Шрифты интерфейса" },
  { label: "Подготовка сцены" },
];
const FONTS_STAGE = 4;
const SCENE_STAGE = 5;

const MODE_LABELS: Record<AppMode, string> = {
  training: "Обучение",
  classic: "Классический",
  clean: "Чистый эксперимент",
};

/** Each stage stays on screen at least this long, so cached assets don't flash the whole list by in one frame. */
const STAGE_MIN_MS = 260;
/** «Лаборатория готова» holds briefly before the screen lets go. */
const DONE_HOLD_MS = 500;
/** The tablet shrinking from "fills the monitor" to its normal size. */
const REVEAL_MS = 1300;
/** At the very start of the reveal the screen pulls back slightly — the tablet coming unstuck from the monitor. */
const LIFT_SHARE = 0.16;
const LIFT_AMOUNT = 0.025;
/** Loading content dissolving into the experiment list underneath. */
const FADE_MS = 360;
/** How long to wait for the tablet to mount before giving up and just fading out. */
const TABLET_WAIT_MS = 2000;

/** Scale shared with `TabletBezel`'s shell transform while the lab boots. */
const BOOT_SCALE_VAR = "--tablet-boot-scale";

interface Geometry {
  readonly width: number;
  readonly height: number;
  /** Scale at which the tablet's screen covers the whole viewport. */
  readonly cover: number;
}

function tabletScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-tablet-screen]");
}

/**
 * The tablet screen's own (untransformed) size. Before the tablet has mounted
 * it's derived from the same constants `TabletBezel` lays out with (side rails
 * and gaps 48 px across, frame padding 4 px down).
 */
function measure(): Geometry {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const screen = tabletScreen();
  const width =
    screen?.offsetWidth || Math.min(tabletChrome.expandedWidth, vw - tabletChrome.viewportInset) - 48;
  const height = screen?.offsetHeight || Math.min(tabletChrome.heightPx, vh - tabletChrome.viewportInset) - 4;
  return { width, height, cover: Math.max(vw / width, vh / height) };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Scale over the reveal: a small pull back off the monitor, then down to the tablet's normal size. */
function revealScale(cover: number, t: number): number {
  const lifted = cover * (1 - LIFT_AMOUNT);
  if (t < LIFT_SHARE) return cover + (lifted - cover) * easeOutQuad(t / LIFT_SHARE);
  return lifted + (1 - lifted) * easeInOutCubic((t - LIFT_SHARE) / (1 - LIFT_SHARE));
}

/**
 * Loading screen after the mode is chosen. It's styled as the tablet's own
 * screen, magnified to fill the monitor, and the real tablet sits behind it
 * scaled up just as much (its bezel off past the monitor's edges). Once the
 * lab is fully loaded — never earlier — both shrink together to the tablet's
 * normal size: the bezel slides in from the edges, the scene appears around
 * it, and the loading content dissolves into the experiment list.
 */
export function LabLoadingScreen() {
  const phase = useLabBootStore((state) => state.phase);
  if (phase === "done") return null;
  return <LoadingScreen />;
}

function LoadingScreen() {
  const mode = useLaboratoryStore((state) => state.mode);
  const sceneReady = useLabBootStore((state) => state.sceneReady);
  useSyncExternalStore(subscribeAssets, getAssetsVersion);

  const [fontsReady, setFontsReady] = useState(false);
  const [shown, setShown] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const finishedFiles = (stage: Stage) => stage.files?.filter(isAssetFinished).length ?? 0;
  const stageReady = (index: number): boolean => {
    if (index === FONTS_STAGE) return fontsReady;
    if (index === SCENE_STAGE) return sceneReady;
    // A mounted, rendered scene means every model it needs has loaded, even
    // one this list doesn't know by name.
    const stage = STAGES[index];
    return sceneReady || finishedFiles(stage) === (stage.files?.length ?? 0);
  };
  const allShown = shown >= STAGES.length;
  const currentReady = !allShown && stageReady(shown);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadCabinetFonts(), document.fonts.ready]).then(() => {
      if (alive) setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Tick stages off strictly in order, each one only once it's really done.
  useEffect(() => {
    if (!currentReady) return;
    const id = window.setTimeout(() => setShown((count) => count + 1), STAGE_MIN_MS);
    return () => window.clearTimeout(id);
  }, [currentReady, shown]);

  useEffect(() => {
    if (!allShown) return;
    const id = window.setTimeout(() => setRevealing(true), DONE_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [allShown]);

  // While loading: keep the screen and the tablet behind it at "covers the
  // monitor" scale, following window resizes and the tablet mounting.
  useEffect(() => {
    if (revealing) return;
    const root = document.documentElement;
    let raf = 0;
    const tick = () => {
      const geometry = measure();
      applyScreen(overlayRef.current, geometry, geometry.cover);
      root.style.setProperty(BOOT_SCALE_VAR, String(geometry.cover));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [revealing]);

  useEffect(() => {
    if (!revealing) return;
    const root = document.documentElement;
    const overlay = overlayRef.current;
    const timers: number[] = [];
    let raf = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const finish = () => {
      root.style.removeProperty(BOOT_SCALE_VAR);
      if (overlay) {
        overlay.style.pointerEvents = "none";
        overlay.style.transition = `opacity ${FADE_MS}ms ease-out`;
        overlay.style.opacity = "0";
      }
      timers.push(window.setTimeout(() => useLabBootStore.getState().setPhase("done"), FADE_MS));
    };

    const shrink = () => {
      useLabBootStore.getState().setPhase("revealing");
      overlay?.classList.add("is-revealing");
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / REVEAL_MS);
        const geometry = measure();
        const scale = revealScale(geometry.cover, t);
        applyScreen(overlay, geometry, scale);
        root.style.setProperty(BOOT_SCALE_VAR, String(scale));
        if (t < 1) raf = requestAnimationFrame(step);
        else finish();
      };
      raf = requestAnimationFrame(step);
    };

    // The experiment list is what the loading screen turns into — wait for
    // the tablet to be open and laid out (it opens as the lab mounts).
    const waitStart = performance.now();
    const waitForTablet = () => {
      const tabletReady = useLaboratoryStore.getState().tabletOpen && tabletScreen() !== null;
      if (tabletReady && !reducedMotion) shrink();
      else if (tabletReady || reducedMotion || performance.now() - waitStart > TABLET_WAIT_MS) finish();
      else raf = requestAnimationFrame(waitForTablet);
    };
    waitForTablet();

    return () => {
      cancelAnimationFrame(raf);
      for (const id of timers) window.clearTimeout(id);
    };
  }, [revealing]);

  // Leaving the lab mid-load must not leave the tablet scaled up.
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(BOOT_SCALE_VAR);
    },
    [],
  );

  const filesTotal = STAGES.length;
  const currentStage = allShown ? null : STAGES[shown];
  const partial =
    currentStage?.files && !stageReady(shown) ? finishedFiles(currentStage) / currentStage.files.length : 0;
  const percent = Math.round(((Math.min(shown, filesTotal) + partial) / filesTotal) * 100);

  return (
    <div ref={overlayRef} className="lab-boot-screen" style={screenStyle} role="status" aria-live="polite">
      <div className="lab-boot-glare" aria-hidden />
      <div style={contentStyle}>
        <div className="lab-boot-enter" style={{ ...brandStyle, animationDelay: "0ms" }}>
          VIRTUUGENIUM LAB
        </div>
        <h1 className="lab-boot-enter" style={{ ...titleStyle, animationDelay: "70ms" }}>
          {/* Keyed so the new title fades in rather than snapping. */}
          <span key={allShown ? "ready" : "loading"} className="lab-boot-title-swap">
            {allShown ? "Лаборатория готова" : "Подготовка лаборатории"}
          </span>
        </h1>
        <div className="lab-boot-enter" style={{ ...modeStyle, animationDelay: "140ms" }}>
          Режим: {MODE_LABELS[mode]}
        </div>

        <ol style={listStyle}>
          {STAGES.map((stage, index) => {
            const state = index < shown ? "done" : index === shown ? "active" : "pending";
            return (
              <li
                key={stage.label}
                className="lab-boot-enter lab-boot-row"
                data-state={state}
                style={{ ...rowStyle, animationDelay: `${220 + index * 70}ms` }}
              >
                <span style={iconCellStyle}>
                  {state === "done" ? (
                    <span key="done" className="lab-boot-pop" style={doneIconStyle}>
                      <Check size={17} strokeWidth={3} />
                    </span>
                  ) : state === "active" ? (
                    <LoaderCircle key="active" size={24} className="lab-boot-spin" color={colors.accentBright} />
                  ) : (
                    <span key="pending" style={pendingDotStyle} />
                  )}
                </span>
                <span>{stage.label}</span>
                {state === "active" && stage.files ? (
                  <span style={countStyle}>
                    {finishedFiles(stage)}/{stage.files.length}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="lab-boot-enter" style={{ ...barRowStyle, animationDelay: `${220 + STAGES.length * 70}ms` }}>
          <div style={barTrackStyle}>
            <div style={{ ...barFillStyle, width: `${percent}%` }} />
          </div>
          <SmoothPercent value={percent} />
        </div>
      </div>
    </div>
  );
}

/** Percentage that counts up smoothly to `value` instead of jumping. */
function SmoothPercent({ value }: { readonly value: number }) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const next = displayRef.current + (value - displayRef.current) * 0.12;
      displayRef.current = Math.abs(value - next) < 0.5 ? value : next;
      setDisplay(displayRef.current);
      if (displayRef.current !== value) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span style={percentStyle}>{Math.round(display)}%</span>;
}

/** Places the screen exactly over the tablet's screen, scaled about the viewport centre (where the tablet is centred). */
function applyScreen(overlay: HTMLDivElement | null, geometry: Geometry, scale: number) {
  if (!overlay) return;
  overlay.style.width = `${geometry.width}px`;
  overlay.style.height = `${geometry.height}px`;
  overlay.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

const screenStyle: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  zIndex: 2000,
  transformOrigin: "center center",
  borderRadius: 12,
  overflow: "hidden",
  // Opaque: nothing of the scene or the tablet behind may show through while loading.
  backgroundColor: "#0f172a",
  backgroundImage: "radial-gradient(circle at 50% 38%, rgba(6, 182, 212, 0.10) 0%, rgba(15, 23, 42, 0) 60%)",
  color: colors.textPrimary,
  fontFamily: typography.fontFamilyBase,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  willChange: "transform, opacity",
};

const contentStyle: CSSProperties = {
  width: 560,
  maxWidth: "88%",
  display: "flex",
  flexDirection: "column",
};

const brandStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: typography.weightSemibold,
  letterSpacing: "0.28em",
  color: colors.accentBright,
  marginBottom: 12,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 36,
  lineHeight: 1.2,
  fontWeight: typography.weightSemibold,
  color: colors.textPure,
};

const modeStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 18,
  color: colors.textMuted,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: "34px 0 30px",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

/** Colour/offset per state live in `labLoadingScreen.css` (`[data-state]`), so they transition. */
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  fontSize: 21,
};

const iconCellStyle: CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const doneIconStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.accent,
  color: colors.accentInk,
};

const pendingDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  backgroundColor: "rgba(148, 163, 184, 0.4)",
};

const countStyle: CSSProperties = {
  marginLeft: "auto",
  fontFamily: typography.fontFamilyMono,
  fontSize: 16,
  color: colors.textMuted,
};

const barRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const barTrackStyle: CSSProperties = {
  flex: 1,
  height: 8,
  borderRadius: 999,
  backgroundColor: "rgba(148, 163, 184, 0.18)",
  overflow: "hidden",
};

const barFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  backgroundColor: colors.accent,
  boxShadow: `0 0 12px ${colors.accent}`,
  transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
};

const percentStyle: CSSProperties = {
  width: 56,
  textAlign: "right",
  fontFamily: typography.fontFamilyMono,
  fontSize: 17,
  color: colors.textMuted,
};
