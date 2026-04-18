import { config } from "@vanya2h/eslint-config/node";
import type { Linter } from "eslint";

export default [
  ...config,
  {
    rules: {
      // Pipeline is a CLI tool — process.exit() is intentional throughout
      "n/no-process-exit": "off",
      // ANSI escape sequences in regexes are intentional (chalk color stripping)
      "no-control-regex": "off",
    },
  },
  {
    files: ["eslint.config.ts"],
    rules: {
      "n/no-extraneous-import": "off",
    },
  },
] as Linter.Config[];
