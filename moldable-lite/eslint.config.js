// The linter exists for three rules.
//
// A full-day audit of this codebase turned up two defect classes, and both of them are
// things a linter catches for free and a type-checker cannot see:
//
//   1. Non-component exports breaking a file's Fast Refresh boundary. App.tsx and
//      Viewer.tsx each carried exports nothing imported; React Refresh compares exports
//      across evaluations and rejects the boundary when they are not identical, so every
//      save to those files hard-reloaded the page and re-booted the ~11 MB OCCT kernel.
//      `react-refresh/only-export-components` names them by file and line.
//
//   2. Floating promises. All seven autosave paths were `void putProject(...).then(fn)` —
//      a one-argument .then, so a rejected write went nowhere, and there is no
//      unhandledrejection listener to catch it either. Work stopped being saved with no
//      signal. `@typescript-eslint/no-floating-promises` is the rule for exactly this.
//
// `tsc --noEmit` passes on both, which is why they survived. Everything else here is set
// to warn or off on purpose: this config is a guard against those failure modes, not an
// invitation to restyle a working codebase.
// This config deliberately does NOT extend a recommended preset. Turning on
// `recommendedTypeChecked` produced 719 errors on a working, shipping 30k-line app —
// unbound-method on opentype's API, require-await on the Backend interface's async
// signatures, no-implied-eval on the CAD worker's deliberate Function() sandbox. All
// style opinions, none of them the failure modes this exists to catch, and every one of
// them a place for the three real rules to hide. So: the typed parser, and three rules.
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "src-tauri", "node_modules", "eslint.config.js"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    // `base` is the parser and plugin registration only — no rules come with it.
    // no-floating-promises needs type information, hence the project reference.
    extends: [tseslint.configs.base],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.node.json"], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      "@typescript-eslint/no-floating-promises": "error",
      "react-hooks/rules-of-hooks": "error",
      // A warning, not an error: 11 deliberate eslint-disable-line suppressions already
      // mark incomplete dependency arrays that are load-bearing. Promoting this to error
      // would turn the first lint run into a refactor.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
