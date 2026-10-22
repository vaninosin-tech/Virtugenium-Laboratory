export type EquationArrow = "->" | "<->";

export interface EquationTerm {
  readonly coefficient: number;
  readonly formula: string;
  readonly charge?: number;
}

export interface EquationAnswer {
  readonly reactants: readonly EquationTerm[];
  readonly products: readonly EquationTerm[];
  readonly arrow: EquationArrow;
}

export type EquationValidationErrorCode =
  | "invalid-structure"
  | "empty-side"
  | "invalid-coefficient"
  | "invalid-formula"
  | "unsupported-arrow"
  | "unbalanced-atoms"
  | "unbalanced-charge"
  | "wrong-substances"
  | "non-minimal-coefficients";

export interface EquationValidationIssue {
  readonly code: EquationValidationErrorCode;
  readonly message: string;
  readonly path?: string;
}

export interface EquationValidationResult {
  readonly valid: boolean;
  readonly issues: readonly EquationValidationIssue[];
}
