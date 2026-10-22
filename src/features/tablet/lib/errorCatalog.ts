/**
 * The six procedural errors from the ToR. Shown in the Errors tab as a
 * reference catalogue; live attempt errors still come from the store.
 */
export interface TorErrorEntry {
  readonly id: string;
  readonly title: string;
  readonly shortNotice: string;
  readonly rationale: string;
  /** Optional reagent from theory to open when following the theory link. */
  readonly theoryReagentId: string | null;
}

export const TOR_ERROR_CATALOG: readonly TorErrorEntry[] = [
  {
    id: "label-orientation",
    title: "Неверное положение склянки при отборе",
    shortNotice: "Ошибка: неверное положение склянки при отборе.",
    rationale:
      "Правило «этикеткой в ладонь»: при наклоне капли стекают по горлышку. Если этикетка обращена к экрану или от ладони, жидкость портит маркировку.",
    theoryReagentId: "reagent-nitric-acid",
  },
  {
    id: "heat-without-holder",
    title: "Нагрев пробирки без держателя",
    shortNotice: "Ошибка: нагрев пробирки без держателя.",
    rationale:
      "Пробирку греют только в держателе. Держать «ладошкой» у пламени нельзя — риск ожога, разрыва стекла и выброса жидкости.",
    theoryReagentId: "reagent-copper",
  },
  {
    id: "wrong-mix-order",
    title: "Неправильный порядок смешивания",
    shortNotice: "Ошибка: неправильный порядок смешивания.",
    rationale:
      "Сначала твёрдое вещество, затем жидкость. Иначе реакция на поверхности кислоты может закипеть с брызгами.",
    theoryReagentId: "reagent-copper",
  },
  {
    id: "no-preheat",
    title: "Отсутствие предварительного прогревания пробирки",
    shortNotice: "Ошибка: отсутствие предварительного прогревания пробирки.",
    rationale:
      "Перед нагревом содержимого пробирку проводят в пламени влево-вправо (четыре раза), иначе из-за перепада температур стекло лопается.",
    theoryReagentId: "reagent-copper",
  },
  {
    id: "no-ppe",
    title: "Отсутствие средств индивидуальной защиты",
    shortNotice: "Ошибка: отсутствие СИЗ.",
    rationale:
      "Халат, очки и перчатки обязательны. Без них планшет блокируется, баллы за СИЗ снимаются безвозвратно.",
    theoryReagentId: "reagent-nitric-acid",
  },
  {
    id: "no-fume-hood",
    title: "Работа вне вытяжного шкафа с токсичными веществами",
    shortNotice: "Ошибка: работа вне вытяжного шкафа.",
    rationale:
      "При выделении токсичных газов нужно включить режим вытяжки. Иначе экран заполняется газом, появляется эффект помутнения и штраф.",
    theoryReagentId: "reagent-nitric-acid",
  },
];

/** Map live attempt error codes → theory reagent for the «К теории» link. */
export const THEORY_LINK_BY_ERROR_CODE: Readonly<Record<string, string | null>> = {
  "invalid-data": "reagent-copper",
  "item-not-found": null,
  "action-not-allowed": null,
  "wrong-order": "reagent-copper",
  "safety-violation": "reagent-nitric-acid",
  "incorrect-equation": "reagent-copper",
};
