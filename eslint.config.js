import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/** Helpers that `tests/visual/e2e/kb.js` puts on `globalThis` for the end-to-end scripts. */
const e2eHelpers = Object.fromEntries(
  ["accept1", "acceptExp", "act", "back", "clickObj", "collect1", "collectTubeStand", "doStep", "equation", "focus",
    "heatByDragging", "names", "panel", "ppe", "SALT", "screenOf", "setup1", "signs", "standAtTable", "startClassic",
    "take", "toTable", "typeField", "typeInto"]
    .map((name) => [name, "readonly"]),
);

export default tseslint.config(
  {
    // `tmp/` and `output/` are local scratch (see .gitignore), not project code.
    ignores: ["dist", "src-tauri/target", "src-tauri/gen", "tmp", "output"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `const { [id]: _removed, ...rest } = obj` is the way to drop a key immutably.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler rule. The project does not use the compiler, and
      // react-three-fiber mutates three.js objects (uniforms, `.visible`,
      // effect params) from hooks and `useFrame` by design.
      "react-hooks/immutability": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["scripts/**/*.{ts,js,mjs}", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Vitest specs and Playwright scripts: Node itself plus code passed to `page.evaluate` that runs in the browser.
    files: ["tests/**/*.{ts,js,mjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["tests/visual/e2e/**/*.{js,mjs}"],
    languageOptions: {
      globals: e2eHelpers,
    },
  },
);
