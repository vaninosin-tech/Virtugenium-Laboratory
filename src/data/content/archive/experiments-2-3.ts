import type { LaboratoryData } from "../../../entities/laboratory";

/**
 * ARCHIVE, not used by the game. The former experiments 2 (silver nitrate + sodium chloride) and 3 (barium chloride + potassium sulfate),
 * cut out of `../experiments.ts` unchanged. To bring them back: docs/RESTORE_EXPERIMENTS_2_3_SANDBOX.md (they go back between the
 * copper experiment and the redox experiment, and the redox experiment's title returns to "Опыт 4.").
 */
export const ARCHIVED_EXPERIMENTS_2_3: LaboratoryData["experiments"] = [
    {
      id: "experiment-silver-nitrate-sodium-chloride",
      title: "Опыт 2. Соль серебра и соль Y",
      description:
        "К бесцветному раствору соли X, содержащей ионы серебра, добавили бесцветный прозрачный раствор соли Y. Выпал осадок. При встряхивании пробирки осадок быстро коагулирует и оседает на дно.",
      requiredItemIds: [],
      steps: [
        {
          id: "step-2-identify",
          title: "Определить вещества",
          instruction:
            "Определите исходные вещества для проведения опыта и запишите их химические формулы.",
          allowedActions: ["take-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-2-ppe",
          title: "Надеть СИЗ и подготовить оборудование",
          instruction:
            "Наденьте очки, перчатки и халат перед началом опыта. После надевания СИЗ подготовьте реактивы, необходимые пробирки и штатив.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-2-ppe", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-2-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-2-setup",
          title: "Подготовить установку",
          instruction:
            "Подготовьте рабочую пробирку с раствором нитрата серебра и установите её в штатив. Раствор хлорида натрия подготовьте отдельно.",
          allowedActions: ["place-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-2-transfer",
          title: "Перенести всё необходимое в рабочую зону",
          instruction:
            "Перенесите подготовленные реактивы, пробирки и штатив в место проведения опыта.",
          allowedActions: ["wait"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-2-experiment",
          title: "Провести эксперимент",
          instruction:
            "Прилейте раствор хлорида натрия к раствору нитрата серебра (этикеткой в ладонь). Наблюдайте результат: выпадает белый творожистый осадок хлорида серебра.",
          allowedActions: ["pour", "mix"],
          requirements: [{ type: "action-completed", actionType: "mix" }],
          successScoreRules: [
            { id: "score-2-mix", points: 2, reason: "Растворы слиты правильно" },
          ],
          errorScoreRules: [],
        },
        {
          id: "step-2-equation",
          title: "Записать уравнения и выбрать признаки",
          instruction:
            "Запишите молекулярное, полное ионное и краткое ионное уравнение реакции. Выберите наблюдавшиеся признаки химической реакции.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-2-molecular" }],
          successScoreRules: [
            { id: "score-2-equation", points: 9, reason: "Уравнения реакции записаны верно" },
          ],
          errorScoreRules: [
            { id: "error-2-equation", points: -1, reason: "Уравнение реакции записано неверно" },
          ],
        },
      ],
      equations: [
        {
          id: "equation-2-molecular",
          molecular: "NaCl + AgNO3 -> AgCl + NaNO3",
        },
        {
          id: "equation-2-net-ionic",
          molecular: "Ag+ + Cl- -> AgCl",
        },
      ],
      observationBlocks: [
        {
          id: "obs-2-precipitate-color",
          title: "Цвет осадка",
          points: 1,
          correctOptionId: "opt-white",
          options: [
            { id: "opt-white", label: "Белый" },
            { id: "opt-yellow", label: "Жёлтый" },
            { id: "opt-brown", label: "Бурый" },
            { id: "opt-black", label: "Чёрный" },
          ],
        },
        {
          id: "obs-2-precipitate-texture",
          title: "Консистенция осадка",
          points: 1,
          correctOptionId: "opt-curdy",
          options: [
            { id: "opt-curdy", label: "Аморфный творожистый" },
            { id: "opt-crystal", label: "Кристаллический" },
            { id: "opt-gel", label: "Студенистый" },
            { id: "opt-flaky", label: "Хлопьевидный" },
          ],
        },
      ],
      gradeThresholds: { excellentMin: 16, goodMin: 13, satisfactoryMin: 11 },
      maximumScore: 18,
    },
    {
      id: "experiment-barium-chloride-potassium-sulfate",
      title: "Опыт 3. Соль бария и сульфат",
      description:
        "К прозрачному бесцветному раствору соли А, содержащей ионы бария, прилили избыток бесцветного раствора соли В. Выпал осадок белого цвета. Осадок тяжёлый, сыпучий, не растворяется в разбавленных кислотах.",
      requiredItemIds: [],
      steps: [
        {
          id: "step-3-identify",
          title: "Определить вещества",
          instruction:
            "Определите исходные вещества для проведения опыта и запишите их химические формулы.",
          allowedActions: ["take-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-3-ppe",
          title: "Надеть СИЗ и подготовить оборудование",
          instruction:
            "Наденьте очки, перчатки и халат перед началом опыта. После надевания СИЗ подготовьте реактивы, необходимые пробирки и штатив.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-3-ppe", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-3-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-3-setup",
          title: "Подготовить установку",
          instruction:
            "Подготовьте рабочую пробирку с раствором хлорида бария и установите её в штатив. Раствор сульфата калия подготовьте отдельно.",
          allowedActions: ["place-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-3-transfer",
          title: "Перенести всё необходимое в рабочую зону",
          instruction:
            "Перенесите подготовленные реактивы, пробирки и штатив в место проведения опыта.",
          allowedActions: ["wait"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-3-experiment",
          title: "Провести эксперимент",
          instruction:
            "Прилейте избыток раствора сульфата калия к раствору хлорида бария. Наблюдайте результат: выпадает тяжёлый белый кристаллический осадок сульфата бария.",
          allowedActions: ["pour", "mix"],
          requirements: [{ type: "action-completed", actionType: "mix" }],
          successScoreRules: [
            { id: "score-3-mix", points: 2, reason: "Растворы слиты правильно" },
          ],
          errorScoreRules: [],
        },
        {
          id: "step-3-equation",
          title: "Записать уравнения и выбрать признаки",
          instruction:
            "Запишите молекулярное, полное ионное и краткое ионное уравнение реакции. Выберите наблюдавшиеся признаки химической реакции.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-3-molecular" }],
          successScoreRules: [
            { id: "score-3-equation", points: 9, reason: "Уравнения реакции записаны верно" },
          ],
          errorScoreRules: [
            { id: "error-3-equation", points: -1, reason: "Уравнение реакции записано неверно" },
          ],
        },
      ],
      equations: [
        {
          id: "equation-3-molecular",
          molecular: "K2SO4 + BaCl2 -> 2KCl + BaSO4",
        },
        {
          id: "equation-3-net-ionic",
          molecular: "Ba2+ + SO4^2- -> BaSO4",
        },
      ],
      observationBlocks: [
        {
          id: "obs-3-precipitate-color",
          title: "Цвет осадка",
          points: 1,
          correctOptionId: "opt-white-3",
          options: [
            { id: "opt-white-3", label: "Белый" },
            { id: "opt-yellow-3", label: "Жёлтый" },
            { id: "opt-blue-3", label: "Голубой" },
            { id: "opt-gray-3", label: "Серый" },
          ],
        },
        {
          id: "obs-3-precipitate-texture",
          title: "Консистенция осадка",
          points: 1,
          correctOptionId: "opt-crystal-3",
          options: [
            { id: "opt-crystal-3", label: "Кристаллический" },
            { id: "opt-curdy-3", label: "Аморфный творожистый" },
            { id: "opt-gel-3", label: "Студенистый" },
            { id: "opt-flaky-3", label: "Хлопьевидный" },
          ],
        },
      ],
      gradeThresholds: { excellentMin: 16, goodMin: 13, satisfactoryMin: 11 },
      maximumScore: 18,
    },
];
