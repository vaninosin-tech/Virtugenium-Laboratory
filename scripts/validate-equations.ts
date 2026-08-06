import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EquationAnswer } from "../src/entities/equation";
import { validateEquation } from "../src/entities/equation";

interface EquationTestCase {
  readonly id: string;
  readonly description: string;
  readonly expectedValid: boolean;
  readonly expectedIssue?: string;
  readonly answer: EquationAnswer;
}

const casesPath = resolve(
  process.cwd(),
  "src/data/equation-tests/cases.json",
);

const cases = JSON.parse(
  readFileSync(casesPath, "utf8"),
) as readonly EquationTestCase[];

let failures = 0;

for (const testCase of cases) {
  const result = validateEquation(testCase.answer);
  const issueCodes = result.issues.map((issue) => issue.code);

  const validityMatches =
    result.valid === testCase.expectedValid;

  const expectedIssueMatches =
    testCase.expectedIssue === undefined ||
    issueCodes.includes(testCase.expectedIssue);

  if (validityMatches && expectedIssueMatches) {
    const category = testCase.expectedValid ? "valid" : "invalid";
    console.log(`PASS ${category}: ${testCase.id}`);
    continue;
  }

  failures += 1;
  console.error(`FAIL: ${testCase.id}`);
  console.error(`  Описание: ${testCase.description}`);
  console.error(`  Ожидалось valid=${testCase.expectedValid}`);
  console.error(`  Получено valid=${result.valid}`);
  console.error(`  Ошибки: ${issueCodes.join(", ") || "нет"}`);
}

if (failures > 0) {
  console.error(`\nПроверка завершилась с ошибками: ${failures}`);
  process.exit(1);
}

console.log(
  `\nВсе примеры проверены успешно: ${cases.length}.`,
);
