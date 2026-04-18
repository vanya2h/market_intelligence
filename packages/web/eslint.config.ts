import { config } from "@vanya2h/eslint-config/react";
import type { Linter } from "eslint";

export default [
  ...config,
  {
    files: ["eslint.config.ts"],
    rules: {
      "n/no-extraneous-import": "off",
    },
  },
] as Linter.Config[];
