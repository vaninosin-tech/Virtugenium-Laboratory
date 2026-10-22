import { useState, type CSSProperties } from "react";

import { CheckCircle2, Circle, Star } from "lucide-react";

import { useLaboratoryStore } from "../../../../stores/laboratory/useLaboratoryStore";
import { LABORATORY_CONTENT } from "../../../../data/content/experiments";
import { getExperimentById, getStepById, isEquationStep, totalScore } from "../../lib/experimentRuntime";

import {
  colors,
  ghostButtonStyle,
  mutedTextStyle,
  sectionTitleStyle,
  splitDetailCtaButtonStyle,
  splitDetailProgressStepStyle,
  splitDetailProgressStyle,
  splitLayoutStyle,
  splitListStyle,
  typography,
} from "../tabletStyles";
import "../tabletTransitions.css";



type TaskStatus = "not-started" | "in-progress" | "completed";

const STATUS_LABEL: Record<TaskStatus, string> = {
  "not-started": "не начато",
  "in-progress": "в процессе",
  completed: "пройдено",
};

const formatExperimentTitle = (title: string): string => title.replace(/^Задание\b/i, "Опыт");

const splitTaskTitle = (title: string): { readonly numberLabel: string; readonly name: string } => {
  const normalized = formatExperimentTitle(title);
  const match = normalized.match(/^Опыт\s+(\d+)\.\s*(.+)$/i);
  if (match) return { numberLabel: `Опыт ${match[1]}.`, name: match[2] };
  return { numberLabel: normalized, name: "" };
};

/** «Опыты» — list (assignment) | description; minimal highlights. */

export function TasksTab() {

  const selectedExperimentId = useLaboratoryStore((state) => state.selectedExperimentId);

  const completedExperimentIds = useLaboratoryStore((state) => state.completedExperimentIds);

  const scoreEvents = useLaboratoryStore((state) => state.scoreEvents);

  const finishedAt = useLaboratoryStore((state) => state.finishedAt);

  const selectExperiment = useLaboratoryStore((state) => state.selectExperiment);

  const setCurrentStep = useLaboratoryStore((state) => state.setCurrentStep);

  const currentStepId = useLaboratoryStore((state) => state.currentStepId);
  const pushTabletSection = useLaboratoryStore((state) => state.pushTabletSection);



  const [previewId, setPreviewId] = useState<string | null>(selectedExperimentId);

  // Follow the store's selection when it changes externally, but still let
  // the player locally preview a different experiment without it syncing
  // back — adjusted during render instead of in an effect.
  const [syncedForId, setSyncedForId] = useState(selectedExperimentId);
  if (selectedExperimentId !== syncedForId) {
    setSyncedForId(selectedExperimentId);
    setPreviewId(selectedExperimentId);
  }



  const previewed = LABORATORY_CONTENT.experiments.find((experiment) => experiment.id === previewId) ?? null;

  const isActive = previewed !== null && previewed.id === selectedExperimentId;

  const isCompleted = previewed !== null && completedExperimentIds.includes(previewed.id);

  const activeScore = totalScore(scoreEvents);
  const activeCurrentStep =
    isActive && previewed ? getStepById(previewed, currentStepId) : null;
  const activeStepIndex =
    activeCurrentStep && previewed
      ? previewed.steps.findIndex((step) => step.id === activeCurrentStep.id)
      : -1;
  const showProgressMeta = isActive && !finishedAt && !isCompleted && previewed !== null;

  const scoreForExperiment = (experimentId: string, maximumScore: number) => {
    if (experimentId === selectedExperimentId) return Math.max(0, activeScore);
    if (completedExperimentIds.includes(experimentId)) return maximumScore;
    return 0;
  };



  const goToWorkPanel = () => {

    const experiment = getExperimentById(selectedExperimentId);

    const step = getStepById(experiment, currentStepId);

    if (step && isEquationStep(step)) {

      pushTabletSection("answer");

      return;

    }

    pushTabletSection("stages");

  };



  const startOrRetry = () => {

    if (!previewed) return;

    selectExperiment(previewed.id);

    setCurrentStep(previewed.steps[0]?.id ?? null);

    pushTabletSection("stages");

  };



  const continueActive = () => {

    goToWorkPanel();

  };



  const statusFor = (experimentId: string): TaskStatus => {

    if (completedExperimentIds.includes(experimentId)) return "completed";

    if (experimentId === selectedExperimentId && !finishedAt) return "in-progress";

    return "not-started";

  };



  const ctaLabel = () => {

    if (isCompleted || (isActive && finishedAt)) return "Пройти снова";

    if (isActive) return "Продолжить";

    return "Принять опыт";

  };



  const canRestart =

    isActive && !finishedAt && !isCompleted && activeScore > 0;



  const onCta = () => {

    if (canRestart) {

      continueActive();

      return;

    }

    startOrRetry();

  };



  const onRestart = () => {

    if (!previewed) return;

    selectExperiment(previewed.id);

    setCurrentStep(previewed.steps[0]?.id ?? null);

  };

  const previewStatus = previewed ? statusFor(previewed.id) : null;

  return (

    <div style={rootStyle}>

      <div style={splitListStyle}>

        <span style={paneLabelStyle}>Опыт</span>

        {LABORATORY_CONTENT.experiments.map((experiment) => {

          const isPreviewed = experiment.id === previewId;

          const status = statusFor(experiment.id);

          const { numberLabel, name } = splitTaskTitle(experiment.title);



          return (

            <button

              key={experiment.id}

              type="button"

              data-testid={`task-preview-${experiment.id}`}

              onClick={() => setPreviewId(experiment.id)}

              style={taskRowStyle(isPreviewed)}

            >

              <div style={taskRowTopStyle}>

                {status === "completed" ? (

                  <CheckCircle2 size={18} color={colors.success} />

                ) : (

                  <Circle

                    size={18}

                    color={status === "in-progress" ? colors.accentBright : colors.textMuted}

                  />

                )}

                <div style={taskTextBlockStyle}>

                  <span style={taskNumberStyle(isPreviewed)}>{numberLabel}</span>

                  {name ? <span style={taskTitleStyle(isPreviewed)}>{name}</span> : null}

                </div>

              </div>

            </button>

          );

        })}

      </div>



      {previewed && previewStatus ? (
        <div key={previewed.id} className="tablet-task-pane" style={detailPaneStyle}>
          <div style={detailTitleZoneStyle}>
            <h3 style={detailTitleStyle}>{formatExperimentTitle(previewed.title)}</h3>
          </div>

          <div style={detailContentStyle}>
            <div>
              <span style={{ ...paneLabelStyle, display: "block", marginBottom: 0 }}>Описание</span>
              <p style={detailBodyStyle}>{previewed.description}</p>
            </div>

            {showProgressMeta ? (
              <div>
                <p style={splitDetailProgressStyle}>
                  Этап {Math.max(activeStepIndex + 1, 1)} из {previewed.steps.length}
                </p>
                {activeCurrentStep ? (
                  <p style={splitDetailProgressStepStyle}>{activeCurrentStep.title}</p>
                ) : null}
              </div>
            ) : (
              <p style={metaLineStyle}>
                <span>Этапов: {previewed.steps.length}</span>
                <span style={metaSepStyle}>·</span>
                <span style={metaStatusStyle(previewStatus)}>{STATUS_LABEL[previewStatus]}</span>
                <span style={metaSepStyle}>·</span>
                <span style={metaScoreStyle}>
                  <Star size={14} color={colors.warning} fill={colors.warning} aria-hidden />
                  {scoreForExperiment(previewed.id, previewed.maximumScore)} / {previewed.maximumScore}
                </span>
              </p>
            )}
          </div>

          <div style={detailActionsStyle}>
            <div style={actionRowStyle}>
              <button
                data-testid={`task-start-${previewed.id}`}
                type="button"
                style={splitDetailCtaButtonStyle}
                onClick={onCta}
              >
                {ctaLabel()}
              </button>

              {canRestart ? (
                <button
                  data-testid={`task-restart-${previewed.id}`}
                  type="button"
                  style={restartButtonStyle}
                  onClick={onRestart}
                >
                  Начать сначала
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={detailPaneStyle}>
          <p style={{ ...mutedTextStyle, margin: 0 }}>Выберите опыт слева.</p>
        </div>
      )}

    </div>

  );

}



const rootStyle: CSSProperties = {

  ...splitLayoutStyle,

  height: "100%",

  overflow: "hidden",

};



const paneLabelStyle: CSSProperties = {

  fontSize: 11,

  fontWeight: typography.weightSemibold,

  letterSpacing: "0.1em",

  textTransform: "uppercase",

  color: colors.accentBright,

  marginBottom: 4,

};



const taskRowStyle = (active: boolean): CSSProperties => ({

  display: "flex",

  flexDirection: "column",

  alignItems: "stretch",

  gap: 6,

  width: "100%",

  boxSizing: "border-box",

  padding: "8px 4px 8px 6px",

  borderRadius: 8,

  border: "none",

  borderLeft: active ? `3px solid ${colors.accentBright}` : "3px solid transparent",

  backgroundColor: "transparent",

  color: colors.textPrimary,

  cursor: "pointer",

  textAlign: "left",

  fontFamily: typography.fontFamilyBase,

  transition: "border-color 0.22s ease, background-color 0.22s ease",

});



const taskRowTopStyle: CSSProperties = {

  display: "flex",

  alignItems: "flex-start",

  gap: 10,

};



const taskTextBlockStyle: CSSProperties = {

  flex: 1,

  minWidth: 0,

  display: "flex",

  flexDirection: "column",

  gap: 2,

};



const taskNumberStyle = (active: boolean): CSSProperties => ({

  fontSize: typography.sizeCaption,

  fontWeight: typography.weightSemibold,

  lineHeight: 1.3,

  color: active ? colors.accentBright : colors.textMuted,

  transition: "color 0.22s ease",

});



const taskTitleStyle = (active: boolean): CSSProperties => ({

  fontSize: typography.sizeCaption,

  fontWeight: active ? typography.weightSemibold : typography.weightMedium,

  lineHeight: 1.35,

  color: active ? colors.accentBright : colors.textPrimary,

  transition: "color 0.22s ease",

});



const detailPaneStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 0,
  padding: "8px 8px 8px 16px",
  boxSizing: "border-box",
  overflow: "hidden",
};

/** Title zone — large title anchored top-left. */
const detailTitleZoneStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
  paddingTop: 12,
  paddingBottom: 20,
  paddingRight: 12,
};

const detailTitleStyle: CSSProperties = {
  ...sectionTitleStyle,
  margin: 0,
  fontSize: 32,
  lineHeight: 1.2,
  letterSpacing: "-0.02em",
  maxWidth: "36rem",
};

const detailContentStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  paddingBottom: 28,
  maxWidth: "44rem",
};

const detailBodyStyle: CSSProperties = {
  ...mutedTextStyle,
  margin: "8px 0 0",
  maxWidth: "none",
  lineHeight: 1.55,
};

const detailActionsStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 4,
  minHeight: 52,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "center",
};

const metaLineStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  margin: 0,
  fontSize: typography.sizeCaption,
  color: colors.textMuted,
};

const metaSepStyle: CSSProperties = {
  opacity: 0.5,
};

const metaStatusStyle = (status: TaskStatus): CSSProperties => ({
  fontWeight: typography.weightMedium,
  color:
    status === "completed"
      ? colors.success
      : status === "in-progress"
        ? colors.accentBright
        : colors.textMuted,
});

const metaScoreStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: typography.fontFamilyMono,
  fontWeight: typography.weightBold,
  color: colors.textPure,
};

const restartButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  alignSelf: "flex-start",
  minHeight: 44,
  padding: "10px 18px",
};


