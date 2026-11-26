import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Shares, prices, values and percentages are strings or Decimal, never JS numbers.
  {
    files: ["src/lib/signals/**/*.ts", "src/lib/sec/form4-*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Number", message: "Use decimal.js for money, shares and percentages." },
        { name: "parseFloat", message: "Use decimal.js for money, shares and percentages." },
        { name: "parseInt", message: "Use decimal.js for money, shares and percentages." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Use decimal.js." },
        { object: "Number", property: "parseInt", message: "Use decimal.js." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toNumber']",
          message: "Keep Decimal values as Decimal or strings.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
