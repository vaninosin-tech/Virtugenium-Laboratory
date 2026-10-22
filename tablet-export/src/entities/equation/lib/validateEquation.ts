import type {
  EquationAnswer,
  EquationTerm,
  EquationValidationIssue,
  EquationValidationResult,
} from "../model/types";

type ElementCounts = Record<string, number>;

const createIssue = (
  code: EquationValidationIssue["code"],
  message: string,
  path?: string,
): EquationValidationIssue => ({
  code,
  message,
  ...(path === undefined ? {} : { path }),
});

const mergeCounts = (
  target: ElementCounts,
  source: ElementCounts,
  multiplier = 1,
): void => {
  for (const [element, count] of Object.entries(source)) {
    target[element] = (target[element] ?? 0) + count * multiplier;
  }
};

const parseFormula = (formula: string): ElementCounts | null => {
  let position = 0;

  const readNumber = (): number | null => {
    const start = position;

    while (position < formula.length && /\d/.test(formula[position])) {
      position += 1;
    }

    if (start === position) {
      return 1;
    }

    const text = formula.slice(start, position);

    if (text.startsWith("0")) {
      return null;
    }

    const value = Number(text);

    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  const readSequence = (insideParentheses: boolean): ElementCounts | null => {
    const counts: ElementCounts = {};
    let foundPart = false;

    while (position < formula.length) {
      const current = formula[position];

      if (current === ")") {
        return insideParentheses && foundPart ? counts : null;
      }

      if (current === "(") {
        position += 1;

        const nested = readSequence(true);

        if (nested === null || formula[position] !== ")") {
          return null;
        }

        position += 1;

        const multiplier = readNumber();

        if (multiplier === null) {
          return null;
        }

        mergeCounts(counts, nested, multiplier);
        foundPart = true;
        continue;
      }

      if (!/[A-Z]/.test(current)) {
        return null;
      }

      let element = current;
      position += 1;

      if (position < formula.length && /[a-z]/.test(formula[position])) {
        element += formula[position];
        position += 1;
      }

      const count = readNumber();

      if (count === null) {
        return null;
      }

      counts[element] = (counts[element] ?? 0) + count;
      foundPart = true;
    }

    return !insideParentheses && foundPart ? counts : null;
  };

  if (formula.length === 0) {
    return null;
  }

  const result = readSequence(false);

  return result !== null && position === formula.length ? result : null;
};

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
};

const countSideAtoms = (
  terms: readonly EquationTerm[],
): ElementCounts | null => {
  const total: ElementCounts = {};

  for (const term of terms) {
    const formulaCounts = parseFormula(term.formula);

    if (formulaCounts === null) {
      return null;
    }

    mergeCounts(total, formulaCounts, term.coefficient);
  }

  return total;
};

const countsAreEqual = (
  left: ElementCounts,
  right: ElementCounts,
): boolean => {
  const elements = new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ]);

  for (const element of elements) {
    if ((left[element] ?? 0) !== (right[element] ?? 0)) {
      return false;
    }
  }

  return true;
};

const totalCharge = (terms: readonly EquationTerm[]): number =>
  terms.reduce(
    (sum, term) => sum + term.coefficient * (term.charge ?? 0),
    0,
  );

const validateTerms = (
  terms: readonly EquationTerm[],
  side: "reactants" | "products",
): EquationValidationIssue[] => {
  const issues: EquationValidationIssue[] = [];

  terms.forEach((term, index) => {
    const path = `${side}[${index}]`;

    if (
      !Number.isSafeInteger(term.coefficient) ||
      term.coefficient <= 0
    ) {
      issues.push(
        createIssue(
          "invalid-coefficient",
          "Коэффициент должен быть положительным целым числом.",
          `${path}.coefficient`,
        ),
      );
    }

    if (parseFormula(term.formula) === null) {
      issues.push(
        createIssue(
          "invalid-formula",
          "Химическая формула записана в неподдерживаемом формате.",
          `${path}.formula`,
        ),
      );
    }

    if (
      term.charge !== undefined &&
      !Number.isSafeInteger(term.charge)
    ) {
      issues.push(
        createIssue(
          "invalid-structure",
          "Заряд должен быть целым числом.",
          `${path}.charge`,
        ),
      );
    }
  });

  return issues;
};

export const validateEquation = (
  answer: EquationAnswer,
): EquationValidationResult => {
  const issues: EquationValidationIssue[] = [];

  if (answer.reactants.length === 0) {
    issues.push(
      createIssue(
        "empty-side",
        "Левая часть уравнения не должна быть пустой.",
        "reactants",
      ),
    );
  }

  if (answer.products.length === 0) {
    issues.push(
      createIssue(
        "empty-side",
        "Правая часть уравнения не должна быть пустой.",
        "products",
      ),
    );
  }

  if (answer.arrow !== "->" && answer.arrow !== "<->") {
    issues.push(
      createIssue(
        "unsupported-arrow",
        "Использована неподдерживаемая стрелка реакции.",
        "arrow",
      ),
    );
  }

  issues.push(
    ...validateTerms(answer.reactants, "reactants"),
    ...validateTerms(answer.products, "products"),
  );

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  const reactantAtoms = countSideAtoms(answer.reactants);
  const productAtoms = countSideAtoms(answer.products);

  if (
    reactantAtoms === null ||
    productAtoms === null ||
    !countsAreEqual(reactantAtoms, productAtoms)
  ) {
    issues.push(
      createIssue(
        "unbalanced-atoms",
        "Количество атомов элементов слева и справа не совпадает.",
      ),
    );
  }

  if (totalCharge(answer.reactants) !== totalCharge(answer.products)) {
    issues.push(
      createIssue(
        "unbalanced-charge",
        "Суммарный заряд слева и справа не совпадает.",
      ),
    );
  }

  const coefficients = [
    ...answer.reactants,
    ...answer.products,
  ].map((term) => term.coefficient);

  const commonDivisor = coefficients.reduce(greatestCommonDivisor);

  if (commonDivisor > 1) {
    issues.push(
      createIssue(
        "non-minimal-coefficients",
        "Коэффициенты должны иметь минимальное целочисленное отношение.",
      ),
    );
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};
