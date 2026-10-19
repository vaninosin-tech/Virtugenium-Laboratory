import type { LaboratoryData } from "../../entities/laboratory";

/**
 * Two experiments are in the game (the former experiments 2 and 3 are archived in `archive/experiments-2-3.ts`, see docs/RESTORE_EXPERIMENTS_2_3_SANDBOX.md;
 * the former experiment 4 is now experiment 2). Structure and texts from `experiments_reworked_v2.txt`:
 * 6 stages per experiment (identify → PPE/prep → setup → transfer → run → equations/signs).
 * «Потребуется» removed from UI; reagents live inside stage instructions.
 * Scoring keeps prior totals where the rework file did not specify new points.
 */
export const LABORATORY_CONTENT: LaboratoryData = {
  version: "0.1.0",
  items: [
    {
      id: "reagent-copper",
      category: "reagent",
      name: "Медь (гранулы)",
      description: "Гранулы металла серо-розового цвета",
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
      name: "Спиртовая горелка",
      description: "Источник пламени для нагревания пробирок",
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
      name: "Лабораторный халат",
      description: "Средство индивидуальной защиты тела",
      assetId: "asset-coat",
      kind: "lab-coat",
    },
  ],
  experiments: [
    {
      id: "experiment-copper-nitric-acid",
      title: "Опыт 1. Неизвестный металл и кислота",
      description:
        "В пробирку с гранулами металла X серо-розового цвета прилили бесцветную прозрачную жидкость Y — сильную кислоту. Пробирку слегка нагрели. Жидкость над осадком приобрела цветную окраску, а над поверхностью раствора начал выделяться газ, который при контакте с воздухом изменил свой цвет.",
      requiredItemIds: [],
      steps: [
        {
          id: "step-1-identify",
          title: "Определить вещества",
          instruction:
            "Определите исходные вещества для проведения опыта и запишите их химические формулы.",
          allowedActions: ["take-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-1-ppe",
          title: "Надеть СИЗ и подготовить оборудование",
          instruction:
            "Наденьте очки, перчатки и халат перед началом опыта. После надевания СИЗ подготовьте реактивы и оборудование по списку «Необходимо».",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-1-ppe", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-1-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-1-setup",
          title: "Подготовить установку",
          instruction:
            "Поместите гранулы меди в одну пробирку и закрепите её в штативе. Во вторую пробирку подготовьте разбавленную азотную кислоту.",
          allowedActions: ["place-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-1-transfer",
          title: "Перенести всё необходимое в вытяжной шкаф",
          instruction:
            "Перенесите подготовленные пробирки, реактивы, штатив и необходимое оборудование в вытяжной шкаф. Эксперимент продолжается после размещения предметов в рабочей зоне вытяжки.",
          allowedActions: ["wait"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [
            { id: "score-1-fume", points: 2, reason: "Работа ведётся в вытяжном шкафу" },
          ],
          errorScoreRules: [
            { id: "error-1-fume", points: -2, reason: "Работа с токсичными газами вне вытяжки" },
          ],
        },
        {
          id: "step-1-experiment",
          title: "Провести эксперимент",
          instruction:
            "Поместите гранулы меди в пробирку, закреплённую в держателе, и медленно прилейте азотную кислоту (этикеткой в ладонь). Равномерно прогрейте пробирку над пламенем спиртовой горелки, затем слегка нагрейте содержимое. Наблюдайте результат: выделяющийся бесцветный газ на воздухе буреет.",
          allowedActions: ["pour", "heat"],
          requirements: [{ type: "action-completed", actionType: "heat" }],
          successScoreRules: [
            { id: "score-1-pour", points: 2, reason: "Порядок смешивания соблюдён" },
            { id: "score-1-heat", points: 2, reason: "Пробирка прогрета и нагрета правильно" },
          ],
          errorScoreRules: [
            { id: "error-1-pour", points: -1, reason: "Нарушен порядок смешивания" },
            { id: "error-1-heat", points: -2, reason: "Пробирка нагрета без предварительного прогрева" },
            { id: "error-1-heat-hand", points: -2, reason: "Пробирка нагрета в руке, а не в лапке штатива" },
          ],
        },
        {
          id: "step-1-equation",
          title: "Записать уравнения и выбрать признаки",
          instruction:
            "Запишите уравнение реакции меди с азотной кислотой и уравнение окисления оксида азота(II) кислородом воздуха. Выберите наблюдавшиеся признаки химической реакции.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-1-main" }],
          successScoreRules: [
            { id: "score-1-equation", points: 9, reason: "Уравнения реакций записаны верно" },
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
      observationBlocks: [
        {
          id: "obs-1-solution-color",
          title: "Цвет жидкости над осадком",
          points: 2,
          correctOptionId: "opt-blue",
          options: [
            { id: "opt-blue", label: "Голубой / синий / сине-зелёный (ионы Cu²⁺)" },
            { id: "opt-green", label: "Зелёный" },
            { id: "opt-violet", label: "Фиолетовый" },
            { id: "opt-red", label: "Красный" },
            { id: "opt-colorless", label: "Бесцветный" },
          ],
        },
        {
          id: "obs-1-gas-initial",
          title: "Газ, выделившийся в пробирке (изначально)",
          points: 1,
          correctOptionId: "opt-no",
          options: [
            { id: "opt-no", label: "NO — оксид азота(II), бесцветный, без запаха" },
            { id: "opt-no2", label: "NO₂ — оксид азота(IV), бурый" },
            { id: "opt-h2", label: "H₂ — водород" },
            { id: "opt-co2", label: "CO₂ — углекислый газ" },
          ],
        },
        {
          id: "obs-1-gas-air",
          title: "Газ после реакции с кислородом воздуха",
          points: 1,
          correctOptionId: "opt-no2-brown",
          options: [
            { id: "opt-no2-brown", label: "NO₂ — бурый (красно-бурый) газ с резким удушающим запахом" },
            { id: "opt-no-stay", label: "NO остаётся бесцветным" },
            { id: "opt-o2", label: "O₂ — кислород" },
            { id: "opt-n2", label: "N₂ — азот" },
          ],
        },
      ],
      gradeThresholds: { excellentMin: 29, goodMin: 23, satisfactoryMin: 17 },
      maximumScore: 34,
    },
    {
      id: "experiment-redox-permanganate-sulfite",
      title: "Опыт 2. Окислительно-восстановительная реакция",
      description:
        "Из предложенного перечня веществ выберите окислитель и восстановитель, между которыми в кислой среде протекает ОВР с образованием смеси трёх солей. Перечень: фосфин, серная кислота, сульфит натрия, перманганат калия, нитрат кальция, гидроксид калия.",
      requiredItemIds: [],
      steps: [
        {
          id: "step-4-identify",
          title: "Определить вещества",
          instruction:
            "Определите исходные вещества для проведения опыта и запишите их химические формулы.",
          allowedActions: ["take-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-4-ppe",
          title: "Надеть СИЗ и подготовить оборудование",
          instruction:
            "Наденьте очки, перчатки и халат перед началом опыта. После надевания СИЗ подготовьте три реактива, необходимые пробирки и штатив.",
          allowedActions: ["take-item"],
          requirements: [{ type: "item-selected", itemId: "safety-goggles" }],
          successScoreRules: [
            { id: "score-4-ppe", points: 3, reason: "СИЗ надеты перед началом опыта" },
          ],
          errorScoreRules: [
            { id: "error-4-no-ppe", points: -3, reason: "Опыт начат без средств защиты" },
          ],
        },
        {
          id: "step-4-setup",
          title: "Подготовить установку",
          instruction:
            "Подготовьте рабочую пробирку с раствором сульфита натрия и установите её в штатив. Серную кислоту и раствор перманганата калия подготовьте отдельно.",
          allowedActions: ["place-item"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-4-transfer",
          title: "Перенести всё необходимое в рабочую зону",
          instruction:
            "Перенесите подготовленные реактивы, пробирки и штатив в место проведения опыта.",
          allowedActions: ["wait"],
          requirements: [{ type: "action-completed", actionType: "wait" }],
          successScoreRules: [],
          errorScoreRules: [],
        },
        {
          id: "step-4-experiment",
          title: "Провести эксперимент",
          instruction:
            "Подкислите раствор сульфита натрия серной кислотой, затем прилейте раствор перманганата калия. Наблюдайте изменение окраски: перманганат калия обесцвечивается сульфитом натрия в присутствии серной кислоты.",
          allowedActions: ["pour", "mix"],
          requirements: [{ type: "action-completed", actionType: "mix" }],
          successScoreRules: [
            { id: "score-4-mix", points: 2, reason: "Реактивы смешаны правильно" },
          ],
          errorScoreRules: [],
        },
        {
          id: "step-4-equation",
          title: "Записать уравнение, электронный баланс и выбрать признаки",
          instruction:
            "Запишите уравнение реакции, составьте электронный баланс, укажите окислитель и восстановитель. Выберите наблюдавшиеся признаки химической реакции.",
          allowedActions: ["submit-equation"],
          requirements: [{ type: "equation-correct", equationId: "equation-4-main" }],
          successScoreRules: [
            { id: "score-4-equation", points: 12, reason: "Уравнение и баланс записаны верно" },
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
      observationBlocks: [
        {
          id: "obs-4-sign",
          title: "Качественный признак реакции",
          points: 2,
          correctOptionId: "opt-decolorize",
          options: [
            { id: "opt-decolorize", label: "Обесцвечивание раствора (тёмно-малиновый → бесцветный)" },
            { id: "opt-gas", label: "Выделение газа" },
            { id: "opt-precipitate", label: "Выпадение осадка" },
            { id: "opt-heat", label: "Сильный нагрев без изменения цвета" },
          ],
        },
      ],
      gradeThresholds: { excellentMin: 19, goodMin: 15, satisfactoryMin: 11 },
      maximumScore: 22,
    },
  ],
};
