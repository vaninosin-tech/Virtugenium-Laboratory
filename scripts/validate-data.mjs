import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";

const root = process.cwd();
const schemaPath = resolve(
  root,
  "src/data/schema/laboratory.schema.json",
);
const validDirectory = resolve(
  root,
  "src/data/examples/valid",
);
const invalidDirectory = resolve(
  root,
  "src/data/examples/invalid",
);

const readJson = (filePath) =>
  JSON.parse(readFileSync(filePath, "utf8"));

const listJsonFiles = (directory) =>
  readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

const schema = readJson(schemaPath);
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

let failures = 0;

for (const fileName of listJsonFiles(validDirectory)) {
  const filePath = resolve(validDirectory, fileName);
  const valid = validate(readJson(filePath));

  if (valid) {
    console.log(`PASS valid:   ${fileName}`);
  } else {
    failures += 1;
    console.error(`FAIL valid:   ${fileName}`);
    console.error(validate.errors);
  }
}

for (const fileName of listJsonFiles(invalidDirectory)) {
  const filePath = resolve(invalidDirectory, fileName);
  const valid = validate(readJson(filePath));

  if (!valid) {
    console.log(`PASS invalid: ${fileName}`);
  } else {
    failures += 1;
    console.error(`FAIL invalid: ${fileName} прошёл проверку`);
  }
}

if (failures > 0) {
  console.error(`\nПроверка завершилась с ошибками: ${failures}`);
  process.exit(1);
}

console.log("\nВсе примеры данных проверены успешно.");
