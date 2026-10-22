import type { LaboratoryData } from "../../entities/laboratory";

/**
 * The four experiments required by the ToR (see "Техническое задание.pdf",
 * section "Задания"), typed against the domain model in
 * `entities/laboratory`. This replaces the schema-conformance fixture in
 * `data/examples/` (that one models a copper-hydroxide reaction that isn't
 * one of the four official experiments — it exists only to exercise the
 * JSON Schema validator, not as game content).
 *
 * Scoring here is intentionally simplified to one rule per step rather than
 * the full multi-block rubric from the ToR (e.g. experiment 1 there is
 * scored across five blocks totalling 34 points). Wiring the complete
 * per-action rubric depends on the real 3D reagent-manipulation flow
 * (pouring, heating, PPE, fume hood) that the tablet's "Эксперимент" tab
 * only stubs out for now — this file gives that stub real, correct
 * chemistry to work with in the meantime.
 */
export const LABORATORY_CONTENT: LaboratoryData = {
  version: "0.1.0",
  items: [
    {
      id: "reagent-copper",
      category: "reagent",
      name: "Медь (гранулы)",
      description: "Гранулы меди серо-розового цвета",
      assetId: "asset-reagent-generic",
      formula: "Cu",
      state: "solid",
      color: "#b87333",
      transparent: false,
      hazardIds: [],
    },
    {
      id: "reagent-nitric-acid",
      category: "reagent",
      name: "Азотная кислота (разбавленная)",
      description: "Бесцветная прозрачная сильная кислота",
      assetId: "asset-reagent-bottle",
      formula: "HNO3",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: ["corrosive"],
    },
    {
      id: "reagent-silver-nitrate",
      category: "reagent",
      name: "Нитрат серебра",
      description: "Бесцветный раствор соли серебра",
      assetId: "asset-reagent-bottle",
      formula: "AgNO3",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: ["corrosive"],
    },
    {
      id: "reagent-sodium-chloride",
      category: "reagent",
      name: "Хлорид натрия",
      description: "Бесцветный прозрачный раствор поваренной соли",
      assetId: "asset-reagent-bottle",
      formula: "NaCl",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: [],
    },
    {
      id: "reagent-barium-chloride",
      category: "reagent",
      name: "Хлорид бария",
      description: "Бесцветный прозрачный раствор соли бария",
      assetId: "asset-reagent-bottle",
      formula: "BaCl2",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: ["toxic"],
    },
    {
      id: "reagent-potassium-sulfate",
      category: "reagent",
      name: "Сульфат калия",
      description: "Бесцветный прозрачный раствор сульфата калия",
      assetId: "asset-reagent-bottle",
      formula: "K2SO4",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: [],
    },
    {
      id: "reagent-sulfuric-acid",
      category: "reagent",
      name: "Серная кислота",
      description: "Бесцветная прозрачная сильная кислота",
      assetId: "asset-reagent-bottle",
      formula: "H2SO4",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: ["corrosive"],
    },
    {
      id: "reagent-sodium-sulfite",
      category: "reagent",
      name: "Сульфит натрия",
      description: "Бесцветный прозрачный раствор сульфита натрия",
      assetId: "asset-reagent-bottle",
      formula: "Na2SO3",
      state: "aqueous",
      color: "#e2e8f0",
      transparent: true,
      hazardIds: [],
    },
    {
      id: "reagent-potassium-permanganate",
      category: "reagent",
      name: "Перманганат калия",
      description: "Тёмно-малиновый раствор перманганата калия",
      assetId: "asset-reagent-bottle",
      formula: "KMnO4",
      state: "aqueous",
      color: "#701a4b",
      transparent: true,
      hazardIds: ["oxidizer"],
    },
    {
      id: "glassware-test-tube",
      category: "glassware",
      name: "Пробирка",
      description: "Стеклянная лабораторная пробирка",
      assetId: "asset-test-tube",
      kind: "test-tube",
      capacityMl: 20,
    },
    {
      id: "equipment-holder",
      category: "equipment",
      name: "Держатель пробирки",
      description: "Держатель для безопасной работы с пробиркой над пламенем",
      assetId: "asset-holder",
      kind: "holder",
      attachmentPointIds: ["grip", "test-tube-slot"],
    },
    {
      id: "equipment-burner",
      category: "equipment",
      name: "Спиртовка",
      description: "Источник пламени для нагревания",
      assetId: "asset-burner",
      kind: "burner",
      attachmentPointIds: ["flame"],
    },
    {
      id: "safety-goggles",
      category: "safety",
      name: "Защитные очки",
      description: "Средство индивидуальной защиты глаз",
      assetId: "asset-goggles",
      kind: "goggles",
    },
    {
      id: "safety-gloves",
      category: "safety",
      name: "Резиновые перчатки",
      description: "Средство индивидуальной защиты рук",
      assetId: "asset-gloves",
      kind: "gloves",
    },
    {
      id: "safety-coat",
      category: "safety",
      name: "Халат",
      description: "Средство индивидуальной защиты тела",
      assetId: "asset-coat",
      kind: "lab-coat",
    },
  ],
  experiments: [
    {
      id: "experiment-copper-nitric-acid",
      title: "1. Медь и разбавленная азотная кислота",
      description:
        "В пробирку с гранулами меди приливают разбавленную азотную кислоту и слегка нагревают. Выделяющийся бесцветный газ на воздухе буреет.",
      requiredItemIds: [
        "reagent-copper",
        "reagent-nitric-acid",
        "glassware-test-tube",
        "equipment-holder",
        "safety-goggles",
        "safety-gloves",
        "safety-coat",
      ],
      steps: [
        {
          id: "step-1-safety",
          title: "Надеть средства индивидуальной защиты",
          instruction: "Наденьте очки, перчатки и халат перед началом опыта.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-1-safety", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-1-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-1-order",
          title: "Смешать вещества в правильном порядке",
          instruction:
            "Поместите гранулы меди в пробирку, закреплённую в держателе, и медленно прилейте азотную кислоту.",
          allowedActions: ["place-item", "pour"],
          requirements: [{ type: "action-completed", actionType: "pour" }],
          successScoreRules: [
            { id: "score-1-order", points: 2, reason: "Порядок смешивания соблюдён" },
          ],
          errorScoreRules: [
            { id: "error-1-order", points: -1, reason: "Нарушен порядок смешивания" },
          ],
        },
        {
          id: "step-1-heat",
          title: "Прогреть и нагреть пробирку",
          instruction:
            "Равномерно прогрейте пробирку над пламенем спиртовки, затем слегка нагрейте содержимое.",
          allowedActions: ["heat"],
          requirements: [{ type: "action-completed", actionType: "heat" }],
          successScoreRules: [
            { id: "score-1-heat", points: 2, reason: "Пробирка прогрета и нагрета правильно" },
          ],
          errorScoreRules: [
            { id: "error-1-heat", points: -2, reason: "Пробирка нагрета без предварительного прогрева" },
          ],
        },
        {
          id: "step-1-equation",
          title: "Записать уравнения реакций",
          instruction:
            "Запишите уравнение реакции меди с азотной кислотой и уравнение окисления оксида азота(II) кислородом воздуха.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-1-main" }],
          successScoreRules: [
            { id: "score-1-equation", points: 3, reason: "Уравнения реакций записаны верно" },
          ],
          errorScoreRules: [
            { id: "error-1-equation", points: -1, reason: "Уравнение реакции записано неверно" },
          ],
        },
      ],
      equations: [
        {
          id: "equation-1-main",
          molecular: "3Cu + 8HNO3 -> 3Cu(NO3)2 + 2NO + 4H2O",
        },
        {
          id: "equation-1-oxidation",
          molecular: "2NO + O2 -> 2NO2",
        },
      ],
      maximumScore: 10,
    },
    {
      id: "experiment-silver-nitrate-sodium-chloride",
      title: "2. Нитрат серебра и хлорид натрия",
      description:
        "К раствору нитрата серебра приливают раствор хлорида натрия. Выпадает белый творожистый осадок хлорида серебра.",
      requiredItemIds: [
        "reagent-silver-nitrate",
        "reagent-sodium-chloride",
        "glassware-test-tube",
        "safety-goggles",
        "safety-gloves",
        "safety-coat",
      ],
      steps: [
        {
          id: "step-2-safety",
          title: "Надеть средства индивидуальной защиты",
          instruction: "Наденьте очки, перчатки и халат перед началом опыта.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-2-safety", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-2-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-2-mix",
          title: "Слить растворы",
          instruction: "Прилейте раствор хлорида натрия к раствору нитрата серебра.",
          allowedActions: ["pour", "mix"],
          requirements: [{ type: "action-completed", actionType: "mix" }],
          successScoreRules: [
            { id: "score-2-mix", points: 2, reason: "Растворы слиты правильно" },
          ],
          errorScoreRules: [],
        },
        {
          id: "step-2-equation",
          title: "Записать уравнения реакции",
          instruction:
            "Запишите молекулярное, полное ионное и краткое ионное уравнение реакции.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-2-molecular" }],
          successScoreRules: [
            { id: "score-2-equation", points: 3, reason: "Уравнения реакции записаны верно" },
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
      maximumScore: 8,
    },
    {
      id: "experiment-barium-chloride-potassium-sulfate",
      title: "3. Хлорид бария и сульфат калия",
      description:
        "К раствору хлорида бария приливают избыток раствора сульфата калия. Выпадает тяжёлый белый кристаллический осадок сульфата бария.",
      requiredItemIds: [
        "reagent-barium-chloride",
        "reagent-potassium-sulfate",
        "glassware-test-tube",
        "safety-goggles",
        "safety-gloves",
        "safety-coat",
      ],
      steps: [
        {
          id: "step-3-safety",
          title: "Надеть средства индивидуальной защиты",
          instruction: "Наденьте очки, перчатки и халат перед началом опыта.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-3-safety", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-3-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-3-mix",
          title: "Слить растворы",
          instruction: "Прилейте избыток раствора сульфата калия к раствору хлорида бария.",
          allowedActions: ["pour", "mix"],
          requirements: [{ type: "action-completed", actionType: "mix" }],
          successScoreRules: [
            { id: "score-3-mix", points: 2, reason: "Растворы слиты правильно" },
          ],
          errorScoreRules: [],
        },
        {
          id: "step-3-equation",
          title: "Записать уравнения реакции",
          instruction:
            "Запишите молекулярное, полное ионное и краткое ионное уравнение реакции.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-3-molecular" }],
          successScoreRules: [
            { id: "score-3-equation", points: 3, reason: "Уравнения реакции записаны верно" },
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
      maximumScore: 8,
    },
    {
      id: "experiment-redox-permanganate-sulfite",
      title: "4. Серная кислота, сульфит натрия и перманганат калия",
      description:
        "Окислительно-восстановительная реакция в кислой среде: перманганат калия обесцвечивается сульфитом натрия в присутствии серной кислоты.",
      requiredItemIds: [
        "reagent-sulfuric-acid",
        "reagent-sodium-sulfite",
        "reagent-potassium-permanganate",
        "glassware-test-tube",
        "safety-goggles",
        "safety-gloves",
        "safety-coat",
      ],
      steps: [
        {
          id: "step-4-safety",
          title: "Надеть средства индивидуальной защиты",
          instruction: "Наденьте очки, перчатки и халат перед началом опыта.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-4-safety", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-4-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-4-mix",
          title: "Слить реактивы",
          instruction:
            "Подкислите раствор сульфита натрия серной кислотой, затем прилейте раствор перманганата калия.",
          allowedActions: ["pour", "mix"],
          requirements: [{ type: "action-completed", actionType: "mix" }],
          successScoreRules: [
            { id: "score-4-mix", points: 2, reason: "Реактивы смешаны правильно" },
          ],
          errorScoreRules: [],
        },
        {
          id: "step-4-equation",
          title: "Записать уравнение и электронный баланс",
          instruction:
            "Запишите уравнение реакции, составьте электронный баланс, укажите окислитель и восстановитель.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-4-main" }],
          successScoreRules: [
            { id: "score-4-equation", points: 4, reason: "Уравнение и баланс записаны верно" },
          ],
          errorScoreRules: [
            { id: "error-4-equation", points: -1, reason: "Уравнение реакции записано неверно" },
          ],
        },
      ],
      equations: [
        {
          id: "equation-4-main",
          molecular: "5Na2SO3 + 2KMnO4 + 3H2SO4 -> 5Na2SO4 + 2MnSO4 + K2SO4 + 3H2O",
        },
      ],
      maximumScore: 9,
    },
  ],
};
